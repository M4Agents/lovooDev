-- =====================================================
-- MIGRATION: Corrigir identidade multi-tenant e RPC agent_message_enqueue_v1
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Etapa 3 (Migration D — Corretiva)
--
-- Por que nova migration (não edição das anteriores):
--   As migrations 130000, 140000 e 150000 já foram aplicadas em dev.
--   Editar o histórico exigiria 'supabase db reset' com perda dos 42.803 registros
--   existentes em agent_processed_messages. A migration corretiva preserva o
--   histórico de migrações e é a abordagem padrão do projeto.
--
-- Bloqueadores corrigidos nesta migration:
--
--   1. IDENTIDADE DE DEDUPLICAÇÃO MULTI-TENANT
--      Problema: PK global TEXT (uazapi_message_id) não é segura em multi-tenant.
--      Correção: PK UUID própria + UNIQUE(company_id, instance_id, uazapi_message_id)
--                via dois índices parciais (Router sem instance_id / Enqueue com).
--
--   2. VALIDAÇÃO COMPLETA DE DUPLICATA
--      Problema: 'result=buffered' era aceito sem verificar todos os vínculos.
--      Correção: validação de company_id, conversation_id, batch_id, batch_message_id,
--                pertencimento cruzado entre APM, batch e batch_message.
--
--   3. INTEGRIDADE REFERENCIAL (FKs)
--      Problema: batch_id e batch_message_id sem FK.
--      Correção: FKs com ON DELETE SET NULL + índices de suporte.
--
--   4. RETRY_PENDING → PENDING PARA NOVA MENSAGEM
--      Problema: nova mensagem em lote retry_pending não resetava status.
--      Correção: UPDATE final seta status=pending, next_attempt_at=NULL,
--                preservando attempts/last_error/last_error_code para auditoria.
--
--   5. LIMITES ACUMULADOS ATÔMICOS
--      Problema: sem validação de limite de mensagens ou texto por lote.
--      Correção: c_max_messages_per_batch=50, c_max_total_text_length=100000.
--                Verificação com lock exclusivo antes do INSERT.
--                BATCH_LIMIT_REACHED → rollback completo (sem órfãos em APM).
--
--   6. ORDEM: LIMITES ANTES DO COMMIT DEFINITIVO
--      Problema: sem garantia de rollback completo em erro de limite.
--      Correção: limite verificado após lock do lote (PASSO 6), antes do INSERT
--                da mensagem. Qualquer exceção reverte APM + lote atomicamente.
--
--   7. UPDATE FINAL COM RETURNING (valores exatos)
--      Problema: retorno calculava value_anterior + incremento manualmente.
--      Correção: UPDATE batch com RETURNING → resposta usa valores persistidos.
--
--   8. CONCORRÊNCIA DOCUMENTADA E REFORÇADA
--      Cenários cobertos: mesma mensagem simultânea, lotes concorrentes,
--      criação do primeiro lote, retry_pending, limites próximos.
--      Mecanismo: UNIQUE parcial (dedup gate) + lock via UPSERT DO UPDATE.
--
--   9. TIMESTAMPS DE AUDITORIA NORMALIZADOS
--      Problema: received_at e provider_timestamp arbitrários aceitos sem validação.
--      Correção: received_at futuro > 5 min → normalizado para now().
--                provider_timestamp futuro > 30 min → normalizado para NULL.
--
-- Tabelas afetadas:
--   - public.agent_processed_messages (schema + PK + índices + FKs + coluna)
--   - public.agent_message_enqueue_v1 (função SQL — CREATE OR REPLACE)
--
-- Impacto no Router existente (conversationRouter.js):
--   O Router usa uazapi_message_id como chave de dedup (sem instance_id).
--   A nova estrutura é compatível: registros com instance_id IS NULL são
--   cobertos pelo índice parcial apm_dedup_router.
--   O Router NÃO precisa ser alterado nesta etapa — seu path é independente
--   do path de enqueue. Atualização futura do Router para incluir instance_id
--   é recomendada (risco residual documentado ao final).
--
-- Pré-condições verificadas antes de executar:
--   - 0 registros em agent_processed_messages com batch_id IS NOT NULL
--   - 0 registros em agent_processed_messages com batch_message_id IS NOT NULL
--   - 0 registros com result = 'buffered'
--   - 0 lotes em agent_message_batches
--
-- Dependências:
--   20260714130000_add_buffered_to_agent_processed_messages.sql (Migration A)
--   20260714140000_create_agent_message_batches.sql             (Migration B)
--   20260714150000_create_agent_message_enqueue_v1.sql          (Migration C)
--
-- Rollback: ver instruções ao final deste arquivo.
-- =====================================================


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 0: VERIFICAÇÃO DE PRÉ-CONDIÇÕES (segurança antes de alterar schema)
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Nenhum registro buffered pode existir antes de alterar o schema de dedup
  IF EXISTS (
    SELECT 1 FROM public.agent_processed_messages
    WHERE result = 'buffered'
  ) THEN
    RAISE EXCEPTION 'SCHEMA_SAFETY: existem registros com result=buffered. '
      'Aguardar processamento dos lotes pendentes antes de aplicar esta migration.';
  END IF;

  -- Sem órfãos de batch_id
  IF EXISTS (
    SELECT 1 FROM public.agent_processed_messages apm
    WHERE apm.batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.agent_message_batches b WHERE b.id = apm.batch_id
      )
  ) THEN
    RAISE EXCEPTION 'SCHEMA_SAFETY: existem registros em agent_processed_messages '
      'com batch_id orfao. Limpar antes de adicionar FK.';
  END IF;

  -- Sem órfãos de batch_message_id
  IF EXISTS (
    SELECT 1 FROM public.agent_processed_messages apm
    WHERE apm.batch_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.agent_message_batch_messages bm WHERE bm.id = apm.batch_message_id
      )
  ) THEN
    RAISE EXCEPTION 'SCHEMA_SAFETY: existem registros em agent_processed_messages '
      'com batch_message_id orfao. Limpar antes de adicionar FK.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 1: NOVA PK UUID E COLUNA instance_id EM agent_processed_messages
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Decisão de identidade de deduplicação multi-tenant:
--
-- O provider (Uazapi/WhatsApp) NÃO oferece garantia formal de unicidade global
-- do message.id entre diferentes empresas ou instâncias. O ID do WhatsApp inclui
-- informações do remetente, mas a unicidade entre tenants não está documentada
-- na API do Uazapi como garantia contratual. Aceitar apenas unicidade global
-- seria um risco de segurança multi-tenant.
--
-- Estratégia adotada:
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid()  — identificador interno único
--   instance_id UUID NULL                          — para compatibilidade com Router
--   UNIQUE(company_id, uazapi_message_id) WHERE instance_id IS NULL   → Router
--   UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL → Enqueue
--
-- Por que instance_id é nullable:
--   O conversationRouter.js insere sem instance_id (não tem esse contexto).
--   Forçar NOT NULL quebraria o fluxo existente do Router. Como o Router e o
--   Enqueue são caminhos mutuamente exclusivos (uma mensagem não é processada
--   pelos dois), a separação via índices parciais é segura.
--
-- Risco residual do Router:
--   O Router faz UPDATE WHERE uazapi_message_id = X (sem company_id).
--   Poderia afetar registros de outra empresa com o mesmo uazapi_message_id
--   e instance_id IS NULL. Probabilidade: muito baixa em prod dado que o
--   WhatsApp message.id usa um prefixo do número do remetente.
--   Mitigação futura: atualizar o Router para incluir company_id no WHERE.
--
-- Nota sobre reescrita de tabela (table rewrite):
--   Adicionar coluna NOT NULL com DEFAULT VOLATILE (gen_random_uuid()) em
--   PostgreSQL 12+ ainda requer reescrita da tabela. Para 42K linhas em dev,
--   estimativa: < 5 segundos. Não impacta produção (esta migration não vai
--   para prod sem aprovação explícita).

-- 1a. Adicionar coluna id UUID com DEFAULT (popula todas as linhas existentes)
ALTER TABLE public.agent_processed_messages
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- 1b. Adicionar coluna instance_id UUID NULL
ALTER TABLE public.agent_processed_messages
  ADD COLUMN IF NOT EXISTS instance_id UUID NULL;

-- 1c. Remover PK atual (uazapi_message_id)
--     IF EXISTS: idempotente para reexecução
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'agent_processed_messages_pkey'
      AND table_name      = 'agent_processed_messages'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.agent_processed_messages
      DROP CONSTRAINT agent_processed_messages_pkey;
  END IF;
END $$;

-- 1d. Adicionar nova PK no campo id
--     Nome explícito para clareza (evita nome padrão reaproveitado)
ALTER TABLE public.agent_processed_messages
  ADD CONSTRAINT agent_processed_messages_id_pkey PRIMARY KEY (id);

-- 1e. Índice de deduplicação para o caminho do Router (instance_id IS NULL)
--     Substitui o papel do antigo PK de uazapi_message_id para o Router.
--     O Router insere sem instance_id, portanto este índice cobre seu path.
CREATE UNIQUE INDEX IF NOT EXISTS apm_dedup_router
  ON public.agent_processed_messages(company_id, uazapi_message_id)
  WHERE instance_id IS NULL;

-- 1f. Índice de deduplicação para o caminho do Enqueue (instance_id IS NOT NULL)
--     Cobre o path da RPC agent_message_enqueue_v1.
--     ON CONFLICT na RPC targeta este índice explicitamente.
CREATE UNIQUE INDEX IF NOT EXISTS apm_dedup_enqueue
  ON public.agent_processed_messages(company_id, instance_id, uazapi_message_id)
  WHERE instance_id IS NOT NULL;

-- 1g. Índice auxiliar em instance_id para queries de filtragem
CREATE INDEX IF NOT EXISTS idx_apm_instance_id
  ON public.agent_processed_messages(instance_id)
  WHERE instance_id IS NOT NULL;

-- Comentários das novas colunas
COMMENT ON COLUMN public.agent_processed_messages.id IS
  'PK UUID interna. Permite identificar a linha sem depender de unicidade global '
  'do uazapi_message_id entre tenants.';

COMMENT ON COLUMN public.agent_processed_messages.instance_id IS
  'UUID da instância WhatsApp que recebeu a mensagem. '
  'NULL para registros do fluxo Router (conversationRouter.js), que não tem '
  'este contexto. NOT NULL para registros do fluxo Enqueue. '
  'Faz parte da chave de deduplicação multi-tenant no índice apm_dedup_enqueue.';


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 2: FKs DE RASTREABILIDADE (batch_id e batch_message_id)
-- ════════════════════════════════════════════════════════════════════════════════
--
-- ON DELETE SET NULL: remove o vínculo sem apagar o registro de deduplicação.
-- Preserva a auditoria mesmo quando dados operacionais são limpos.
--
-- Por que FKs independentes e não constraint composta (batch_message_id, batch_id):
--   Uma constraint composta (batch_message_id, batch_id) exigiria que ambos
--   fossem NOT NULL simultaneamente, quebrando o path do Router (que não preenche
--   nenhum deles). A consistência cruzada ("batch_message pertence ao batch")
--   é validada transacionalmente pela RPC no PASSO 4 (duplicata) e implicitamente
--   garantida pela própria inserção atômica no PASSO 7/9.
--
-- Índices de suporte às FKs (FK sem índice causa full scan nas cascatas):

ALTER TABLE public.agent_processed_messages
  ADD CONSTRAINT apm_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.agent_message_batches(id)
  ON DELETE SET NULL;

ALTER TABLE public.agent_processed_messages
  ADD CONSTRAINT apm_batch_message_id_fkey
  FOREIGN KEY (batch_message_id) REFERENCES public.agent_message_batch_messages(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apm_batch_id
  ON public.agent_processed_messages(batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_apm_batch_message_id
  ON public.agent_processed_messages(batch_message_id)
  WHERE batch_message_id IS NOT NULL;

COMMENT ON CONSTRAINT apm_batch_id_fkey ON public.agent_processed_messages IS
  'FK para agent_message_batches. ON DELETE SET NULL preserva rastreabilidade '
  'quando lotes são arquivados/removidos.';

COMMENT ON CONSTRAINT apm_batch_message_id_fkey ON public.agent_processed_messages IS
  'FK para agent_message_batch_messages. ON DELETE SET NULL preserva rastreabilidade '
  'quando mensagens individuais são arquivadas/removidas.';


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 3: RPC agent_message_enqueue_v1 (versão corrigida)
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Mudanças em relação à Migration C (150000):
--
--   PASSO 4 (dedup gate):
--     - Mudou de ON CONFLICT(uazapi_message_id) para ON CONFLICT via índice parcial
--       apm_dedup_enqueue: UNIQUE(company_id, instance_id, uazapi_message_id)
--       WHERE instance_id IS NOT NULL
--     - Agora captura v_apm_id do RETURNING (usado no PASSO 9 para evitar ambiguidade)
--     - Validação completa de duplicata: verifica company_id, conversation_id,
--       batch_id (não nulo), batch_message_id (não nulo), existência do batch
--       na empresa/conversa correta, existência do batch_message no batch correto
--       e com mesmos company_id, conversation_id, instance_id, provider_message_id.
--
--   PASSO 6 (limites acumulados — NOVO):
--     - Verificação atômica (com lock adquirido pelo UPSERT do PASSO 5)
--     - c_max_messages_per_batch = 50 mensagens
--     - c_max_total_text_length = 100.000 caracteres
--     - BATCH_LIMIT_REACHED → RAISE EXCEPTION → rollback completo (APM + lote)
--
--   PASSO 8 (UPDATE do lote):
--     - retry_pending → pending: nova mensagem real reinicia o ciclo
--       (preserva attempts, last_error, last_error_code)
--     - RETURNING captura valores exatos persistidos (não cálculo manual)
--
--   PASSO 9 (UPDATE APM):
--     - Usa WHERE id = v_apm_id (sem ambiguidade multi-tenant)
--
--   PASSO 10 (RETURN):
--     - Usa valores do RETURNING (v_final_status, v_final_msg_count, etc.)
--
--   PASSO 2 (timestamps):
--     - received_at: NULL → v_now | futuro > 5 min → v_now (normalizado)
--     - provider_timestamp: futuro > 30 min → NULL (tratado como ausente)
--
-- Análise de concorrência:
--
--   (1) Mesma mensagem simultânea:
--       ON CONFLICT DO NOTHING no índice apm_dedup_enqueue aguarda a txn
--       concorrente commitar (speculative insertion lock). Após commit, a
--       segunda txn obtém ROW_COUNT = 0 → caminho de validação de duplicata.
--
--   (2) Mensagens diferentes simultâneas na mesma conversa:
--       APM INSERTs independentes (chaves diferentes). UPSERT do lote:
--       segunda txn bloqueia na lock da primeira (via DO UPDATE). Após commit
--       da primeira, segunda lê contadores atualizados. Limite verificado com
--       valores corretos. Ambas inseridas corretamente (dentro do limite).
--
--   (3) Criação simultânea do primeiro lote:
--       Uma das txns cria o lote (INSERT); a outra detecta conflito e entra no
--       DO UPDATE (lock). A segunda lê o lote existente após commit da primeira.
--       O índice apm_dedup_enqueue garante que cada mensagem tem no máximo um
--       registro APM, evitando duplicidade cruzada.
--
--   (4) Duplicata enquanto txn vencedora ainda não commitou:
--       ON CONFLICT DO NOTHING espera (speculative lock). Quando a primeira txn
--       commita, a segunda vê ROW_COUNT = 0 e entra em validação de duplicata.
--
--   (5) Lote mudando para processing durante enqueue:
--       O índice parcial do UPSERT só cobre pending/retry_pending. Se o cron
--       reivindicou o lote (processing) antes do UPSERT, um novo lote pending
--       é criado para a mensagem que chegou. Correto por design.
--
--   (6) Mensagem nova em retry_pending:
--       UPSERT encontra o lote (coberto pelo índice), lock adquirido, limites
--       verificados com valores atuais. INSERT da mensagem. UPDATE do lote:
--       status=pending, next_attempt_at=NULL, deadline renovado.
--
--   (7) Mensagens concorrentes próximas ao limite:
--       Serialização pelo lock do UPSERT garante verificação atômica. A primeira
--       txn que commitar ocupará a última vaga. A segunda verá o contador já no
--       limite e receberá BATCH_LIMIT_REACHED com rollback completo.

CREATE OR REPLACE FUNCTION public.agent_message_enqueue_v1(
  -- ── Parâmetros obrigatórios ──────────────────────────────────────────────────
  p_company_id                  UUID,
  p_conversation_id             UUID,
  p_window_seconds              INT,
  p_provider_message_id         TEXT,
  p_instance_id                 UUID,

  -- ── Parâmetros opcionais ─────────────────────────────────────────────────────
  p_assignment_id               UUID        DEFAULT NULL,
  p_channel                     TEXT        DEFAULT 'whatsapp',
  p_max_batch_duration_seconds  INT         DEFAULT 120,
  p_message_text                TEXT        DEFAULT NULL,
  p_message_type                TEXT        DEFAULT 'text',
  p_provider_timestamp          TIMESTAMPTZ DEFAULT NULL,
  p_received_at                 TIMESTAMPTZ DEFAULT NULL,
  p_payload                     JSONB       DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Constantes de validação de entrada ───────────────────────────────────────
  c_max_window_seconds         CONSTANT INT := 120;       -- janela máx de debounce (s)
  c_max_batch_duration         CONSTANT INT := 600;       -- duração absoluta máx do lote (s)
  c_max_msg_id_len             CONSTANT INT := 512;       -- chars máx de provider_message_id
  c_max_msg_type_len           CONSTANT INT := 50;        -- chars máx de message_type
  c_max_msg_text_len           CONSTANT INT := 10000;     -- chars máx de message_text individual
  c_max_payload_bytes          CONSTANT INT := 65536;     -- bytes máx de payload (64 KB)

  -- ── Constantes de limite por lote (V1 — fixas na função, não controláveis pelo chamador) ──
  c_max_messages_per_batch     CONSTANT INT := 50;        -- mensagens máx por lote
  c_max_total_text_length      CONSTANT INT := 100000;    -- chars máx de texto acumulado por lote

  -- ── Tolerâncias para normalização de timestamps ──────────────────────────────
  c_received_at_future_tol_s   CONSTANT INT := 300;       -- 5 min: acima → normalizar para now()
  c_provider_ts_future_tol_s   CONSTANT INT := 1800;      -- 30 min: acima → normalizar para NULL

  -- ── Variáveis de trabalho ────────────────────────────────────────────────────
  v_now                        TIMESTAMPTZ;
  v_max_dur_interval           INTERVAL;
  v_conv_company               UUID;
  v_inst_company               UUID;
  v_batch_id                   UUID;
  v_batch_status               TEXT;
  v_batch_msg_count            INT;
  v_batch_text_len             INT;
  v_batch_max_deadline         TIMESTAMPTZ;
  v_batch_message_id           UUID;
  v_final_deadline             TIMESTAMPTZ;
  v_text_len                   INT;
  v_apm_id                     UUID;           -- ID da linha APM (INSERT ou DO NOTHING)
  v_apm_rows                   INT;            -- 1 = INSERT, 0 = DO NOTHING (duplicata)
  v_msg_rows                   INT;            -- 1 = INSERT, 0 = DO NOTHING (inconsistência)

  -- ── Variáveis de validação de duplicata ──────────────────────────────────────
  v_existing_result            TEXT;
  v_existing_batch_id          UUID;
  v_existing_msg_id            UUID;
  v_existing_conv              UUID;
  v_batch_company              UUID;
  v_batch_conv                 UUID;
  v_bmm_batch                  UUID;
  v_bmm_company                UUID;
  v_bmm_conv                   UUID;
  v_bmm_inst                   UUID;
  v_bmm_pmid                   TEXT;

  -- ── Timestamps normalizados ───────────────────────────────────────────────────
  v_received_at                TIMESTAMPTZ;
  v_provider_timestamp_norm    TIMESTAMPTZ;

  -- ── Valores do RETURNING do UPDATE final do lote ─────────────────────────────
  v_final_status               TEXT;
  v_final_deadline_ret         TIMESTAMPTZ;
  v_batch_max_deadline_ret     TIMESTAMPTZ;
  v_final_msg_count            INT;
  v_final_text_len             INT;

BEGIN

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 1: VALIDAÇÃO DE PARÂMETROS
  -- ══════════════════════════════════════════════════════════════════════════════
  -- Rejeitar entradas inválidas com mensagens claras antes de qualquer I/O.

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_conversation_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_instance_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_provider_message_id IS NULL OR trim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_provider_message_id e obrigatorio e nao pode ser vazio'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(p_provider_message_id) > c_max_msg_id_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_provider_message_id excede % caracteres', c_max_msg_id_len
      USING ERRCODE = 'P0001';
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('whatsapp') THEN
    RAISE EXCEPTION 'INVALID_PARAM: canal nao suportado nesta versao: %',
      COALESCE(p_channel, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > c_max_window_seconds THEN
    RAISE EXCEPTION 'INVALID_PARAM: window_seconds deve ser inteiro entre 1 e %', c_max_window_seconds
      USING ERRCODE = 'P0001';
  END IF;

  IF p_max_batch_duration_seconds IS NOT NULL
    AND (p_max_batch_duration_seconds <= 0 OR p_max_batch_duration_seconds > c_max_batch_duration)
  THEN
    RAISE EXCEPTION 'INVALID_PARAM: max_batch_duration_seconds deve estar entre 1 e %', c_max_batch_duration
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PARAM: payload deve ser objeto JSON (recebido: %)',
      COALESCE(jsonb_typeof(p_payload), 'null')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payload IS NOT NULL AND octet_length(p_payload::text) > c_max_payload_bytes THEN
    RAISE EXCEPTION 'INVALID_PARAM: payload excede limite de % bytes', c_max_payload_bytes
      USING ERRCODE = 'P0001';
  END IF;

  IF p_message_type IS NOT NULL AND length(p_message_type) > c_max_msg_type_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: message_type excede % caracteres', c_max_msg_type_len
      USING ERRCODE = 'P0001';
  END IF;

  IF p_message_text IS NOT NULL AND length(p_message_text) > c_max_msg_text_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: message_text excede % caracteres', c_max_msg_text_len
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 2: INICIALIZAÇÃO E NORMALIZAÇÃO DE TIMESTAMPS
  -- ══════════════════════════════════════════════════════════════════════════════
  -- v_now é a fonte temporal única para todos os cálculos de deadline.
  -- Timestamps externos (p_provider_timestamp, p_received_at) são usados apenas
  -- para ordenação/auditoria — nunca influenciam deadline ou max_deadline_at.
  --
  -- received_at:
  --   NULL        → v_now (fallback seguro)
  --   > now + 5m  → v_now (normalizado; valor futuro absurdo rejeitado sem erro)
  --   resto       → preservar (pode ser retroativo — legítimo para replay)
  --
  -- provider_timestamp:
  --   > now + 30m → NULL (valor absurdo; tratado como ausente para ordenação)
  --   resto       → preservar (inclui valores antigos; legítimo para histórico)

  v_now            := now();
  v_text_len       := COALESCE(length(p_message_text), 0);
  v_max_dur_interval := (COALESCE(p_max_batch_duration_seconds, 120) || ' seconds')::interval;

  v_received_at := CASE
    WHEN p_received_at IS NULL THEN v_now
    WHEN p_received_at > v_now + (c_received_at_future_tol_s || ' seconds')::interval THEN v_now
    ELSE p_received_at
  END;

  v_provider_timestamp_norm := CASE
    WHEN p_provider_timestamp IS NOT NULL
      AND p_provider_timestamp > v_now + (c_provider_ts_future_tol_s || ' seconds')::interval
    THEN NULL
    ELSE p_provider_timestamp
  END;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 3: VALIDAÇÃO MULTI-TENANT
  -- ══════════════════════════════════════════════════════════════════════════════
  -- Cada recurso recebido como parâmetro é validado contra p_company_id no banco.
  -- Não confiar apenas nos IDs do chamador.

  SELECT company_id INTO v_conv_company
  FROM public.chat_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND OR v_conv_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: conversa nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id INTO v_inst_company
  FROM public.whatsapp_life_instances
  WHERE id = p_instance_id;

  IF NOT FOUND OR v_inst_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: instancia nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_assignment_id IS NOT NULL THEN
    PERFORM 1 FROM public.company_agent_assignments
    WHERE id = p_assignment_id
      AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TENANT_VIOLATION: assignment nao encontrado ou nao pertence a empresa informada'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 4: DEDUP GATE EM AGENT_PROCESSED_MESSAGES
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Mecanismo:
  --   INSERT ON CONFLICT DO NOTHING targeta o índice parcial apm_dedup_enqueue:
  --     UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL
  --
  --   ON CONFLICT DO NOTHING com speculative insertion lock:
  --     PostgreSQL aguarda que a transação concorrente (que gerou o conflito)
  --     comite ou reverta antes de retornar ROW_COUNT = 0.
  --     Isso é seguro para o cenário de mesma mensagem simultânea (Cenário 1 e 4).
  --
  --   v_apm_rows = 1 → INSERT bem-sucedido → mensagem nova → continuar
  --   v_apm_rows = 0 → DO NOTHING → duplicata → SELECT + validação completa
  --
  --   Ao inserir: result = 'buffered' (estado transitório até o PASSO 9 preencher
  --   batch_id e batch_message_id). Qualquer falha antes do PASSO 9 resulta em
  --   rollback completo — nunca fica um registro 'buffered' sem batch_id.
  --
  --   Ao encontrar duplicata: SELECT usa chave composta (company_id, instance_id,
  --   uazapi_message_id) — sem risco de retornar registro de outro tenant.

  INSERT INTO public.agent_processed_messages (
    uazapi_message_id,
    instance_id,
    conversation_id,
    company_id,
    assignment_id,
    result
  ) VALUES (
    p_provider_message_id,
    p_instance_id,
    p_conversation_id,
    p_company_id,
    p_assignment_id,
    'buffered'
  )
  ON CONFLICT (company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_apm_id;

  GET DIAGNOSTICS v_apm_rows = ROW_COUNT;

  IF v_apm_rows = 0 THEN
    -- ── Duplicata detectada: ler e validar o registro existente ────────────────
    -- SELECT usa chave composta tenant-safe — não pode retornar dados de outro tenant.
    -- A transação concorrente que gerou o conflito já commitou (garantido pelo DO NOTHING).

    SELECT
      apm.id,
      apm.result,
      apm.batch_id,
      apm.batch_message_id,
      apm.conversation_id
    INTO
      v_apm_id,
      v_existing_result,
      v_existing_batch_id,
      v_existing_msg_id,
      v_existing_conv
    FROM public.agent_processed_messages apm
    WHERE apm.company_id       = p_company_id
      AND apm.instance_id      = p_instance_id
      AND apm.uazapi_message_id = p_provider_message_id;

    IF NOT FOUND THEN
      -- Não deveria ocorrer em operação normal (conflict detectado → linha deve existir)
      RAISE EXCEPTION 'DEDUP_CONFLICT_UNRESOLVABLE: conflito detectado mas linha nao encontrada. company_id=%, instance_id=%, provider_message_id=%',
        p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4a. Verificar que result = 'buffered' ─────────────────────────────────
    IF v_existing_result <> 'buffered' THEN
      RAISE EXCEPTION 'INCOMPATIBLE_STATE: mensagem ja registrada com result=% impossibilita agrupamento. company_id=%, instance_id=%, provider_message_id=%',
        v_existing_result, p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4b. Verificar conversation_id ────────────────────────────────────────
    IF v_existing_conv IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro duplicado pertence a conversa diferente. esperado=%, encontrado=%',
        p_conversation_id, COALESCE(v_existing_conv::text, 'null')
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4c. Verificar que batch_id está preenchido ────────────────────────────
    IF v_existing_batch_id IS NULL THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro buffered sem batch_id. '
        'Estado incompativel — transacao anterior pode ter sido interrompida. '
        'company_id=%, instance_id=%, provider_message_id=%',
        p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4d. Verificar que batch_message_id está preenchido ───────────────────
    IF v_existing_msg_id IS NULL THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro buffered sem batch_message_id. '
        'Estado incompativel — transacao anterior pode ter sido interrompida. '
        'company_id=%, instance_id=%, provider_message_id=%',
        p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4e. Validar que o batch pertence à empresa e conversa corretas ────────
    SELECT b.company_id, b.conversation_id
    INTO   v_batch_company, v_batch_conv
    FROM   public.agent_message_batches b
    WHERE  b.id = v_existing_batch_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_id nao encontrado em agent_message_batches. batch_id=%',
        v_existing_batch_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_batch_company IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION 'TENANT_VIOLATION: batch pertence a empresa diferente do registro APM. batch_id=%',
        v_existing_batch_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_batch_conv IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch pertence a conversa diferente do registro APM. batch_id=%',
        v_existing_batch_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4f. Validar que batch_message pertence ao batch, empresa, conversa,
    --        instância e provider_message_id corretos ─────────────────────────
    SELECT bmm.batch_id, bmm.company_id, bmm.conversation_id,
           bmm.instance_id, bmm.provider_message_id
    INTO   v_bmm_batch, v_bmm_company, v_bmm_conv, v_bmm_inst, v_bmm_pmid
    FROM   public.agent_message_batch_messages bmm
    WHERE  bmm.id = v_existing_msg_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message_id nao encontrado em agent_message_batch_messages. batch_message_id=%',
        v_existing_msg_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bmm_batch IS DISTINCT FROM v_existing_batch_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a batch diferente do registrado no APM. esperado=%, encontrado=%',
        v_existing_batch_id, v_bmm_batch
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bmm_company IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION 'TENANT_VIOLATION: batch_message pertence a empresa diferente. batch_message_id=%',
        v_existing_msg_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bmm_conv IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a conversa diferente. batch_message_id=%',
        v_existing_msg_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bmm_inst IS DISTINCT FROM p_instance_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a instancia diferente. batch_message_id=%',
        v_existing_msg_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bmm_pmid IS DISTINCT FROM p_provider_message_id THEN
      RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message tem provider_message_id diferente do esperado. esperado=%, encontrado=%',
        p_provider_message_id, v_bmm_pmid
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4g. Todos os vínculos validados — duplicata saudável ──────────────────
    -- Não renovar deadline, não incrementar contadores.
    -- Retornar apenas referências do próprio tenant (validadas acima).
    RETURN jsonb_build_object(
      'ok',               true,
      'inserted',         false,
      'duplicate',        true,
      'batch_id',         v_existing_batch_id,
      'batch_message_id', v_existing_msg_id,
      'reason',           'already_buffered'
    );
  END IF;

  -- v_apm_rows = 1: INSERT bem-sucedido → mensagem nova → prosseguir


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 5: LOCALIZAR OU CRIAR LOTE ABERTO
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- ON CONFLICT DO UPDATE SET updated_at = now():
  --   - Adquire lock exclusivo na linha (FOR UPDATE implícito do DO UPDATE)
  --   - Serializa chamadas concorrentes para o mesmo lote
  --   - RETURNING retorna valores ATUAIS (antes dos incrementos desta txn)
  --
  -- Lote 'retry_pending': coberto pelo índice parcial (status IN pending/retry_pending).
  --   O lock é adquirido. O reset de status ocorre no PASSO 8 (após confirmar insert).
  --
  -- Lote 'processing' ou sem lote: não cobre o índice → INSERT cria novo lote pending.

  INSERT INTO public.agent_message_batches (
    company_id,
    conversation_id,
    enqueue_assignment_id,
    channel,
    status,
    deadline_at,
    max_deadline_at,
    first_message_at,
    last_message_at,
    message_count,
    total_text_length
  ) VALUES (
    p_company_id,
    p_conversation_id,
    p_assignment_id,
    p_channel,
    'pending',
    v_now + (p_window_seconds || ' seconds')::interval,
    v_now + v_max_dur_interval,
    v_now,
    v_now,
    0,
    0
  )
  ON CONFLICT (company_id, conversation_id, channel)
    WHERE status IN ('pending', 'retry_pending')
  DO UPDATE SET
    updated_at = now()
  RETURNING
    id,
    status,
    message_count,
    total_text_length,
    max_deadline_at
  INTO
    v_batch_id,
    v_batch_status,
    v_batch_msg_count,
    v_batch_text_len,
    v_batch_max_deadline;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 6: VERIFICAR LIMITES ACUMULADOS (ATÔMICO)
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- O lock exclusivo do PASSO 5 garante que v_batch_msg_count e v_batch_text_len
  -- são os valores REAIS do lote neste momento. Nenhuma transação concorrente
  -- pode modificar esses contadores enquanto este lock é mantido.
  --
  -- BATCH_LIMIT_REACHED → RAISE EXCEPTION → rollback completo da transação:
  --   - APM INSERT do PASSO 4 é desfeito (sem registro órfão em APM)
  --   - Lote não alterado (contadores preservados, deadline preservado)
  --   - Próxima chamada pode verificar se o lote foi processado e repetir o enqueue
  --
  -- O Router futuro é responsável por processar o lote cheio e repetir o enqueue.
  -- Esta função não cria automaticamente um segundo lote para evitar ultrapassar
  -- o índice parcial único (agent_message_batches_open_unique).

  IF v_batch_msg_count + 1 > c_max_messages_per_batch THEN
    RAISE EXCEPTION 'BATCH_LIMIT_REACHED: limite de mensagens por lote atingido (max=%, atual=%). '
      'Processar o lote antes de enfileirar novas mensagens. batch_id=%',
      c_max_messages_per_batch, v_batch_msg_count, v_batch_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_batch_text_len + v_text_len > c_max_total_text_length THEN
    RAISE EXCEPTION 'BATCH_LIMIT_REACHED: limite de texto total do lote atingido (max=%, atual=%, novo=%chars). '
      'Processar o lote antes de enfileirar novas mensagens. batch_id=%',
      c_max_total_text_length, v_batch_text_len, v_text_len, v_batch_id
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 7: INSERIR MENSAGEM NO LOTE
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Em operação normal: PASSO 4 garante que nenhuma mensagem com este
  -- (company_id, instance_id, provider_message_id) já está em batch_messages.
  -- ON CONFLICT DO NOTHING: proteção defensiva secundária (índice apm_dedup_enqueue
  -- no APM e agent_message_batch_messages_dedup no batch_messages são independentes
  -- mas devem estar em sincronismo).
  --
  -- v_msg_rows = 0 → inconsistência: passed pelo APM gate mas já em batch_messages.
  -- Indica estado corrompido → RAISE EXCEPTION → rollback completo.
  --
  -- Timestamps: v_received_at e v_provider_timestamp_norm são os valores
  -- normalizados no PASSO 2 — nunca os valores brutos do chamador.

  INSERT INTO public.agent_message_batch_messages (
    batch_id,
    company_id,
    conversation_id,
    provider_message_id,
    instance_id,
    provider_timestamp,
    received_at,
    message_text,
    message_type,
    payload
  ) VALUES (
    v_batch_id,
    p_company_id,
    p_conversation_id,
    p_provider_message_id,
    p_instance_id,
    v_provider_timestamp_norm,
    v_received_at,
    p_message_text,
    COALESCE(p_message_type, 'text'),
    COALESCE(p_payload, '{}')
  )
  ON CONFLICT (company_id, instance_id, provider_message_id) DO NOTHING
  RETURNING id INTO v_batch_message_id;

  GET DIAGNOSTICS v_msg_rows = ROW_COUNT;

  IF v_msg_rows = 0 THEN
    RAISE EXCEPTION
      'DEDUP_INCONSISTENCY: mensagem passou pelo gate APM mas ja existe em batch_messages. '
      'provider_message_id=%. Verifique integridade dos indices apm_dedup_enqueue e agent_message_batch_messages_dedup.',
      p_provider_message_id
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 8: ATUALIZAR LOTE — DEADLINE, CONTADORES E STATUS
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Executado SOMENTE após confirmar inserção da mensagem no PASSO 7.
  -- Duplicatas nunca chegam a este passo.
  --
  -- RETURNING captura valores exatos persistidos após este UPDATE.
  -- O JSON de resposta usa exclusivamente esses valores — sem cálculo manual.
  --
  -- retry_pending → pending:
  --   Uma nova mensagem real reinicia o ciclo de processamento do lote.
  --   - status    = 'pending'     (elegível para claim quando deadline_at <= now())
  --   - next_attempt_at = NULL    (desativa backoff anterior)
  --   - attempts, last_error, last_error_code: PRESERVADOS para auditoria
  --   Razão: o backoff anterior é relevante apenas para a tentativa que falhou.
  --   A chegada de nova mensagem indica atividade da conversa — processar logo.
  --
  -- v_batch_status (capturado no PASSO 5) é usado no CASE WHEN porque o lock
  -- impede mudança de status entre o UPSERT e este UPDATE dentro da mesma txn.

  v_final_deadline := LEAST(
    v_now + (p_window_seconds || ' seconds')::interval,
    v_batch_max_deadline
  );

  UPDATE public.agent_message_batches SET
    deadline_at       = v_final_deadline,
    last_message_at   = v_now,
    message_count     = message_count + 1,
    total_text_length = total_text_length + v_text_len,
    status            = CASE WHEN v_batch_status = 'retry_pending' THEN 'pending'
                             ELSE status END,
    next_attempt_at   = CASE WHEN v_batch_status = 'retry_pending' THEN NULL
                             ELSE next_attempt_at END,
    updated_at        = v_now
  WHERE id = v_batch_id
  RETURNING
    status,
    deadline_at,
    max_deadline_at,
    message_count,
    total_text_length
  INTO
    v_final_status,
    v_final_deadline_ret,
    v_batch_max_deadline_ret,
    v_final_msg_count,
    v_final_text_len;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 9: ASSOCIAR LOTE AO REGISTRO DE AGENT_PROCESSED_MESSAGES
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Usa WHERE id = v_apm_id (PK UUID interna, retornada no PASSO 4).
  -- Sem ambiguidade multi-tenant: v_apm_id identifica exatamente a linha
  -- que esta transação inseriu no PASSO 4.

  UPDATE public.agent_processed_messages SET
    batch_id         = v_batch_id,
    batch_message_id = v_batch_message_id
  WHERE id = v_apm_id;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 10: RETORNAR RESULTADO ESTRUTURADO
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Todos os valores de contadores/status vêm do RETURNING do PASSO 8.
  -- batch_status reflete o status FINAL (após possível reset de retry_pending).

  RETURN jsonb_build_object(
    'ok',                true,
    'inserted',          true,
    'duplicate',         false,
    'batch_id',          v_batch_id,
    'batch_message_id',  v_batch_message_id,
    'batch_status',      v_final_status,
    'deadline_at',       v_final_deadline_ret,
    'max_deadline_at',   v_batch_max_deadline_ret,
    'message_count',     v_final_msg_count,
    'total_text_length', v_final_text_len,
    'reason',            'buffered'
  );

END;
$$;


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 4: SEGURANÇA — REVOKE E GRANT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE preserva grants existentes (mesma assinatura).
-- Incluídos explicitamente para clareza, conformidade e auditoria.

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM anon;

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 5: COMENTÁRIOS
-- ════════════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) IS
  'RPC transacional de enqueue de mensagens para agrupamento (v1 — corrigida). '
  'Dedup via UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL. '
  'Validação completa de duplicata: company_id, conversation_id, batch_id, batch_message_id '
  'e pertencimento cruzado em agent_message_batches e agent_message_batch_messages. '
  'Limites atômicos: 50 mensagens/lote, 100.000 chars de texto/lote. '
  'BATCH_LIMIT_REACHED → rollback completo (sem órfão em APM). '
  'retry_pending → pending ao receber nova mensagem (preserva attempts/last_error). '
  'Timestamps normalizados: received_at futuro > 5min → now(); '
  'provider_timestamp futuro > 30min → NULL. '
  'Contadores e deadline retornados via RETURNING (valores exatos persistidos). '
  'Acesso exclusivo via service_role.';


-- =====================================================
-- ROLLBACK MANUAL (não executar automaticamente)
-- =====================================================
--
-- Pré-condições:
--   1. feature desabilitada (message_grouping_window_s = 0)
--   2. zero lotes pending/retry_pending
--   3. zero registros com result = 'buffered'
--
-- PASSO 1 — Remover FKs e índices adicionados:
--
--   ALTER TABLE public.agent_processed_messages
--     DROP CONSTRAINT IF EXISTS apm_batch_id_fkey,
--     DROP CONSTRAINT IF EXISTS apm_batch_message_id_fkey;
--
--   DROP INDEX IF EXISTS idx_apm_batch_id;
--   DROP INDEX IF EXISTS idx_apm_batch_message_id;
--   DROP INDEX IF EXISTS idx_apm_instance_id;
--   DROP INDEX IF EXISTS apm_dedup_router;
--   DROP INDEX IF EXISTS apm_dedup_enqueue;
--
-- PASSO 2 — Restaurar PK original em uazapi_message_id:
--
--   ALTER TABLE public.agent_processed_messages
--     DROP CONSTRAINT IF EXISTS agent_processed_messages_id_pkey;
--
--   ALTER TABLE public.agent_processed_messages
--     ADD CONSTRAINT agent_processed_messages_pkey PRIMARY KEY (uazapi_message_id);
--
-- PASSO 3 — Remover colunas adicionadas:
--
--   -- Verificar antes:
--   -- SELECT COUNT(*) FROM public.agent_processed_messages WHERE id IS NOT NULL;
--   ALTER TABLE public.agent_processed_messages
--     DROP COLUMN IF EXISTS id,
--     DROP COLUMN IF EXISTS instance_id;
--
-- PASSO 4 — Restaurar RPC para a versão da Migration C (150000):
--   Recriar a função com o corpo da migration anterior.
--
-- =====================================================

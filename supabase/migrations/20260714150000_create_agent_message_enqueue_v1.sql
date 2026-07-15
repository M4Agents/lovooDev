-- =====================================================
-- MIGRATION: RPC agent_message_enqueue_v1
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Agente Conversacional (Migration C)
--
-- Propósito:
--   Criar a RPC transacional responsável por receber uma mensagem inbound
--   elegível para agrupamento e inseri-la atomicamente no lote correto.
--   Toda a sequência — deduplicação, criação/localização do lote, inserção
--   da mensagem, renovação do deadline e rastreamento em agent_processed_messages —
--   ocorre em uma única transação PostgreSQL. Não existe estado parcial possível.
--
-- Comportamento geral:
--   1. Valida parâmetros e multi-tenant.
--   2. Tenta INSERT em agent_processed_messages (dedup gate).
--      - Conflito (23505): verifica estado existente.
--        * result='buffered' → duplicata saudável → retorna duplicate=true.
--        * outro result → estado incompatível → RAISE EXCEPTION (fail closed).
--   3. UPSERT em agent_message_batches via ON CONFLICT no índice parcial
--      agent_message_batches_open_unique.
--   4. INSERT em agent_message_batch_messages (ON CONFLICT DO NOTHING como proteção extra).
--      - 0 linhas após o INSERT → inconsistência de dados → RAISE EXCEPTION.
--   5. UPDATE counters/deadline no lote SOMENTE após confirmar insert da mensagem.
--      Duplicatas nunca renovam o deadline.
--   6. UPDATE agent_processed_messages com batch_id e batch_message_id.
--   7. RETURN JSONB estruturado.
--
-- Lote existente pending/retry_pending:
--   A nova mensagem é adicionada ao lote existente e renova o deadline.
--   Lote retry_pending permanece retry_pending (backoff preservado).
--
-- Lote existente processing:
--   O índice parcial não cobre 'processing', portanto um novo lote 'pending'
--   é criado para a nova mensagem.
--
-- Limites (V1 — sem rejeição por limite na RPC):
--   Os campos message_count e total_text_length são rastreados com precisão.
--   O Router (etapa futura) usará esses valores para decidir sobre novos lotes.
--   Documentado como limitação aceita de V1.
--
-- Pré-requisitos:
--   - Migration A: 20260714130000_add_buffered_to_agent_processed_messages.sql
--   - Migration B: 20260714140000_create_agent_message_batches.sql
--   - public.set_updated_at() (existente)
--
-- Rollback: ver instruções ao final deste arquivo.
-- =====================================================


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 1: Adicionar colunas de rastreamento a agent_processed_messages
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Motivo: a RPC enfileira a mensagem e faz um UPDATE final em
-- agent_processed_messages para associar o registro ao lote e à mensagem
-- individual. Sem essas colunas, o UPDATE não é possível e a cadeia de
-- rastreabilidade (provider_message_id → APM → batch_message → batch)
-- fica quebrada.
--
-- Impacto: puramente aditivo. Colunas nullable — linhas existentes ficam com
-- NULL (correto: não são mensagens buffered). Não altera índices, RLS ou
-- nenhum comportamento existente.
--
-- IF NOT EXISTS: idempotente para reexecução.

ALTER TABLE public.agent_processed_messages
  ADD COLUMN IF NOT EXISTS batch_id         UUID NULL,
  ADD COLUMN IF NOT EXISTS batch_message_id UUID NULL;

COMMENT ON COLUMN public.agent_processed_messages.batch_id IS
  'UUID do lote em agent_message_batches ao qual esta mensagem foi associada. '
  'NULL para mensagens processadas pelo fluxo normal (result != buffered).';

COMMENT ON COLUMN public.agent_processed_messages.batch_message_id IS
  'UUID do registro em agent_message_batch_messages correspondente a esta mensagem. '
  'NULL para mensagens processadas pelo fluxo normal (result != buffered).';


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 2: RPC agent_message_enqueue_v1
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.agent_message_enqueue_v1(
  -- ── Parâmetros obrigatórios (sem DEFAULT) ────────────────────────────────
  -- Em PostgreSQL, parâmetros sem DEFAULT não podem vir após os com DEFAULT.
  p_company_id                  UUID,
  p_conversation_id             UUID,
  p_window_seconds              INT,
  -- p_provider_message_id = uazapi_message_id do evento (payload.message.id)
  p_provider_message_id         TEXT,
  p_instance_id                 UUID,

  -- ── Parâmetros opcionais (com DEFAULT) ───────────────────────────────────
  p_assignment_id               UUID        DEFAULT NULL,
  p_channel                     TEXT        DEFAULT 'whatsapp',
  p_max_batch_duration_seconds  INT         DEFAULT 120,
  p_message_text                TEXT        DEFAULT NULL,
  p_message_type                TEXT        DEFAULT 'text',
  -- p_provider_timestamp: do WhatsApp/Uazapi. Pode ser NULL. Usado apenas
  --   para ordenação e auditoria — nunca para cálculo de deadline.
  -- p_received_at: quando o backend recebeu a mensagem. Default: now().
  p_provider_timestamp          TIMESTAMPTZ DEFAULT NULL,
  p_received_at                 TIMESTAMPTZ DEFAULT NULL,
  -- Dados brutos do evento para reconstrução no flush.
  -- Deve ser objeto JSONB. Não armazenar credenciais ou headers internos.
  p_payload                     JSONB       DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Constantes de limite ─────────────────────────────────────────────────
  -- V1: limites validados apenas para parâmetros individuais.
  -- Limites de lote (max_messages_per_batch, max_text_length) são rastreados
  -- nos contadores e serão aplicados pelo Router (etapa futura).
  c_max_window_seconds  CONSTANT INT := 120;      -- janela máxima de debounce
  c_max_batch_duration  CONSTANT INT := 600;      -- duração absoluta máxima do lote (10 min)
  c_max_msg_id_len      CONSTANT INT := 512;      -- chars máx de provider_message_id
  c_max_msg_type_len    CONSTANT INT := 50;       -- chars máx de message_type
  c_max_msg_text_len    CONSTANT INT := 10000;    -- chars máx de message_text
  c_max_payload_bytes   CONSTANT INT := 65536;    -- 64 KB máx de payload

  -- ── Variáveis de trabalho ────────────────────────────────────────────────
  v_now                 TIMESTAMPTZ;
  v_max_dur_interval    INTERVAL;
  v_conv_company        UUID;
  v_inst_company        UUID;
  v_batch_id            UUID;
  v_batch_status        TEXT;
  v_batch_msg_count     INT;
  v_batch_text_len      INT;
  v_batch_max_deadline  TIMESTAMPTZ;
  v_batch_message_id    UUID;
  v_final_deadline      TIMESTAMPTZ;
  v_text_len            INT;
  v_apm_rows            INT;
  v_msg_rows            INT;
  v_existing_result     TEXT;
  v_existing_batch_id   UUID;
  v_existing_msg_id     UUID;

BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 1: VALIDAÇÃO DE PARÂMETROS
  -- ══════════════════════════════════════════════════════════════════════════
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

  -- window_seconds deve ser inteiro entre 1 e 120.
  -- O tipo INT já garante que não é decimal (o client enviando float causaria cast error).
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > c_max_window_seconds THEN
    RAISE EXCEPTION 'INVALID_PARAM: window_seconds deve ser inteiro entre 1 e %', c_max_window_seconds
      USING ERRCODE = 'P0001';
  END IF;

  -- max_batch_duration_seconds: opcional, mas se informado deve ser válido.
  IF p_max_batch_duration_seconds IS NOT NULL
    AND (p_max_batch_duration_seconds <= 0 OR p_max_batch_duration_seconds > c_max_batch_duration)
  THEN
    RAISE EXCEPTION 'INVALID_PARAM: max_batch_duration_seconds deve estar entre 1 e %', c_max_batch_duration
      USING ERRCODE = 'P0001';
  END IF;

  -- payload deve ser objeto JSONB (não array, não escalar).
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


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 2: INICIALIZAÇÃO
  -- ══════════════════════════════════════════════════════════════════════════

  -- Fonte temporal única e confiável para todos os cálculos de deadline.
  -- Timestamps externos (p_provider_timestamp, p_received_at) são usados
  -- apenas para ordenação e auditoria — nunca para calcular deadlines.
  v_now            := now();
  v_text_len       := COALESCE(length(p_message_text), 0);
  v_max_dur_interval := (COALESCE(p_max_batch_duration_seconds, 120) || ' seconds')::interval;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 3: VALIDAÇÃO MULTI-TENANT
  -- ══════════════════════════════════════════════════════════════════════════
  -- Não confiar apenas nos IDs recebidos como parâmetro.
  -- Validar pertencimento de cada recurso à empresa informada no banco.

  -- 3a. Conversa: deve existir e pertencer a p_company_id.
  SELECT company_id INTO v_conv_company
  FROM public.chat_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND OR v_conv_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: conversa nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3b. Instância: deve existir e pertencer a p_company_id.
  -- Relação confirmada: whatsapp_life_instances.company_id FK → companies.id
  SELECT company_id INTO v_inst_company
  FROM public.whatsapp_life_instances
  WHERE id = p_instance_id;

  IF NOT FOUND OR v_inst_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: instancia nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3c. Assignment (quando informado): deve pertencer a p_company_id.
  -- Não validamos is_active aqui: o Router já validou antes de chamar a RPC.
  -- Um assignment que se tornou inativo entre o Router e o enqueue é aceitável
  -- para o V1 — a revalidação ocorre no flush pelo messageBufferService.
  IF p_assignment_id IS NOT NULL THEN
    PERFORM 1 FROM public.company_agent_assignments
    WHERE id = p_assignment_id
      AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TENANT_VIOLATION: assignment nao encontrado ou nao pertence a empresa informada'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 4: DEDUP EM AGENT_PROCESSED_MESSAGES (gate atômico)
  -- ══════════════════════════════════════════════════════════════════════════
  -- INSERT atômico usando PK uazapi_message_id.
  -- Se a mensagem já existe (23505): verificar o estado existente.
  -- Se a mensagem é nova: continuar com os passos seguintes.
  --
  -- Nota: p_provider_message_id = event.uazapi_message_id (payload.message.id do Uazapi).
  -- São o mesmo ID. A nomenclatura interna usa provider_message_id para clareza.

  INSERT INTO public.agent_processed_messages (
    uazapi_message_id,
    conversation_id,
    company_id,
    assignment_id,
    result
  ) VALUES (
    p_provider_message_id,
    p_conversation_id,
    p_company_id,
    p_assignment_id,
    'buffered'
  ) ON CONFLICT (uazapi_message_id) DO NOTHING;

  GET DIAGNOSTICS v_apm_rows = ROW_COUNT;

  IF v_apm_rows = 0 THEN
    -- Mensagem já registrada. Verificar estado.
    SELECT result, batch_id, batch_message_id
    INTO v_existing_result, v_existing_batch_id, v_existing_msg_id
    FROM public.agent_processed_messages
    WHERE uazapi_message_id = p_provider_message_id;

    IF v_existing_result = 'buffered' THEN
      -- Duplicata saudável: esta mensagem já está no buffer.
      -- Não renovar deadline, não incrementar contadores.
      RETURN jsonb_build_object(
        'ok',               true,
        'inserted',         false,
        'duplicate',        true,
        'batch_id',         v_existing_batch_id,
        'batch_message_id', v_existing_msg_id,
        'reason',           'already_buffered'
      );
    ELSE
      -- Estado incompatível: a mensagem foi processada por outro caminho
      -- (ex: fluxo normal sem buffer, ou erro anterior).
      -- Falhar de forma fechada — não descartar silenciosamente.
      RAISE EXCEPTION
        'INCOMPATIBLE_STATE: mensagem provider_message_id=% ja registrada com result=%, impossibilitando agrupamento',
        p_provider_message_id,
        COALESCE(v_existing_result, 'null')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 5: LOCALIZAR OU CRIAR LOTE ABERTO
  -- ══════════════════════════════════════════════════════════════════════════
  -- ON CONFLICT targeta o índice parcial agent_message_batches_open_unique:
  --   UNIQUE(company_id, conversation_id, channel) WHERE status IN ('pending', 'retry_pending')
  --
  -- Caso A — Sem lote aberto (status = 'processing' ou nenhum lote):
  --   INSERT cria novo lote 'pending'.
  --
  -- Caso B — Lote 'pending' ou 'retry_pending' existente:
  --   ON CONFLICT aciona DO UPDATE SET updated_at = now() (minimal).
  --   O RETURNING retorna o lote existente com seus valores atuais.
  --   A renovação real do deadline ocorre no PASSO 7 (após confirmar insert).
  --
  -- Lote 'retry_pending': tratado como 'pending'. A nova mensagem é adicionada
  -- ao lote existente. O lote permanece retry_pending; será processado após
  -- max(deadline_at, next_attempt_at) no cron.
  --
  -- Os valores de deadline no INSERT (linha de INSERT) são apenas para o Caso A
  -- (novo lote). Para o Caso B (lote existente), o deadline real é atualizado
  -- no PASSO 7, não aqui.

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
    updated_at = now()  -- mínimo para acionar RETURNING com valores atuais do lote
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


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 6: INSERIR MENSAGEM NO LOTE
  -- ══════════════════════════════════════════════════════════════════════════
  -- ON CONFLICT DO NOTHING: proteção defensiva secundária de dedup por
  -- (company_id, instance_id, provider_message_id).
  -- Em operação normal, o dedup do PASSO 4 (APM) impede que chegue aqui
  -- uma mensagem já presente em batch_messages.
  --
  -- p_provider_timestamp: armazenado como valor externo para ordenação/auditoria.
  -- Pode ser NULL, inválido ou futuro — não afeta o deadline (calculado no PASSO 7).
  --
  -- p_received_at: fallback para now() se não informado.

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
    p_provider_timestamp,
    COALESCE(p_received_at, v_now),
    p_message_text,
    COALESCE(p_message_type, 'text'),
    COALESCE(p_payload, '{}')
  )
  ON CONFLICT (company_id, instance_id, provider_message_id) DO NOTHING
  RETURNING id INTO v_batch_message_id;

  GET DIAGNOSTICS v_msg_rows = ROW_COUNT;

  IF v_msg_rows = 0 THEN
    -- Mensagem passou pelo dedup APM (PASSO 4) mas colidiu no índice de batch_messages.
    -- Isso indica inconsistência de dados — os dois índices deveriam ter o mesmo resultado.
    -- Falhar de forma fechada. A transação fará rollback completo (APM + lote incluídos).
    RAISE EXCEPTION
      'DEDUP_INCONSISTENCY: mensagem foi inserida em agent_processed_messages mas ja existe em agent_message_batch_messages. provider_message_id=%. Verifique integridade dos dados.',
      p_provider_message_id
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 7: RENOVAR DEADLINE E ATUALIZAR CONTADORES DO LOTE
  -- ══════════════════════════════════════════════════════════════════════════
  -- SOMENTE aqui, após confirmar que a mensagem foi efetivamente inserida.
  -- Duplicatas nunca chegam a este passo.
  --
  -- Deadline: calculado com v_now (servidor) — não com timestamps externos.
  -- LEAST: garante que deadline_at nunca ultrapasse max_deadline_at (evita starvation).
  --
  -- Contadores: incrementos atômicos (message_count + 1, total_text_length + v_text_len).
  -- Não baseados em snapshot v_batch_msg_count — seguros para concorrência.

  v_final_deadline := LEAST(
    v_now + (p_window_seconds || ' seconds')::interval,
    v_batch_max_deadline
  );

  UPDATE public.agent_message_batches SET
    deadline_at       = v_final_deadline,
    last_message_at   = v_now,
    message_count     = message_count + 1,
    total_text_length = total_text_length + v_text_len,
    updated_at        = v_now
  WHERE id = v_batch_id;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 8: ASSOCIAR LOTE AO REGISTRO DE AGENT_PROCESSED_MESSAGES
  -- ══════════════════════════════════════════════════════════════════════════
  -- Preencher a cadeia de rastreabilidade:
  --   provider_message_id → agent_processed_messages → batch_message → batch

  UPDATE public.agent_processed_messages SET
    batch_id         = v_batch_id,
    batch_message_id = v_batch_message_id
  WHERE uazapi_message_id = p_provider_message_id;


  -- ══════════════════════════════════════════════════════════════════════════
  -- PASSO 9: RETORNAR RESULTADO ESTRUTURADO
  -- ══════════════════════════════════════════════════════════════════════════
  -- message_count e total_text_length no retorno são aproximados:
  -- v_batch_msg_count é um snapshot do momento do UPSERT do lote. Em cenários
  -- de alta concorrência, outro enqueue pode ter incrementado os contadores
  -- antes deste UPDATE. O valor retornado pode ser menor que o real.
  -- Usar apenas como estimativa — consultar o lote para valor exato.

  RETURN jsonb_build_object(
    'ok',                true,
    'inserted',          true,
    'duplicate',         false,
    'batch_id',          v_batch_id,
    'batch_message_id',  v_batch_message_id,
    'batch_status',      v_batch_status,
    'deadline_at',       v_final_deadline,
    'max_deadline_at',   v_batch_max_deadline,
    'message_count',     v_batch_msg_count + 1,   -- aproximado (ver nota acima)
    'total_text_length', v_batch_text_len + v_text_len,
    'reason',            'buffered'
  );

END;
$$;


-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCO 3: SEGURANÇA — REVOKE E GRANT
-- ════════════════════════════════════════════════════════════════════════════════
--
-- REVOKE ALL FROM PUBLIC: revoga grants implícitos concedidos ao criar a função.
-- O REVOKE adicional de anon e authenticated é redundante com PUBLIC mas explícito
-- por clareza e conformidade com o padrão do projeto.
-- Apenas service_role (backend) pode executar esta função.

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
-- BLOCO 4: COMENTÁRIOS
-- ════════════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) IS
  'RPC transacional de enqueue de mensagens para agrupamento. '
  'Executa em uma única transação: dedup em agent_processed_messages, '
  'localização/criação do lote, inserção da mensagem, renovação do deadline '
  'e associação de batch_id/batch_message_id no registro APM. '
  'Nenhum estado parcial é possível. '
  'Duplicatas (result = buffered) retornam ok=true, inserted=false sem efeitos. '
  'Estados incompatíveis (result != buffered) falham com RAISE EXCEPTION. '
  'Acesso exclusivo via service_role.';


-- =====================================================
-- ROLLBACK MANUAL (não executar automaticamente)
--
-- Para reverter esta migration:
--
-- 1. Garantir que conversationRouter.js não está chamando esta RPC
--    (a integração só ocorre em etapa futura — antes disso, sem impacto).
--
-- 2. Remover a função:
--    DROP FUNCTION IF EXISTS public.agent_message_enqueue_v1(
--      UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
--    );
--
-- 3. Remover as colunas adicionadas (SOMENTE se não houver dados relevantes):
--    -- Verificar antes:
--    SELECT COUNT(*) FROM public.agent_processed_messages
--      WHERE batch_id IS NOT NULL OR batch_message_id IS NOT NULL;
--    -- Se zero ou dados podem ser descartados:
--    ALTER TABLE public.agent_processed_messages
--      DROP COLUMN IF EXISTS batch_id,
--      DROP COLUMN IF EXISTS batch_message_id;
--
-- 4. As tabelas agent_message_batches e agent_message_batch_messages
--    são revertidas pela Migration B (rollback separado).
-- =====================================================

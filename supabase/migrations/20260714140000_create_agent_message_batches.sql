-- =====================================================
-- MIGRATION: Criar tabelas de agrupamento de mensagens do agente
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Agente Conversacional (Migration B)
--
-- Propósito:
--   Criar a estrutura de persistência para o mecanismo de debounce de mensagens
--   WhatsApp. Cada conversa possui no máximo um lote aberto (pending/retry_pending)
--   por canal. Novas mensagens renovam o prazo do lote via RPC atômica (Etapa 3).
--   O processamento ocorre via Vercel Cron (implementado em etapas futuras).
--
-- Tabelas criadas:
--   - public.agent_message_batches       — lotes de processamento por conversa
--   - public.agent_message_batch_messages — mensagens individuais do lote
--
-- Não criado nesta migration:
--   - RPC de enqueue (Etapa 3)
--   - RPC de claim   (Etapa 4)
--   - RPC de recovery/mark
--   - Código de aplicação
--
-- State machine de lotes:
--   pending → processing → processed
--   pending → cancelled
--   processing → retry_pending → processing (retry)
--   processing → failed
--   processing → cancelled
--   retry_pending → failed
--   retry_pending → cancelled
--
-- Decisões de schema:
--   FK composta (company_id, conversation_id) → chat_conversations não foi criada:
--   chat_conversations não possui UNIQUE(company_id, id), apenas UNIQUE(company_id,
--   instance_id, contact_phone). A consistência multi-tenant será garantida pela
--   RPC de enqueue com SELECT explícito antes de qualquer INSERT.
--
--   instance_id em agent_message_batch_messages é NOT NULL mas sem FK:
--   instance_id é sempre UUID quando o PASSO 6 do webhook dispara (garantido por
--   early return). FK com ON DELETE SET NULL tornaria o campo nullable e quebraria
--   o índice de deduplicação. O UUID é preservado como valor histórico.
--
-- Dependências:
--   public.companies
--   public.chat_conversations
--   public.company_agent_assignments
--   public.set_updated_at() — função já existente no banco
--   20260714130000_add_buffered_to_agent_processed_messages.sql (Migration A)
--
-- Rollback: ver instruções ao final deste arquivo.
-- =====================================================


-- ════════════════════════════════════════════════════════════════════════════════
-- TABELA 1: public.agent_message_batches
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Representa um lote de mensagens de uma conversa aguardando processamento.
-- Existe no máximo um lote pending ou retry_pending por (company_id, conversation_id, channel).
-- Um lote processing pode coexistir com um novo lote pending (para mensagens
-- chegadas após o claim).

CREATE TABLE public.agent_message_batches (

  -- ── Identificadores ─────────────────────────────────────────────────────────
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Contexto multi-tenant ───────────────────────────────────────────────────
  -- Ambas as FKs são separadas: chat_conversations não tem UNIQUE(company_id, id).
  -- A consistência entre company_id e conversation_id é validada pela RPC de enqueue.
  company_id      UUID        NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,

  conversation_id UUID        NOT NULL
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,

  -- Assignment no momento do enqueue — valor histórico, não revalidado aqui.
  -- A RPC de flush resolve o effective_assignment_id atual no momento do processamento.
  -- ON DELETE SET NULL: remoção de assignment preserva o lote e seu histórico.
  enqueue_assignment_id UUID  NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL,

  -- ── Canal ───────────────────────────────────────────────────────────────────
  -- Nesta implementação, apenas 'whatsapp' é usado.
  -- O campo existe para extensibilidade futura.
  channel         TEXT        NOT NULL DEFAULT 'whatsapp',

  -- ── State machine ───────────────────────────────────────────────────────────
  -- pending      — aguardando deadline (estado inicial)
  -- processing   — reivindicado pelo cron (claim atômico)
  -- retry_pending — falha transitória; aguardando next_attempt_at
  -- processed    — executado com sucesso
  -- failed       — falha definitiva (attempts >= máximo ou erro não recuperável)
  -- cancelled    — cancelado por mudança de estado da conversa ou assignment
  status          TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT agent_message_batches_status_check
    CHECK (status IN (
      'pending',
      'processing',
      'retry_pending',
      'processed',
      'failed',
      'cancelled'
    )),

  -- ── Controle de tempo ───────────────────────────────────────────────────────
  -- deadline_at: prazo renovável — last_message_at + window_s (renovado pelo enqueue)
  -- max_deadline_at: limite absoluto — first_message_at + 2 min (evita debounce infinito)
  -- next_attempt_at: próxima tentativa em retry_pending (backoff)
  deadline_at     TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  first_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_deadline_at  TIMESTAMPTZ NOT NULL,

  -- ── Controle de execução ────────────────────────────────────────────────────
  locked_at       TIMESTAMPTZ NULL,  -- preenchido no claim, para recovery de presos
  attempts        INT         NOT NULL DEFAULT 0
    CONSTRAINT agent_message_batches_attempts_check CHECK (attempts >= 0),

  -- ── Métricas do lote ────────────────────────────────────────────────────────
  message_count       INT     NOT NULL DEFAULT 0
    CONSTRAINT agent_message_batches_message_count_check CHECK (message_count >= 0),
  total_text_length   INT     NOT NULL DEFAULT 0
    CONSTRAINT agent_message_batches_text_length_check CHECK (total_text_length >= 0),

  -- ── Diagnóstico de falhas ───────────────────────────────────────────────────
  last_error      TEXT        NULL,
  last_error_code TEXT        NULL,

  -- ── Timestamps de encerramento ──────────────────────────────────────────────
  processed_at    TIMESTAMPTZ NULL,
  cancelled_at    TIMESTAMPTZ NULL,
  cancellation_reason TEXT    NULL,

  -- ── Auditoria ───────────────────────────────────────────────────────────────
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()

);

-- ── Trigger de updated_at ────────────────────────────────────────────────────
-- Reutiliza public.set_updated_at() já existente no banco.
-- Padrão adotado pelas migrations mais recentes do projeto.

CREATE TRIGGER trg_agent_message_batches_updated_at
  BEFORE UPDATE ON public.agent_message_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════════
-- TABELA 2: public.agent_message_batch_messages
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Mensagens individuais pertencentes a um lote.
-- Imutáveis após inserção — sem updated_at.
-- Deduplicadas por (company_id, instance_id, provider_message_id).

CREATE TABLE public.agent_message_batch_messages (

  -- ── Identificadores ─────────────────────────────────────────────────────────
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE: mensagens removidas com o lote.
  batch_id        UUID        NOT NULL
    REFERENCES public.agent_message_batches(id) ON DELETE CASCADE,

  -- ── Contexto de rastreabilidade ─────────────────────────────────────────────
  -- Armazenados explicitamente para queries diretas sem JOIN com agent_message_batches.
  company_id      UUID        NOT NULL,
  conversation_id UUID        NOT NULL,

  -- ── Identificação da mensagem no provedor ───────────────────────────────────
  -- provider_message_id: ID externo da mensagem (ex: Uazapi message.id)
  provider_message_id TEXT    NOT NULL,

  -- instance_id: UUID da instância WhatsApp no momento do recebimento.
  -- NOT NULL: garantido pelo webhook (early return se instância não resolvida).
  -- SEM FK para whatsapp_life_instances: ON DELETE SET NULL tornaria o campo
  -- nullable e quebraria o índice de deduplicação. UUID preservado como histórico.
  instance_id     UUID        NOT NULL,

  -- ── Timestamps da mensagem ──────────────────────────────────────────────────
  -- provider_timestamp: timestamp do WhatsApp/Uazapi. Pode ser NULL se ausente
  -- ou inválido no payload. Usado na ordenação (NULLS LAST) antes de received_at.
  provider_timestamp TIMESTAMPTZ NULL,

  -- received_at: quando o backend recebeu a mensagem (sempre confiável).
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Conteúdo ────────────────────────────────────────────────────────────────
  message_text    TEXT        NULL,        -- NULL para mensagens sem texto (mídia, etc.)
  message_type    TEXT        NULL DEFAULT 'text',

  -- payload: dados brutos do evento para reconstrução completa no flush.
  -- Não armazenar conteúdo sensível desnecessário — responsabilidade da RPC/backend.
  payload         JSONB       NOT NULL DEFAULT '{}',

  -- ── Auditoria ───────────────────────────────────────────────────────────────
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()

);


-- ════════════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS E ÍNDICES
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Máximo 1 lote aberto por (company_id, conversation_id, channel) ────────
-- "Aberto" = pending OU retry_pending.
-- Permite coexistência de um lote processing com um novo lote pending.
-- O índice único parcial aplica a regra de forma atômica no banco.

CREATE UNIQUE INDEX agent_message_batches_open_unique
  ON public.agent_message_batches(company_id, conversation_id, channel)
  WHERE status IN ('pending', 'retry_pending');

-- ── 2. Claim de lotes elegíveis (principal acesso do cron) ───────────────────
-- Suporta a query:
--   WHERE status IN ('pending', 'retry_pending')
--     AND deadline_at <= now()
--     AND (next_attempt_at IS NULL OR next_attempt_at <= now())
--   ORDER BY deadline_at ASC

CREATE INDEX idx_agent_message_batches_claim
  ON public.agent_message_batches(status, deadline_at, next_attempt_at)
  WHERE status IN ('pending', 'retry_pending');

-- ── 3. Recovery de lotes presos em processing ────────────────────────────────
-- Suporta a query:
--   WHERE status = 'processing' AND locked_at < now() - interval '5 minutes'

CREATE INDEX idx_agent_message_batches_recovery
  ON public.agent_message_batches(status, locked_at)
  WHERE status = 'processing';

-- ── 4. Deduplicação de mensagens do provedor ─────────────────────────────────
-- Garante que a mesma mensagem não entre no buffer duas vezes.
-- Chave: (company_id, instance_id, provider_message_id) — todos NOT NULL.
-- instance_id é NOT NULL por design (garantido pelo webhook).

CREATE UNIQUE INDEX agent_message_batch_messages_dedup
  ON public.agent_message_batch_messages(company_id, instance_id, provider_message_id);

-- ── 5. Carregamento de mensagens de um lote com ordenação determinística ──────
-- Suporta a query do flush:
--   WHERE batch_id = $1
--   ORDER BY provider_timestamp ASC NULLS LAST, received_at ASC, id ASC

CREATE INDEX idx_agent_message_batch_messages_order
  ON public.agent_message_batch_messages(batch_id, provider_timestamp ASC NULLS LAST, received_at ASC, id ASC);


-- ════════════════════════════════════════════════════════════════════════════════
-- RLS E PRIVILÉGIOS
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Acesso exclusivo via service_role (backend).
-- RLS habilitado sem policies = bloqueio total para anon e authenticated.
-- Padrão idêntico ao de agent_processed_messages e agent_processing_locks.

ALTER TABLE public.agent_message_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_message_batch_messages  ENABLE ROW LEVEL SECURITY;

-- Sem policies criadas intencionalmente.
-- authenticated e anon NÃO têm acesso a estas tabelas.
-- service_role tem acesso total (bypassa RLS por padrão no Supabase).

-- Revokes explícitos para reforçar segurança além da ausência de policies.
-- Proteção contra grants implícitos concedidos via PUBLIC no futuro.

REVOKE ALL ON TABLE public.agent_message_batches        FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_message_batches        FROM anon;
REVOKE ALL ON TABLE public.agent_message_batches        FROM authenticated;

REVOKE ALL ON TABLE public.agent_message_batch_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_message_batch_messages FROM anon;
REVOKE ALL ON TABLE public.agent_message_batch_messages FROM authenticated;


-- ════════════════════════════════════════════════════════════════════════════════
-- COMENTÁRIOS
-- ════════════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE public.agent_message_batches IS
  'Lotes de mensagens WhatsApp aguardando processamento pelo agente conversacional. '
  'Implementa debounce: cada nova mensagem renova o prazo do lote via RPC atômica. '
  'No máximo um lote pending/retry_pending por (company_id, conversation_id, channel). '
  'Acesso exclusivo via service_role — RLS sem policies bloqueia frontend.';

COMMENT ON TABLE public.agent_message_batch_messages IS
  'Mensagens individuais pertencentes a um lote de agrupamento. '
  'Imutáveis após inserção. Deduplicadas por (company_id, instance_id, provider_message_id). '
  'instance_id é NOT NULL (garantido pelo webhook) mas sem FK para preservar histórico. '
  'Acesso exclusivo via service_role — RLS sem policies bloqueia frontend.';

COMMENT ON COLUMN public.agent_message_batches.enqueue_assignment_id IS
  'Assignment no momento da chegada da mensagem (valor histórico). '
  'Não revalidado automaticamente. A RPC de flush resolve o assignment efetivo atual.';

COMMENT ON COLUMN public.agent_message_batches.deadline_at IS
  'Prazo renovável: last_message_at + window_s. '
  'Renovado pela RPC de enqueue apenas quando uma nova mensagem é efetivamente inserida. '
  'Mensagem duplicada não renova o prazo.';

COMMENT ON COLUMN public.agent_message_batches.max_deadline_at IS
  'Limite absoluto do lote: first_message_at + 2 minutos (configurável no backend). '
  'Evita debounce infinito em conversas com mensagens contínuas. '
  'deadline_at = MIN(last_message_at + window_s, max_deadline_at).';

COMMENT ON COLUMN public.agent_message_batches.next_attempt_at IS
  'Horário da próxima tentativa em status retry_pending. '
  'Calculado com backoff exponencial: tentativa 2 = +30s, tentativa 3 = +2min.';

COMMENT ON COLUMN public.agent_message_batch_messages.instance_id IS
  'UUID da instância WhatsApp no momento do recebimento (valor histórico). '
  'NOT NULL: garantido pelo early return do webhook. '
  'Sem FK para whatsapp_life_instances: ON DELETE SET NULL tornaria o campo nullable '
  'e quebraria o índice de deduplicação.';

COMMENT ON COLUMN public.agent_message_batch_messages.provider_timestamp IS
  'Timestamp da mensagem no WhatsApp/Uazapi. Pode ser NULL se ausente ou inválido. '
  'Usado na ordenação com NULLS LAST, antes de received_at e id.';


-- =====================================================
-- ROLLBACK MANUAL (não executar automaticamente)
--
-- Pré-condições:
--   1. feature desabilitada (message_grouping_window_s = 0 em todos os agentes)
--   2. cron interrompido (linha removida do vercel.json)
--   3. lotes processing resolvidos ou cancelados manualmente
--
-- Para reverter:
--
-- -- Opcionalmente preservar dados para auditoria antes de remover:
-- -- CREATE TABLE _backup_agent_message_batch_messages AS
-- --   SELECT * FROM public.agent_message_batch_messages;
-- -- CREATE TABLE _backup_agent_message_batches AS
-- --   SELECT * FROM public.agent_message_batches;
--
-- -- Remover trigger antes de remover a tabela
-- DROP TRIGGER IF EXISTS trg_agent_message_batches_updated_at
--   ON public.agent_message_batches;
--
-- -- Remover tabelas na ordem correta (dependente primeiro)
-- DROP TABLE IF EXISTS public.agent_message_batch_messages;
-- DROP TABLE IF EXISTS public.agent_message_batches;
--
-- Executar somente após janela de observação mínima de 24h em produção.
-- =====================================================

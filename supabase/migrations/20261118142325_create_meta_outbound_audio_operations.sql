-- =============================================================================
-- Migration: create_meta_outbound_audio_operations
-- Timestamp: 20261118100000
--
-- Objetivo (B3.2-C.2.4):
--   Criar public.meta_outbound_audio_operations para idempotência de envio
--   de áudio outbound Meta WhatsApp Cloud API.
--
-- Identidade de idempotência:
--   UNIQUE (company_id, operation_id).
--   O cliente envia o mesmo operation_id em retries HTTP.
--   O backend faz claim atômico somente created → graph_in_flight.
--
-- Contrato de status (estados de OPERAÇÃO, não de entrega WhatsApp):
--   created          — row reservada, Graph ainda não chamado.
--   graph_in_flight  — claim obtido; Graph em andamento.
--   graph_accepted   — Graph retornou wamid; persistência S3/DB pendente.
--   completed        — S3 + meta_whatsapp_messages + meta_messages confirmados
--                      pelo backend. O CHECK abaixo NÃO verifica essas
--                      dependências sozinho.
--   failed           — terminal na v1 (falha pré-claim ou recusa controlada).
--                      Nova tentativa exige novo operation_id do cliente.
--   unknown          — Graph pode ter sido chamado; resultado indefinido.
--                      Sem retry automático. Sem mint de novo operation_id.
--                      Sem nova chamada Graph para o mesmo operation_id.
--
-- Claim:
--   Somente created → graph_in_flight (CAS no backend).
--   Este CHECK valida coerência do registro, não substitui o CAS.
--   Sem trigger de transição. Sem RPC SECURITY DEFINER nesta migration.
--
-- user_id:
--   UUID do caller autenticado em validateMetaCaller no momento do INSERT.
--   Sem FK para auth.users nem company_users — intencional.
--   Preserva auditoria se o usuário Auth for excluído depois
--   (safe_delete_user_complete existe no banco compartilhado).
--
-- CASCADE:
--   Segue o padrão Meta (meta_messages / meta_whatsapp_messages).
--   Soft delete de empresa/instância (deleted_at) NÃO dispara CASCADE.
--   Hard delete de empresa, instância ou conversa APAGA o histórico.
--
-- Dependências já confirmadas no banco efetivo (B3.2-C.2.3):
--   - mwi_company_id_id_unique UNIQUE (company_id, id)
--   - mc_company_instance_id_unique UNIQUE (company_id, instance_id, id)
--   - public.update_updated_at_column() (0 args, RETURNS trigger)
--
-- RLS:
--   service_role-only. Sem policy authenticated/anon. Sem Realtime.
--   A tabela não é exposta ao frontend.
--
-- Rollback (SOMENTE com aprovação explícita e tabela vazia):
--   DROP TABLE public.meta_outbound_audio_operations;
-- =============================================================================

CREATE TABLE public.meta_outbound_audio_operations (

  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL,
  operation_id     UUID        NOT NULL,

  -- UUID do usuário autenticado no INSERT. Sem FK de propósito.
  user_id          UUID        NOT NULL,

  instance_id      UUID        NOT NULL,
  conversation_id  UUID        NOT NULL,
  audio_sha256     TEXT        NOT NULL,
  status           TEXT        NOT NULL,

  graph_media_id   TEXT        NULL,
  wamid            TEXT        NULL,
  s3_key           TEXT        NULL,
  error_code       TEXT        NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  graph_started_at TIMESTAMPTZ NULL,
  completed_at     TIMESTAMPTZ NULL,

  CONSTRAINT moao_pkey
    PRIMARY KEY (id),

  -- Identidade de idempotência: retries HTTP reutilizam o mesmo par.
  CONSTRAINT moao_company_operation_id_unique
    UNIQUE (company_id, operation_id),

  CONSTRAINT moao_company_fk
    FOREIGN KEY (company_id)
    REFERENCES public.companies(id)
    ON DELETE CASCADE,

  -- Co-tenant com a instância. Requer mwi_company_id_id_unique.
  CONSTRAINT moao_company_instance_fk
    FOREIGN KEY (company_id, instance_id)
    REFERENCES public.meta_whatsapp_instances(company_id, id)
    ON DELETE CASCADE,

  -- Co-tenant com a conversa. Requer mc_company_instance_id_unique.
  CONSTRAINT moao_company_instance_conversation_fk
    FOREIGN KEY (company_id, instance_id, conversation_id)
    REFERENCES public.meta_conversations(company_id, instance_id, id)
    ON DELETE CASCADE,

  CONSTRAINT moao_audio_sha256_check
    CHECK (audio_sha256 ~ '^[a-f0-9]{64}$'),

  CONSTRAINT moao_error_code_check
    CHECK (error_code IS NULL OR char_length(error_code) <= 100),

  CONSTRAINT moao_status_check
    CHECK (status IN (
      'created',
      'graph_in_flight',
      'graph_accepted',
      'completed',
      'failed',
      'unknown'
    )),

  -- Coerência por status. Não substitui o CAS created → graph_in_flight.
  CONSTRAINT moao_status_coherence_check
    CHECK (
      (
        status = 'created'
        AND wamid IS NULL
        AND graph_started_at IS NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'failed'
        AND wamid IS NULL
        AND graph_started_at IS NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'graph_in_flight'
        AND wamid IS NULL
        AND graph_started_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'graph_accepted'
        AND wamid IS NOT NULL
        AND btrim(wamid) <> ''
        AND graph_started_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'completed'
        AND wamid IS NOT NULL
        AND btrim(wamid) <> ''
        AND s3_key IS NOT NULL
        AND btrim(s3_key) <> ''
        AND graph_started_at IS NOT NULL
        AND completed_at IS NOT NULL
      )
      OR (
        status = 'unknown'
        AND wamid IS NULL
        AND graph_started_at IS NOT NULL
        AND completed_at IS NULL
      )
    )
);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.meta_outbound_audio_operations IS
'Idempotência de envio de áudio outbound Meta. '
'Identidade: UNIQUE (company_id, operation_id). '
'Claim atômico somente created → graph_in_flight (CAS no backend). '
'failed é terminal na v1. unknown nunca dispara retry automático nem nova '
'chamada Graph. Estados de operação, não de entrega WhatsApp (accepted/sent/'
'delivered/read). completed só pode ser gravado após o backend confirmar S3, '
'meta_whatsapp_messages e meta_messages; o CHECK de completed não verifica '
'essas dependências. CASCADE segue o padrão Meta: hard delete apaga histórico. '
'service_role-only; sem Realtime; sem acesso frontend.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.operation_id IS
'Identificador de idempotência gerado pelo cliente. '
'UNIQUE com company_id. Retries HTTP devem reenviar o mesmo valor.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.user_id IS
'UUID do usuário autenticado (validateMetaCaller) no momento do INSERT. '
'Sem FK para auth.users nem company_users — intencional: preserva auditoria '
'se o Auth for excluído depois e não bloqueia safe_delete_user_complete.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.status IS
'Estado da OPERAÇÃO de envio, distinto do status de entrega WhatsApp. '
'created | graph_in_flight | graph_accepted | completed | failed | unknown. '
'Claim somente created → graph_in_flight. failed terminal na v1. '
'unknown: sem retry automático e sem mint de novo operation_id.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.audio_sha256 IS
'SHA-256 hexadecimal minúsculo (64 chars) do payload de áudio validado.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.wamid IS
'wamid retornado pela Graph após aceite. NULL até graph_accepted/completed. '
'UNIQUE parcial (instance_id, wamid) WHERE wamid IS NOT NULL.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.s3_key IS
'Chave S3 do áudio outbound. Obrigatória em completed. '
'String vazia ou composta apenas por espaços não é aceita. '
'O CHECK não confirma existência do objeto S3 nem a persistência das mensagens.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.error_code IS
'Código curto de falha (máx. 100 chars). Sem payload bruto Graph.';

COMMENT ON COLUMN public.meta_outbound_audio_operations.updated_at IS
'Atualizado pelo trigger moao_update_updated_at '
'(reutiliza public.update_updated_at_column(); a função não é redefinida).';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Deduplicação defensiva de wamid por instância (wamid pode ser NULL).
CREATE UNIQUE INDEX moao_instance_wamid_unique
  ON public.meta_outbound_audio_operations (instance_id, wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX idx_moao_company_created_at
  ON public.meta_outbound_audio_operations (company_id, created_at DESC);

-- Operações em voo, para reconciliação/timeout operacional no backend.
CREATE INDEX idx_moao_company_graph_in_flight
  ON public.meta_outbound_audio_operations (company_id, graph_started_at)
  WHERE status = 'graph_in_flight';

-- =============================================================================
-- TRIGGER updated_at — reutiliza função existente (não redefinir)
-- =============================================================================

CREATE TRIGGER moao_update_updated_at
  BEFORE UPDATE ON public.meta_outbound_audio_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- RLS + GRANT/REVOKE — service_role-only
-- =============================================================================

ALTER TABLE public.meta_outbound_audio_operations ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY para authenticated ou anon.
-- Sem publicação Realtime. Sem REPLICA IDENTITY FULL.

REVOKE ALL ON TABLE public.meta_outbound_audio_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_outbound_audio_operations FROM anon;
REVOKE ALL ON TABLE public.meta_outbound_audio_operations FROM authenticated;
GRANT ALL ON TABLE public.meta_outbound_audio_operations TO service_role;

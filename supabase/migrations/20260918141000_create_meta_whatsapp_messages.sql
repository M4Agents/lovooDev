-- =============================================================================
-- Meta WhatsApp Cloud API — MVP2 / Migration T1.2 (2C.2)
-- Tabela: public.meta_whatsapp_messages
--
-- Responsabilidade: persistência mínima de mensagens outbound Meta após
--   Graph success em send.js. Correlação com statuses recebidos pelo webhook.
--
-- Escopo MVP2 (outbound-only):
--   - Sem direction (outbound implícito nesta fase)
--   - Sem soft-delete / deleted_at
--   - Sem recipient / to / wa_id / payload bruto / message body
--   - Apenas wamid + status + timestamps de ciclo de vida
--
-- Consistência multi-tenant (T1 — FK composta):
--   FK composta: (company_id, instance_id)
--     → REFERENCES meta_whatsapp_instances(company_id, id)
--   Garante declarativamente que company_id e instance_id
--   pertencem ao mesmo tenant — impossível inserir row com
--   company_id de empresa A e instance_id de empresa B,
--   mesmo via service_role.
--   Depende de: mwi_company_id_id_unique (migration T1.1 / 20260918140000).
--
-- Unicidade (defensiva):
--   UNIQUE(instance_id, meta_message_id) — escopada à instância.
--   Não assume unicidade global do wamid entre WABAs/instâncias distintas.
--
-- RLS: service_role-only para MVP2.
--   Sem policy SELECT para authenticated — acesso bloqueado por RLS default.
--   Policy frontend adicionada em MVP3 se necessário.
--
-- Timestamps de status (para o webhook processor em 2C.4):
--   Preferir timestamp do evento Meta (statuses[].timestamp — epoch Unix)
--   quando presente e válido. Fallback para now() local se ausente.
--   Sem trigger updated_at — código fará updated_at explicitamente.
--
-- OPEN_DESIGN_ITEM — Race webhook vs outbound INSERT:
--   Um webhook de status pode chegar antes do INSERT do wamid em send.js.
--   Estratégia (UNIQUE conflict / upsert / descarte) será decidida em 2C.4.
--   NÃO resolvido nesta migration.
--
-- Rollback (SOMENTE com aprovação explícita):
--   DROP TABLE public.meta_whatsapp_messages;
--   (FK composta exige que T1.2 seja revertida antes de reverter T1.1.)
-- =============================================================================

-- =============================================================================
-- TABELA
-- =============================================================================
CREATE TABLE public.meta_whatsapp_messages (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant: FKs garante co-tenant via constraint composta.
  -- FK simples company_id -> companies para cascade.
  -- FK composta (company_id, instance_id) -> instances(company_id, id)
  --   bloqueia rows com tenant misto.
  company_id       UUID         NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,

  instance_id      UUID         NOT NULL,

  -- Identificador da mensagem retornado pela Meta Graph API (wamid).
  -- Unicidade escopada à instância — não assume unicidade global.
  meta_message_id  TEXT         NOT NULL,

  -- Estado atual. Progressão: accepted -> sent -> delivered -> read.
  -- failed é terminal a partir de qualquer estado.
  -- Atualizado pelo webhook processor (2C.4).
  status           TEXT         NOT NULL DEFAULT 'accepted',

  -- Diagnóstico de falha — somente numérico.
  -- statuses[].errors[].code e statuses[].errors[].error_data.details (subcode).
  -- Nunca armazenar title, message ou payload bruto.
  error_code       INTEGER,
  error_subcode    INTEGER,

  -- Timestamps de ciclo de vida.
  -- accepted_at: timestamp do INSERT em send.js (Graph retornou wamid).
  -- sent/delivered/read/failed_at: preferencialmente timestamp do evento Meta;
  --   fallback para now() local se ausente (decisão do webhook processor).
  accepted_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CHECK: único conjunto de estados válidos para MVP2.
  CONSTRAINT mwm_status_check
    CHECK (status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),

  -- FK composta: garante co-tenant declarativamente.
  -- Requer mwi_company_id_id_unique (T1.1 / 20260918140000).
  CONSTRAINT mwm_company_instance_fk
    FOREIGN KEY (company_id, instance_id)
    REFERENCES public.meta_whatsapp_instances(company_id, id)
    ON DELETE CASCADE,

  -- Unicidade: (instance_id, meta_message_id) — escopada à instância.
  CONSTRAINT mwm_instance_message_id_unique
    UNIQUE (instance_id, meta_message_id)
);

-- Índice operacional: listagem/auditoria por empresa e instância.
-- Sem WHERE predicate — tabela não possui deleted_at nesta fase.
CREATE INDEX idx_mwm_company_instance_created
  ON public.meta_whatsapp_messages (company_id, instance_id, created_at DESC);

-- =============================================================================
-- RLS — service_role-only para MVP2
-- =============================================================================
ALTER TABLE public.meta_whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Sem policy para authenticated ou anon.
-- authenticated: acesso bloqueado por RLS default (sem policy = sem acesso).
-- anon: idem.
-- service_role: bypassa RLS automaticamente (backend).
-- Policy SELECT para frontend (MVP3) adicionada separadamente quando necessário.

-- =============================================================================
-- GRANT / REVOKE
-- =============================================================================
REVOKE ALL ON TABLE public.meta_whatsapp_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_whatsapp_messages FROM anon;
REVOKE ALL ON TABLE public.meta_whatsapp_messages FROM authenticated;
GRANT ALL ON TABLE public.meta_whatsapp_messages TO service_role;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE public.meta_whatsapp_messages IS
'Mensagens outbound Meta WhatsApp Cloud API — MVP2. Persiste wamid retornado pela Graph API para correlação com statuses do webhook. Outbound-only nesta fase. Sem soft-delete, sem dados PII do destinatário.';

COMMENT ON COLUMN public.meta_whatsapp_messages.meta_message_id IS
'wamid retornado pela Meta Graph API após envio bem-sucedido. Unicidade escopada à instância via UNIQUE(instance_id, meta_message_id).';

COMMENT ON COLUMN public.meta_whatsapp_messages.status IS
'Estado atual: accepted (Graph ok) -> sent -> delivered -> read. failed é terminal. Atualizado pelo webhook processor.';

COMMENT ON COLUMN public.meta_whatsapp_messages.error_code IS
'Código numérico Meta do erro de entrega (statuses[].errors[].code). Nunca armazenar title, message ou payload bruto.';

COMMENT ON COLUMN public.meta_whatsapp_messages.accepted_at IS
'Timestamp de aceitação pela Graph API — momento do INSERT inicial em send.js.';

COMMENT ON COLUMN public.meta_whatsapp_messages.updated_at IS
'Atualizado explicitamente pelo código (send.js na criação, webhook processor nas atualizações de status). Sem trigger automático.';

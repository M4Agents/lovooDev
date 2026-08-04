-- =============================================================================
-- Migration: 20260804200000_create_nuvemshop_lgpd_requests
--
-- Cria tabela de auditoria para solicitações LGPD/GDPR da Nuvemshop.
--
-- Registra cada evento recebido (store/redact, customers/redact,
-- customers/data_request) para fins de conformidade e rastreabilidade.
--
-- Etapa 2 (futura): adicionar campos de processamento real
-- (anonymized_at, records_affected, processed_by).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nuvemshop_lgpd_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id        text        NOT NULL,
  topic           text        NOT NULL
    CHECK (topic IN ('store/redact', 'customers/redact', 'customers/data_request')),
  -- Identificadores do recurso alvo (sem PII — apenas IDs)
  customer_id     text        NULL,   -- nuvemshop customer id, se presente
  customer_email  text        NULL,   -- hash do email (nunca plain text)
  -- Estado do processamento
  status          text        NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  -- Rastreabilidade
  correlation_id  text        NULL,
  error_message   text        NULL,
  -- Timestamps
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices operacionais
CREATE INDEX IF NOT EXISTS idx_nvlgpd_company_id
  ON public.nuvemshop_lgpd_requests (company_id);

CREATE INDEX IF NOT EXISTS idx_nvlgpd_store_id
  ON public.nuvemshop_lgpd_requests (store_id);

CREATE INDEX IF NOT EXISTS idx_nvlgpd_status
  ON public.nuvemshop_lgpd_requests (status)
  WHERE status IN ('received', 'processing');

CREATE INDEX IF NOT EXISTS idx_nvlgpd_received_at
  ON public.nuvemshop_lgpd_requests (received_at DESC);

-- RLS: apenas service_role acessa — dados sensíveis de compliance
ALTER TABLE public.nuvemshop_lgpd_requests ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy permissiva: apenas service_role (backend) lê/escreve.
-- Acesso via admin dashboard requer policy explícita futura.

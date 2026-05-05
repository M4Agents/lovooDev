-- Migration: Tabela lead_import_events para observabilidade funcional de importações via API
-- Propósito: permite que o usuário do CRM visualize o histórico de importações da empresa
-- SEPARADA de webhook_api_logs (auditoria técnica interna)
--
-- Regras:
--   - company_id é obrigatório e vem SEMPRE da validação da api_key no backend
--   - payload_summary armazena apenas { name, email, phone } — sem api_key, sem dados sensíveis
--   - escrita exclusiva via RPC SECURITY DEFINER (sem policy de INSERT direta)
--   - leitura restrita a membros ativos da empresa via auth_user_is_company_member

CREATE TABLE public.lead_import_events (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id          UUID         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status              TEXT         NOT NULL CHECK (status IN (
                        'success', 'duplicate', 'error',
                        'rate_limited', 'plan_limit', 'validation_error'
                      )),
  error_code          TEXT,
  error_message       TEXT,
  lead_id             INTEGER      REFERENCES public.leads(id) ON DELETE SET NULL,
  payload_summary     JSONB,
  external_reference  TEXT,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

-- Índice para listagem paginada por empresa (base para UI futura)
CREATE INDEX idx_lie_company_time
  ON public.lead_import_events(company_id, created_at DESC);

-- RLS: membros ativos podem ler eventos da sua empresa
ALTER TABLE public.lead_import_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_import_events_select_members"
  ON public.lead_import_events
  FOR SELECT
  USING (public.auth_user_is_company_member(company_id));

-- Sem policy de INSERT/UPDATE/DELETE — escrita exclusiva via RPC abaixo

-- RPC de inserção (SECURITY DEFINER)
-- company_id NUNCA vem do payload da requisição HTTP:
-- o caller (webhook-lead.js) passa o company_id retornado pela RPC public_create_lead_webhook
-- que o resolve internamente a partir da api_key.
CREATE OR REPLACE FUNCTION public.log_lead_import_event(
  p_company_id         UUID,
  p_status             TEXT,
  p_error_code         TEXT    DEFAULT NULL,
  p_error_message      TEXT    DEFAULT NULL,
  p_lead_id            INTEGER DEFAULT NULL,
  p_payload_summary    JSONB   DEFAULT NULL,
  p_external_reference TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'log_lead_import_event: p_company_id is required';
  END IF;

  IF p_status IS NULL THEN
    RAISE EXCEPTION 'log_lead_import_event: p_status is required';
  END IF;

  INSERT INTO public.lead_import_events (
    company_id,
    status,
    error_code,
    error_message,
    lead_id,
    payload_summary,
    external_reference
  ) VALUES (
    p_company_id,
    p_status,
    p_error_code,
    p_error_message,
    p_lead_id,
    p_payload_summary,
    p_external_reference
  );
END;
$$;

-- Revogar acesso público e conceder apenas aos roles que o webhook utiliza
REVOKE EXECUTE ON FUNCTION public.log_lead_import_event FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_lead_import_event TO anon, authenticated;

-- =====================================================
-- MIGRATION: Tabela de configurações personalizadas de alertas do dashboard
-- Data: 19/05/2026
--
-- Objetivo:
--   Permitir que cada empresa configure regras próprias para os alertas:
--     • sla_unanswered  → sla_settings
--     • stalled_opportunity → stalled_settings
--     • seller_risk     → seller_risk_settings
--
-- Arquitetura:
--   • Tabela dedicada (não polui companies)
--   • JSONB por grupo de configuração
--   • jsonb_typeof(...) = 'object' valida que nenhum array/string/null é persistido
--   • Chaves obrigatórias validadas via CHECKs
--   • Unidade interna: MINUTOS (conversão para horas/dias ocorre na UI e nas RPCs)
--   • Empresa sem linha → RPCs usam defaults globais via COALESCE
--
-- Defaults globais:
--   sla:          enabled=true, min_minutes=240,   critical_minutes=1440, limit=10
--   stalled:      enabled=true, idle_minutes=20160, min_probability=60,   limit=5
--   seller_risk:  enabled=true, waiting_minutes=720, min_leads=3,         limit=3
--
-- Segurança:
--   • SELECT: qualquer membro ativo da empresa (auth_user_is_company_member)
--   • INSERT/UPDATE: bloqueado via RLS → somente via service_role (API backend)
--   • updated_by registra o usuário que salvou (preenchido pela API)
--
-- Rollback:
--   DROP TABLE IF EXISTS public.dashboard_alert_settings CASCADE;
-- =====================================================

CREATE TABLE public.dashboard_alert_settings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,

  sla_settings JSONB NOT NULL DEFAULT
    '{"enabled":true,"min_minutes":240,"critical_minutes":1440,"limit":10}'::jsonb,

  stalled_settings JSONB NOT NULL DEFAULT
    '{"enabled":true,"idle_minutes":20160,"min_probability":60,"limit":5}'::jsonb,

  seller_risk_settings JSONB NOT NULL DEFAULT
    '{"enabled":true,"waiting_minutes":720,"min_leads":3,"limit":3}'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES auth.users(id),

  -- Garante que sla_settings é um objeto JSON com as chaves esperadas
  CONSTRAINT chk_sla_settings CHECK (
    jsonb_typeof(sla_settings)     = 'object' AND
    sla_settings ? 'enabled'                  AND
    sla_settings ? 'min_minutes'              AND
    sla_settings ? 'critical_minutes'         AND
    sla_settings ? 'limit'
  ),

  -- Garante que stalled_settings é um objeto JSON com as chaves esperadas
  CONSTRAINT chk_stalled_settings CHECK (
    jsonb_typeof(stalled_settings) = 'object' AND
    stalled_settings ? 'enabled'              AND
    stalled_settings ? 'idle_minutes'         AND
    stalled_settings ? 'min_probability'      AND
    stalled_settings ? 'limit'
  ),

  -- Garante que seller_risk_settings é um objeto JSON com as chaves esperadas
  CONSTRAINT chk_seller_risk_settings CHECK (
    jsonb_typeof(seller_risk_settings) = 'object' AND
    seller_risk_settings ? 'enabled'              AND
    seller_risk_settings ? 'waiting_minutes'      AND
    seller_risk_settings ? 'min_leads'            AND
    seller_risk_settings ? 'limit'
  )
);

-- Índice de lookup por empresa (UNIQUE já cria um, mas explicito para clareza)
CREATE INDEX idx_das_company ON public.dashboard_alert_settings (company_id);

-- Trigger de updated_at (set_updated_at() existe desde migration 20260516100000)
CREATE TRIGGER das_updated_at
  BEFORE UPDATE ON public.dashboard_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.dashboard_alert_settings ENABLE ROW LEVEL SECURITY;

-- Membros ativos da empresa podem ler as configurações
CREATE POLICY "das_select"
  ON public.dashboard_alert_settings
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- INSERT/UPDATE bloqueados via RLS: somente service_role (API backend) grava
CREATE POLICY "das_insert"
  ON public.dashboard_alert_settings
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "das_update"
  ON public.dashboard_alert_settings
  FOR UPDATE
  USING (false);

-- Leitura permitida para authenticated (via RLS acima)
GRANT SELECT ON public.dashboard_alert_settings TO authenticated;

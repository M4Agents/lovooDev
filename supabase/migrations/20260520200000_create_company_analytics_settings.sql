-- =====================================================
-- MIGRATION: Tabela de configurações analíticas por empresa
-- Data: 20/05/2026
--
-- Objetivo:
--   Armazenar thresholds configuráveis por empresa para as métricas
--   da aba "Ativação Comercial" do dashboard:
--     • lead_rescue_inactivity_days      → dias de silêncio do lead para qualificar resgate
--     • rescue_response_window_days      → janela de resposta após tentativa de resgate
--     • prospection_response_window_days → janela de resposta após prospecção outbound
--
-- Arquitetura:
--   • Tabela dedicada (não polui companies nem dashboard_alert_settings)
--   • Colunas explícitas INTEGER com CHECK constraints — tipagem e validação no banco
--   • company_id como PRIMARY KEY (relação 1:1 com a empresa)
--   • Empresa sem linha → API e RPC usam defaults hardcoded via COALESCE
--
-- Defaults:
--   lead_rescue_inactivity_days      = 15  (dias sem inbound para considerar lead inativo)
--   rescue_response_window_days      = 7   (dias para o lead responder ao resgate)
--   prospection_response_window_days = 7   (dias para o lead responder à prospecção)
--
-- Segurança:
--   • SELECT: qualquer membro ativo da empresa (auth_user_is_company_member)
--   • INSERT/UPDATE: bloqueado via RLS → somente via service_role (API backend)
--   • updated_by registra o usuário responsável pela última alteração (preenchido pela API)
--
-- Rollback:
--   DROP TABLE IF EXISTS public.company_analytics_settings CASCADE;
-- =====================================================

CREATE TABLE public.company_analytics_settings (
  company_id  UUID  PRIMARY KEY
                    REFERENCES public.companies(id) ON DELETE CASCADE,

  lead_rescue_inactivity_days      INTEGER NOT NULL DEFAULT 15
    CONSTRAINT chk_cas_rescue_inactivity
    CHECK (lead_rescue_inactivity_days BETWEEN 1 AND 365),

  rescue_response_window_days      INTEGER NOT NULL DEFAULT 7
    CONSTRAINT chk_cas_rescue_response
    CHECK (rescue_response_window_days BETWEEN 1 AND 90),

  prospection_response_window_days INTEGER NOT NULL DEFAULT 7
    CONSTRAINT chk_cas_prospection_response
    CHECK (prospection_response_window_days BETWEEN 1 AND 90),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES auth.users(id)
);

-- Trigger de updated_at (set_updated_at() existe desde migration 20260516100000)
CREATE TRIGGER cas_updated_at
  BEFORE UPDATE ON public.company_analytics_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.company_analytics_settings ENABLE ROW LEVEL SECURITY;

-- Membros ativos da empresa podem ler as configurações
CREATE POLICY "cas_select"
  ON public.company_analytics_settings
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- INSERT/UPDATE bloqueados via RLS: somente service_role (API backend) grava
CREATE POLICY "cas_insert"
  ON public.company_analytics_settings
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "cas_update"
  ON public.company_analytics_settings
  FOR UPDATE
  USING (false);

-- Leitura permitida para authenticated (via RLS acima)
GRANT SELECT ON public.company_analytics_settings TO authenticated;

-- =============================================================================
-- Meta WhatsApp Cloud API — Fase 1A / Migration 2 de 4
-- Tabela: public.meta_whatsapp_instances
--
-- Modelo: 1 instância = 1 phone_number_id conectado a 1 empresa.
--   • Uma empresa pode ter múltiplas instâncias.
--   • Uma WABA pode ter múltiplos números (cada número = instância separada).
--   • Instâncias são criadas SOMENTE após onboarding bem-sucedido:
--       code trocado + waba_id confirmado + phone_number_id confirmado + token obtido.
--   • Fluxo de signup em andamento é representado por meta_whatsapp_onboarding.
--
-- Isolamento Uazapi:
--   COMPLETAMENTE independente de whatsapp_life_instances.
--   Nenhum objeto Uazapi é referenciado nesta migration.
--
-- Unicidade do phone_number_id (Opção A aprovada):
--   Um phone_number_id pertence a uma empresa enquanto deleted_at IS NULL.
--   status = 'disconnected' NÃO libera o número para outra empresa.
--   Apenas deleted_at IS NOT NULL libera o número para futura associação.
--   Implementado via UNIQUE INDEX parcial: phone_number_id WHERE deleted_at IS NULL.
--
-- Segurança (nasce junto com a tabela):
--   RLS + GRANT/REVOKE criados nesta mesma migration.
--   INSERT/UPDATE/DELETE: exclusivamente backend via service_role (bypass RLS).
--   SELECT: feature flag obrigatória para todos + trilha legítima (member, partner, parent admin).
--   Sem bypass global de role — auth_user_is_platform_admin() não utilizado (cross-tenant).
--
-- Helper meta_whatsapp_company_enabled:
--   Função SECURITY DEFINER criada nesta migration para leitura da feature flag.
--   Resolve o risco de RLS de public.companies impedir a subquery para Partner
--   (partner_company_links vs partner_company_assignments são tabelas distintas).
--   A função lê apenas companies.meta_whatsapp_enabled sem conceder autorização.
--
-- Rollback (ATENÇÃO — executar SOMENTE APÓS o rollback de meta_whatsapp_credentials):
--   meta_whatsapp_credentials.instance_id tem FK para esta tabela.
--   Ordem obrigatória: Migration 4 → Migration 3 → [este rollback] → Migration 1.
--
--   1. DROP POLICY IF EXISTS "mwi_select" ON public.meta_whatsapp_instances;
--   2. DROP TABLE public.meta_whatsapp_instances;
--      (remove automaticamente: índices, trigger, constraints, policies da tabela)
--   3. DROP FUNCTION IF EXISTS public.meta_whatsapp_company_enabled(uuid);
--      (remover explicitamente após a tabela — sem CASCADE)
-- =============================================================================

-- =============================================================================
-- HELPER: meta_whatsapp_company_enabled
-- Responsabilidade única: ler companies.meta_whatsapp_enabled bypassando RLS.
-- =============================================================================

-- Análise de segurança (SECURITY DEFINER):
--   • search_path fixado em 'public': elimina search_path hijacking.
--   • Todas as referências qualificadas (public.companies): sem ambiguidade.
--   • Retorna boolean apenas — nenhum dado sensível exposto.
--   • Sem parâmetro user_id: não verifica membership, role, partner.
--   • STABLE: somente leitura, sem side effects, sem writes.
--   • COALESCE(…, false): retorna false para company inexistente (sem vazar existência).
--   • Não é genérica: exclusiva do módulo Meta WhatsApp.
--   • Não concede autorização: flag true é condição necessária, não suficiente.
CREATE OR REPLACE FUNCTION public.meta_whatsapp_company_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT meta_whatsapp_enabled
     FROM public.companies
     WHERE id = p_company_id),
    false
  );
$$;

-- Grants da função:
--   anon: sem acesso (REVOKE explícito).
--   authenticated: EXECUTE — necessário para a policy mwi_select.
--   service_role: EXECUTE — necessário para futuro uso no backend.
--   PUBLIC: revogado para garantir zero permissão implícita.
REVOKE ALL ON FUNCTION public.meta_whatsapp_company_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meta_whatsapp_company_enabled(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.meta_whatsapp_company_enabled(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_whatsapp_company_enabled(uuid) TO service_role;

-- =============================================================================
-- TABELA
-- =============================================================================

CREATE TABLE public.meta_whatsapp_instances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Identificadores Meta (obtidos após onboarding completo)
  phone_number_id   TEXT        NOT NULL,
  waba_id           TEXT        NOT NULL,

  -- Dados de exibição (nullable: preenchidos após Graph API call na Fase 1B)
  display_name      TEXT,
  phone_number      TEXT,
  verified_name     TEXT,

  -- Ciclo de vida
  -- DEFAULT 'connected': instâncias são criadas somente após onboarding bem-sucedido.
  -- 4 estados — pending_signup é representado por meta_whatsapp_onboarding.
  status            TEXT        NOT NULL DEFAULT 'connected',

  -- Auditoria: quem realizou a conexão (nullable — sem ON DELETE, padrão do projeto)
  connected_by      UUID        REFERENCES auth.users(id),

  -- Soft delete: controla a "propriedade" do phone_number_id.
  --   deleted_at IS NULL     → número pertence a esta instância/empresa.
  --   deleted_at IS NOT NULL → número liberado para futura associação.
  deleted_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mwi_status_check
    CHECK (status IN ('connected', 'disconnected', 'error', 'token_revoked'))
);

-- Trigger updated_at — reutiliza update_updated_at_column() existente no projeto.
-- Confirmada em: 20241118_create_plans_management.sql
CREATE TRIGGER trg_mwi_updated_at
  BEFORE UPDATE ON public.meta_whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Índice: listagem de instâncias por empresa (painel de configurações)
CREATE INDEX idx_mwi_company_id
  ON public.meta_whatsapp_instances (company_id)
  WHERE deleted_at IS NULL;

-- Índice único: propriedade global do phone_number_id.
--   • No máximo 1 row com deleted_at IS NULL por phone_number_id.
--   • Garante resolução determinística no webhook (sem ambiguidade multi-tenant).
--   • Também serve como índice de lookup do backend (webhook resolution por phone_number_id).
--   • Substitui UNIQUE(company_id, phone_number_id): o índice global já cobre duplicata
--     dentro da mesma empresa e entre empresas.
CREATE UNIQUE INDEX idx_mwi_phone_number_id_owner
  ON public.meta_whatsapp_instances (phone_number_id)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.meta_whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- SELECT: acesso legítimo com verificação de feature flag via helper SECURITY DEFINER.
--
-- Lógica — TODOS os acessos authenticated exigem:
--   1. feature flag habilitada para a empresa: meta_whatsapp_company_enabled(company_id)
--      [helper SECURITY DEFINER — bypassa RLS de companies, resolve risco Partner]
--   2. E acesso legítimo por exatamente uma das trilhas:
--        Trilha 1: membro direto ativo da empresa (auth_user_is_company_member)
--        Trilha B: partner com assignment ativo (auth_user_is_partner_for_company)
--        Trilha 2: parent admin escopado à hierarquia correta (auth_user_is_parent_admin)
--
-- Sem bypass global de role.
-- auth_user_is_platform_admin() foi removido desta policy:
--   retorna true para qualquer super_admin/system_admin de QUALQUER company parent,
--   violando o isolamento multi-tenant (cross-tenant read de todas as rows).
--
-- Garantia multi-tenant: auth_user_is_parent_admin(company_id) é escopado —
--   verifica se o usuário é admin da parent ESPECÍFICA da company passada.
--   super_admin de Parent A NÃO acessa rows de companies de Parent B.
--
-- IMPORTANTE: flag true é condição necessária, NÃO suficiente.
--   O usuário ainda precisa de acesso legítimo por uma das trilhas acima.
--
-- Helpers confirmados no projeto:
--   meta_whatsapp_company_enabled(uuid)      — criada nesta migration (acima)
--   auth_user_is_company_member(uuid)        — usado em múltiplas migrations
--   auth_user_is_partner_for_company(uuid)   — 20260623390000_create_auth_user_is_partner_for_company.sql
--   auth_user_is_parent_admin(uuid)          — 20260414210000_fix_sql_functions.sql
CREATE POLICY "mwi_select"
ON public.meta_whatsapp_instances
FOR SELECT TO authenticated
USING (
  public.meta_whatsapp_company_enabled(company_id)
  AND (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_partner_for_company(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  )
);

-- INSERT / UPDATE / DELETE: sem policy → authenticated bloqueado por default RLS.
-- service_role bypassa RLS automaticamente → backend tem acesso total.

-- =============================================================================
-- GRANT / REVOKE — TABELA
-- =============================================================================
-- Dupla proteção: RLS (policy SELECT) + privilégios de tabela.
-- anon:          zero acesso.
-- authenticated: SELECT via RLS; todos os demais privilégios explicitamente revogados.
-- service_role:  acesso total (backend).
REVOKE ALL ON TABLE public.meta_whatsapp_instances FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_whatsapp_instances FROM anon;
REVOKE ALL ON TABLE public.meta_whatsapp_instances FROM authenticated;
GRANT SELECT ON TABLE public.meta_whatsapp_instances TO authenticated;
GRANT ALL ON TABLE public.meta_whatsapp_instances TO service_role;

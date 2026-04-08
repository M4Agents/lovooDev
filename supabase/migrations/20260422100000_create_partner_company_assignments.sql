-- =====================================================
-- MIGRATION: partner_company_assignments
-- Data: 22/04/2026
-- Objetivo: Tabela de atribuição explícita de empresas client
--           a usuários com role = 'partner'.
--
-- Separação de camadas:
--   - company_users.role      → perfil e permissões do usuário
--   - company_users.company_id → empresa da qual o usuário é membro (parent para partner)
--   - partner_company_assignments → empresas client que o partner pode operar
--
-- Regras:
--   - partner tem 1 registro em company_users (empresa parent)
--   - partner tem N registros aqui (uma por empresa atribuída)
--   - Escritas somente via SECURITY DEFINER RPCs
--   - is_active = false = revogação sem perda de histórico
-- =====================================================

CREATE TABLE IF NOT EXISTS public.partner_company_assignments (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  assigned_by      uuid        NOT NULL REFERENCES auth.users(id),
  assigned_at      timestamptz DEFAULT now() NOT NULL,
  is_active        boolean     DEFAULT true NOT NULL,

  CONSTRAINT uq_partner_company UNIQUE (partner_user_id, company_id)
);

COMMENT ON TABLE public.partner_company_assignments IS
  'Atribuição explícita de empresas client a usuários partner. '
  'Separada de company_users para não misturar "membro" com "acesso operacional". '
  'Escritas somente via RPCs SECURITY DEFINER (assign/revoke). '
  'Implementação: Fase 1 — 22/04/2026.';

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Índice composto principal: lookup por partner (ativo)
CREATE INDEX idx_pca_partner_active
  ON public.partner_company_assignments (partner_user_id, company_id, is_active);

-- Índice para queries por company_id (ex: "quais partners têm esta empresa?")
CREATE INDEX idx_pca_company_active
  ON public.partner_company_assignments (company_id)
  WHERE is_active = true;

-- Índice para auditoria (quem atribuiu)
CREATE INDEX idx_pca_assigned_by
  ON public.partner_company_assignments (assigned_by);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.partner_company_assignments ENABLE ROW LEVEL SECURITY;

-- Partner pode ver apenas as próprias atribuições ativas
CREATE POLICY pca_select_own
  ON public.partner_company_assignments
  FOR SELECT
  USING (partner_user_id = auth.uid());

-- Sem políticas de INSERT/UPDATE/DELETE para usuários diretos.
-- Todas as escritas passam por RPCs SECURITY DEFINER que bypassam RLS.
-- Isso evita qualquer bypass via cliente direto.

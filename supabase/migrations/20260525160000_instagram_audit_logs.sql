-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 7/8)
-- Tabela: instagram_audit_logs
--
-- Registro imutável de ações relevantes na integração Instagram.
-- Primeiro módulo de auditoria dedicado no sistema.
--
-- REGRAS DE IMUTABILIDADE:
-- - Sem coluna updated_at (tabela não sofre UPDATE por design)
-- - Nenhuma policy de INSERT/UPDATE/DELETE para authenticated
--   → authenticated NÃO pode escrever, atualizar ou deletar
-- - service_role contorna RLS por design do Supabase
--   → controle de imutabilidade é responsabilidade da aplicação (backend)
-- =============================================================================

CREATE TABLE public.instagram_audit_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id  UUID        REFERENCES public.instagram_connections(id),
  action         TEXT        NOT NULL,
  performed_by   UUID        REFERENCES auth.users(id),
  metadata       JSONB       NOT NULL DEFAULT '{}',
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Sem updated_at: tabela imutável por design
);

-- Índices para leitura eficiente
CREATE INDEX idx_igaudit_company_time
  ON public.instagram_audit_logs(company_id, created_at DESC);

CREATE INDEX idx_igaudit_company_action
  ON public.instagram_audit_logs(company_id, action);

CREATE INDEX idx_igaudit_connection
  ON public.instagram_audit_logs(connection_id);

CREATE INDEX idx_igaudit_performer
  ON public.instagram_audit_logs(performed_by);

-- RLS
ALTER TABLE public.instagram_audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: membros, admin da empresa pai e platform admin
CREATE POLICY "igaudit_select_member"
  ON public.instagram_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- Sem policies de INSERT / UPDATE / DELETE para authenticated:
-- → Por design, nenhum usuário autenticado pode gravar, alterar ou remover registros
-- → service_role (backend) é o único que pode inserir, via RPC SECURITY DEFINER
-- → UPDATE e DELETE são operações proibidas por design (log imutável)

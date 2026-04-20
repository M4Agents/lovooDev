-- Tabela de solicitações de mudança de plano.
-- Registra o pedido da empresa e permite aprovação/rejeição pelo admin da plataforma.
-- Quando Stripe for integrado: adicionar stripe_checkout_session_id e payment_status aqui.

CREATE TABLE IF NOT EXISTS public.plan_change_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  from_plan_id  UUID        NULL     REFERENCES public.plans(id)      ON DELETE SET NULL,
  to_plan_id    UUID        NOT NULL REFERENCES public.plans(id)      ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  UUID        NOT NULL REFERENCES auth.users(id),
  reviewed_by   UUID        NULL     REFERENCES auth.users(id),
  notes         TEXT        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garante apenas um pedido pendente por empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_change_requests_company_pending
  ON public.plan_change_requests(company_id)
  WHERE status = 'pending';

-- Índice para queries de admin (listar por status e data)
CREATE INDEX IF NOT EXISTS idx_plan_change_requests_status_created
  ON public.plan_change_requests(status, created_at DESC);

-- Índice para queries da empresa (listar seus próprios pedidos)
CREATE INDEX IF NOT EXISTS idx_plan_change_requests_company_id
  ON public.plan_change_requests(company_id, created_at DESC);

-- RLS
ALTER TABLE public.plan_change_requests ENABLE ROW LEVEL SECURITY;

-- Empresa pode ver seus próprios pedidos
CREATE POLICY "pcr_company_select"
  ON public.plan_change_requests
  FOR SELECT TO authenticated
  USING (auth_user_is_company_member(company_id));

-- Empresa pode criar pedido para si mesma
CREATE POLICY "pcr_company_insert"
  ON public.plan_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_user_is_company_member(company_id)
    AND requested_by = auth.uid()
  );

-- Empresa pode cancelar APENAS seu pedido pendente
CREATE POLICY "pcr_company_cancel"
  ON public.plan_change_requests
  FOR UPDATE TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    AND status = 'pending'
  )
  WITH CHECK (status = 'cancelled');

-- Platform admin pode gerenciar todos
CREATE POLICY "pcr_platform_admin_all"
  ON public.plan_change_requests
  FOR ALL TO authenticated
  USING (auth_user_is_platform_admin());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.trg_set_plan_change_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_plan_change_requests_updated_at
  BEFORE UPDATE ON public.plan_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_plan_change_requests_updated_at();

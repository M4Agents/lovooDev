-- Permite que qualquer usuário autenticado leia a tabela plans.
-- Plans são catálogo público do produto (nome, slug, limites) — sem dados sensíveis.
-- Necessário para que o join plans!plan_id retorne dados no frontend via Supabase JS.
CREATE POLICY "plans_select_authenticated"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (true);

-- =============================================================================
-- Nuvemshop Integration — Migration Fase 10
-- Campos de Carrinho Abandonado em leads
--
-- nuvemshop_checkout_id TEXT:
--   Identificador externo do checkout na Nuvemshop.
--   Usado para deduplicação e lookup do checkout.
--
-- nuvemshop_checkout_url TEXT:
--   ⚠️  DADO SENSÍVEL — URL de retorno ao carrinho abandonado.
--   Regras de segurança:
--     - NUNCA registrar em logs (nem debug)
--     - NUNCA retornar em APIs de listagem
--     - Exibir apenas na aba Nuvemshop do lead, para usuários autorizados
--     - Usar apenas em automações autorizadas (ex: disparo de WhatsApp)
--     - Acesso restrito via RLS e controle de permissão no backend
--
-- cart_total NUMERIC(15,2):
--   Valor total do carrinho no momento do abandono.
--
-- cart_items JSONB:
--   Snapshot dos itens do carrinho: [{ product_id, name, quantity, price }].
--   Sem dados financeiros sensíveis. Sem checkout_url inline.
--   Apenas metadados de produto para exibição e automações.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS nuvemshop_checkout_id  TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS cart_total             NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cart_items             JSONB;

COMMENT ON COLUMN public.leads.nuvemshop_checkout_id IS
  'ID do checkout abandonado na Nuvemshop. Usado para deduplicação e lookup.';

COMMENT ON COLUMN public.leads.nuvemshop_checkout_url IS
  'SENSÍVEL — URL de recuperação do carrinho abandonado. '
  'Nunca logar. Nunca retornar em listagens. Exibir apenas na aba Nuvemshop '
  'para usuários autorizados. Usar apenas em automações autorizadas.';

COMMENT ON COLUMN public.leads.cart_total IS
  'Valor total do carrinho no momento do abandono (moeda BRL).';

COMMENT ON COLUMN public.leads.cart_items IS
  'Snapshot dos itens do carrinho abandonado: '
  '[{ product_id, name, quantity, price }]. '
  'Sem dados financeiros sensíveis. Sem checkout_url.';

-- Índice para lookup por checkout_id
CREATE INDEX IF NOT EXISTS idx_leads_nuvemshop_checkout_id
  ON public.leads(company_id, nuvemshop_checkout_id)
  WHERE nuvemshop_checkout_id IS NOT NULL;

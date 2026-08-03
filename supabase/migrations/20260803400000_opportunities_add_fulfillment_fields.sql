-- =============================================================================
-- Nuvemshop Integration — Migration Fase 11
-- Campos de Fulfillment/Rastreamento em opportunities
--
-- Armazenam os dados de envio retornados pelos eventos order/packed e
-- order/fulfilled da Nuvemshop. Todos os campos são nullable — sem impacto
-- em oportunidades existentes não integradas à Nuvemshop.
--
-- nuvemshop_fulfillment_status TEXT:
--   Status de fulfillment bruto retornado pela API Nuvemshop.
--   Valores esperados: unfulfilled | partial | fulfilled
--   Preservado para auditoria (não é o status CRM da oportunidade).
--
-- nuvemshop_tracking_number TEXT:
--   Código de rastreamento do envio (ex: "BR123456789BR").
--   Pode ser null quando o pedido ainda não foi enviado.
--
-- nuvemshop_tracking_url TEXT:
--   URL de rastreamento do pedido junto à transportadora.
--   Pode ser null. Não é considerado dado sensível (URL pública de rastreio).
--
-- nuvemshop_shipping_carrier TEXT:
--   Nome da transportadora (ex: "Correios", "JADLOG").
--   Pode ser null.
-- =============================================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS nuvemshop_fulfillment_status TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_tracking_number    TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_tracking_url       TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_shipping_carrier   TEXT;

COMMENT ON COLUMN public.opportunities.nuvemshop_fulfillment_status IS
  'Status de fulfillment bruto da Nuvemshop: unfulfilled|partial|fulfilled. '
  'Preservado para auditoria. Não é o status CRM da oportunidade.';

COMMENT ON COLUMN public.opportunities.nuvemshop_tracking_number IS
  'Código de rastreamento do envio retornado pela Nuvemshop.';

COMMENT ON COLUMN public.opportunities.nuvemshop_tracking_url IS
  'URL pública de rastreamento do pedido junto à transportadora.';

COMMENT ON COLUMN public.opportunities.nuvemshop_shipping_carrier IS
  'Nome da transportadora informado pela Nuvemshop (ex: Correios, JADLOG).';

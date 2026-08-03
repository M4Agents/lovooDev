-- =============================================================================
-- Nuvemshop Integration — Migration Fase 9
-- Dados de pagamento e status bruto em opportunities
--
-- nuvemshop_payment_data JSONB:
--   Armazena dados não-sensíveis das transações do pedido.
--   Campos permitidos: payment_method, payment_provider_name, status,
--   first_digits (BIN, 6 dígitos), last_digits (4 dígitos), brand,
--   installments, amount.
--
--   NUNCA armazenar: número completo do cartão, CVV, tokens,
--   credenciais financeiras, dados brutos de gateway.
--
-- nuvemshop_raw_status TEXT:
--   Status bruto do pedido na Nuvemshop para auditoria.
--   Valores possíveis: open, closed, cancelled.
--   Preservado para rastreabilidade mesmo após conversão para o status CRM.
-- =============================================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS nuvemshop_payment_data JSONB,
  ADD COLUMN IF NOT EXISTS nuvemshop_raw_status   TEXT;

COMMENT ON COLUMN public.opportunities.nuvemshop_payment_data IS
  'Dados não-sensíveis de transação Nuvemshop: '
  '{payment_method, payment_provider_name, payment_status, first_digits, last_digits, '
  'brand, installments, amount}. '
  'NUNCA incluir: número completo do cartão, CVV, tokens ou credenciais.';

COMMENT ON COLUMN public.opportunities.nuvemshop_raw_status IS
  'Status bruto do pedido retornado pela API Nuvemshop (open|closed|cancelled). '
  'Preservado para auditoria. O status CRM (open|won|lost) é derivado pelo statusMapper.';

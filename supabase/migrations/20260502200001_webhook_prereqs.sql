-- =============================================================================
-- Migration: 20260502200001_webhook_prereqs.sql
--
-- Pré-requisitos para o webhook de billing (Etapa 3 Stripe).
--
-- 1. Adiciona `last_invoice_url` em company_subscriptions
--    Armazena a URL de pagamento da última fatura para casos de
--    invoice.payment_action_required (ex.: autenticação 3DS).
--
-- 2. Semeia o plano interno `suspended`
--    Plano não-comercial aplicado automaticamente pelo webhook quando uma
--    assinatura Stripe é cancelada (customer.subscription.deleted).
--    Garante que companies.plan_id NUNCA fique NULL ou inválido.
--    Não deve aparecer na listagem pública nem ser selecionável pelo usuário.
-- =============================================================================

-- ── 1. last_invoice_url ───────────────────────────────────────────────────────

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS last_invoice_url TEXT;

COMMENT ON COLUMN public.company_subscriptions.last_invoice_url IS
  'URL da última fatura do Stripe que exige ação do cliente (ex.: autenticação 3DS). '
  'Atualizada pelo webhook em invoice.payment_action_required.';

-- ── 2. Plano interno "suspended" ─────────────────────────────────────────────

INSERT INTO public.plans (
  name,
  slug,
  description,
  price,
  currency,
  billing_cycle,
  is_active,
  is_publicly_listed,
  max_whatsapp_instances,
  max_leads,
  max_users,
  max_landing_pages,
  max_funnels,
  max_funnel_stages,
  max_automation_flows,
  max_automation_executions_monthly,
  max_products,
  storage_mb,
  features,
  sort_order
)
VALUES (
  'Suspenso',
  'suspended',
  'Plano interno de suspensão. Aplicado automaticamente pelo webhook Stripe quando '
  'uma assinatura é cancelada. Não deve ser exibido ao usuário final nem comercializado.',
  NULL,
  'BRL',
  'monthly',
  false,   -- is_active: plano não comercializável
  false,   -- is_publicly_listed: invisível no frontend
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  '{}',
  9999     -- sort_order alto para nunca aparecer em listagens ordenadas
)
ON CONFLICT (slug) DO NOTHING;

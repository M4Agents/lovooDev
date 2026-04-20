-- Adiciona campo is_publicly_listed à tabela plans.
-- Controla quais planos aparecem na vitrine de upgrade/downgrade da empresa.
--
-- is_active = true  + is_publicly_listed = false → plano ativo mas exclusivo/custom (oculto)
-- is_active = true  + is_publicly_listed = true  → plano ativo e visível para auto-serviço
-- is_active = false                               → nunca exibido (independente de is_publicly_listed)

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS is_publicly_listed BOOLEAN NOT NULL DEFAULT false;

-- Marcar os planos padrão como visíveis para venda
-- (planos custom/exclusivos criados manualmente ficam com false por padrão)
UPDATE public.plans
SET is_publicly_listed = true
WHERE slug IN ('starter', 'growth', 'pro', 'elite')
  AND is_active = true;

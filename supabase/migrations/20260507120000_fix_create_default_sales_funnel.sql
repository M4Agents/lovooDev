-- =============================================================================
-- Migration: fix_create_default_sales_funnel
-- Data: 2026-05-07
--
-- Problema:
--   Dupla criação de estágios ao criar uma nova empresa.
--
-- Cadeia problemática:
--   INSERT INTO companies
--     → trigger create_company_default_funnel
--       → create_default_sales_funnel()
--           → INSERT INTO sales_funnels
--               → trigger create_funnel_default_stages  ← cria estágios 0-6
--           → INSERT INTO funnel_stages (estágios 0-6)  ← DUPLICATA → UNIQUE violation
--
-- Decisão arquitetural:
--   A fonte única de criação de estágios padrão é create_default_funnel_stages(),
--   disparada pelo trigger create_funnel_default_stages em sales_funnels.
--   A função create_default_sales_funnel() deve apenas criar o registro do funil.
--
-- O que esta migration faz:
--   ✓ Remove o INSERT INTO funnel_stages de create_default_sales_funnel()
--   ✓ Mantém a criação do sales_funnel padrão via INSERT INTO sales_funnels
--   ✓ Não altera o trigger create_funnel_default_stages (fonte de verdade dos estágios)
--   ✓ Não altera create_default_funnel_stages()
--   ✓ Não altera RLS
--   ✓ Não realiza hard delete de nenhum dado
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_default_sales_funnel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_funnel_id UUID;
BEGIN
  INSERT INTO sales_funnels (
    company_id,
    name,
    description,
    is_default,
    is_active
  )
  VALUES (
    NEW.id,
    'Funil de Vendas Principal',
    'Funil padrão criado automaticamente',
    true,
    true
  )
  RETURNING id INTO v_funnel_id;

  -- Estágios criados exclusivamente pelo trigger create_funnel_default_stages
  -- em sales_funnels → create_default_funnel_stages() (SECURITY DEFINER)

  RETURN NEW;
END;
$$;

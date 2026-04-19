-- ============================================================
-- CORREÇÃO: Preço do Starter IA
--
-- O pacote Starter IA existia no banco com price = 197.00 (incorreto).
-- Valor correto conforme tabela de precificação: R$ 147,00
--
-- A migration anterior (governance_rpcs_and_seed_packages) usa
-- idempotência por nome (WHERE NOT EXISTS), portanto não sobrescreve
-- registros existentes. Esta migration corrige o valor legado.
-- ============================================================

UPDATE public.credit_packages
SET price = 147.00
WHERE name = 'Starter IA' AND price = 197.00;

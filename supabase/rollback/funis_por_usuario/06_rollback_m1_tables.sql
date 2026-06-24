-- =====================================================================
-- ROLLBACK: M1 — Remover tabelas e constraint de funis por usuário
--
-- O que é revertido:
--   - Tabela user_allowed_funnels (junction table de funis permitidos)
--   - Tabela user_funnel_settings (configuração por usuário)
--   - Constraint UNIQUE(id, company_id) em sales_funnels
--
-- ⚠️  ATENÇÃO — Constraint sales_funnels_id_company_id_uniq:
--     Esta constraint FOI CRIADA por M1. Confirmado: não existia antes desta feature.
--     Verificação realizada em: supabase/migrations/*.sql (nenhuma migration anterior
--     cria esta constraint).
--     É SEGURO removê-la neste rollback.
--
-- Ordem correta do rollback completo: 11 → 10 → 09 → 08 → 07 → 06 → 05
-- =====================================================================

-- Remover junction table primeiro (depende de user_funnel_settings e sales_funnels)
DROP TABLE IF EXISTS user_allowed_funnels CASCADE;

-- Remover tabela principal de configuração
DROP TABLE IF EXISTS user_funnel_settings CASCADE;

-- Remover constraint criada por M1 em sales_funnels
-- Esta constraint só é necessária para a FK composta de user_allowed_funnels.
-- Como user_allowed_funnels foi removida, esta constraint não tem mais utilidade.
ALTER TABLE sales_funnels
  DROP CONSTRAINT IF EXISTS sales_funnels_id_company_id_uniq;

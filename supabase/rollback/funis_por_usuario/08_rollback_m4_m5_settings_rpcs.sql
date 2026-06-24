-- =====================================================================
-- ROLLBACK: M4 + M5 — Remover RPCs de configuração de funis por usuário
--
-- O que é revertido:
--   M4: upsert_user_funnel_settings — RPC para salvar configurações de funis por usuário
--   M5: get_user_funnel_settings    — RPC para consultar configurações de funis por usuário
--
-- Estas funções dependem das tabelas removidas em M1 (rollback 06).
-- Não há estado anterior para restaurar — estas funções são inteiramente novas.
--
-- Ordem correta do rollback completo: 11 → 10 → 09 → 08 → 07 → 06 → 05
-- =====================================================================

-- Remover RPC de upsert (M4)
-- Assinatura: upsert_user_funnel_settings(p_company_id UUID, p_user_id UUID, p_is_enabled BOOLEAN,
--                                          p_default_funnel_id UUID, p_allowed_funnel_ids UUID[])
DROP FUNCTION IF EXISTS upsert_user_funnel_settings(UUID, UUID, BOOLEAN, UUID, UUID[]);

-- Remover RPC de consulta (M5)
-- Assinatura: get_user_funnel_settings(p_company_id UUID, p_user_id UUID)
DROP FUNCTION IF EXISTS get_user_funnel_settings(UUID, UUID);

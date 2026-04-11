-- =====================================================
-- MIGRATION: T8 FIX — REVOGAR PUBLIC DAS RPCs DE AUTOMAÇÃO
-- Data: 11/04/2026
-- Objetivo: Complementar T8 — REVOKE FROM anon é insuficiente
--           quando existe GRANT TO PUBLIC. Revogar PUBLIC e
--           garantir grants explícitos apenas para roles corretos.
-- =====================================================
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO PUBLIC;
-- =====================================================

-- anon herda de PUBLIC — apenas REVOKE FROM anon não é suficiente
REVOKE EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) FROM PUBLIC;

-- Garantir acesso explícito apenas para roles autorizados
GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO authenticated, service_role;

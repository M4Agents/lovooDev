-- =============================================================================
-- Fix: Revogar grants excessivos nas RPCs de auditoria do webhook
--
-- Problema: Supabase re-adiciona grants para 'authenticated' automaticamente
-- após criação de funções com SECURITY DEFINER, mesmo após REVOKE FROM PUBLIC.
-- Isso expõe RPCs de escrita para qualquer usuário autenticado da plataforma.
--
-- Impacto identificado na validação da Fase 1:
--   check_and_log_webhook_rate_limit: authenticated poderia inflar contadores
--     de rate limit de outras empresas (denial-of-service no rate limiting)
--   cleanup_webhook_api_logs: anon/authenticated podiam invocar o cleanup
--   update_webhook_log_result: authenticated podiam manipular logs 'pending'
--   log_webhook_invalid_key: baixo risco, mas desnecessário para authenticated
--
-- Correção: REVOKE explícito por role
-- Modelo final:
--   check_and_log_webhook_rate_limit  → anon, postgres, service_role
--   log_webhook_invalid_key           → anon, postgres, service_role
--   update_webhook_log_result         → anon, postgres, service_role
--   cleanup_webhook_api_logs          → postgres, service_role (job interno apenas)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.check_and_log_webhook_rate_limit(
  TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.log_webhook_invalid_key(
  TEXT, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result(
  TEXT, TEXT, INTEGER, TEXT
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.cleanup_webhook_api_logs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_webhook_api_logs() FROM authenticated;

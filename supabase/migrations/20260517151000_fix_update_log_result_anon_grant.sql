-- =============================================================================
-- Fix: restore EXECUTE grant on update_webhook_log_result for anon
--
-- O DROP+RECREATE na migration 20260517150000 removeu o grant de anon que
-- havia sido concedido na migration 20260517120000 (Fase 1).
-- A função é chamada via anonClient no handler webhook-lead.js e precisa
-- do grant anon para funcionar. authenticated continua revogado.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT, JSONB) TO anon;

-- Confirmar que authenticated permanece sem acesso
REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT, JSONB) FROM authenticated;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

REVOKE EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(uuid)
FROM PUBLIC, anon, authenticated;

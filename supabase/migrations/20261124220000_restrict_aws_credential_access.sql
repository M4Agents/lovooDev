REVOKE EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(uuid)
FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.webhook_get_aws_credentials(uuid)
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.aws_credentials
FROM PUBLIC, anon, authenticated;

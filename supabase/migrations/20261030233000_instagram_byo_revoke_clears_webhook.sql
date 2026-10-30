-- =============================================================================
-- Instagram BYO — revogação invalida o webhook
--
-- A RPC instagram_byo_apply_credentials permanece com a mesma assinatura,
-- SECURITY INVOKER e os mesmos ramos de set, replace_app, rotate_secret
-- e rotate_suat. O único UPDATE que grava validation_status = 'revoked'
-- é o ramo revoke. O trigger BEFORE UPDATE limpa a rota nesse mesmo
-- statement, dentro da transação da RPC, sem copiar o corpo da função.
--
-- O evento instagram_byo_credential_events do revoke continua sendo
-- inserido pela RPC. Esta migration não grava verify token.
--
-- A limpeza abaixo alcança somente linhas que já estão revoked e ainda
-- guardam rota, hash ou webhook ligado. Credencial válida não entra.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.instagram_byo_clear_webhook_on_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.validation_status = 'revoked'
     AND OLD.validation_status IS DISTINCT FROM 'revoked' THEN
    NEW.webhook_enabled := false;
    NEW.webhook_route_id := NULL;
    NEW.webhook_verify_token_hash := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.instagram_byo_clear_webhook_on_revoke() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.instagram_byo_clear_webhook_on_revoke() FROM anon;
REVOKE ALL ON FUNCTION public.instagram_byo_clear_webhook_on_revoke() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_byo_clear_webhook_on_revoke() TO service_role;

CREATE TRIGGER ig_byo_cred_clear_webhook_on_revoke
  BEFORE UPDATE ON public.instagram_byo_company_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.instagram_byo_clear_webhook_on_revoke();

UPDATE public.instagram_byo_company_credentials
   SET webhook_enabled = false,
       webhook_route_id = NULL,
       webhook_verify_token_hash = NULL
 WHERE validation_status = 'revoked'
   AND (
     webhook_enabled = true
     OR webhook_route_id IS NOT NULL
     OR webhook_verify_token_hash IS NOT NULL
   );

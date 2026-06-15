-- =============================================================================
-- Fase 0a: Documentação de gap de versionamento — get_instance_for_webhook
-- Data: 2026-06-15
--
-- Contexto:
--   Esta função existe em produção e é chamada pelo webhook ativo
--   (api/uazapi-webhook-final.js, linha 287), mas nunca foi versionada
--   no repositório. Esta migration registra o estado exato extraído do banco
--   em 2026-06-15 via pg_get_functiondef.
--
-- Uso:
--   Chamada pelo webhook para resolver instância WhatsApp a partir do
--   provider_instance_id (campo instanceName do payload Uazapi).
--   Retorna instance_id, company_id e company_name para o processamento
--   da mensagem inbound.
--
-- Idempotência: CREATE OR REPLACE — seguro em produção.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_instance_for_webhook(
  p_provider_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_instance_id  uuid;
  v_company_id   uuid;
  v_company_name text;
BEGIN
  SELECT
    wli.id,
    wli.company_id,
    c.name
  INTO
    v_instance_id,
    v_company_id,
    v_company_name
  FROM public.whatsapp_life_instances wli
  JOIN public.companies c ON c.id = wli.company_id
  WHERE wli.provider_instance_id = p_provider_instance_id
    AND wli.status               = 'connected'
    AND wli.deleted_at           IS NULL
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',        true,
    'instance_id',  v_instance_id,
    'company_id',   v_company_id,
    'company_name', v_company_name
  );
END;
$$;

COMMENT ON FUNCTION public.get_instance_for_webhook IS
'Resolve instância WhatsApp pelo provider_instance_id para uso exclusivo do webhook Uazapi. '
'Retorna found=false quando instância não está conectada ou foi soft-deleted. '
'Documentada em 2026-06-15: existia em produção sem migration correspondente no repositório.';

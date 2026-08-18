-- =============================================================================
-- update_get_instance_for_webhook_v2
-- Data: 2026-08-18
--
-- Contexto:
--   O webhook uazapi-webhook-final.js precisa comparar message.senderName
--   contra o nome próprio da instância (instance_name e profile_name) para
--   detectar quando o UAZAPI envia o nome do perfil da instância como
--   senderName de contatos sem pushName configurado no WhatsApp.
--
-- Mudança:
--   Adiciona instance_name e profile_name ao retorno da função.
--   Os demais campos (found, instance_id, company_id, company_name) são mantidos.
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
  v_instance_id   uuid;
  v_company_id    uuid;
  v_company_name  text;
  v_instance_name text;
  v_profile_name  text;
BEGIN
  SELECT
    wli.id,
    wli.company_id,
    c.name,
    wli.instance_name,
    wli.profile_name
  INTO
    v_instance_id,
    v_company_id,
    v_company_name,
    v_instance_name,
    v_profile_name
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
    'found',          true,
    'instance_id',    v_instance_id,
    'company_id',     v_company_id,
    'company_name',   v_company_name,
    'instance_name',  v_instance_name,
    'profile_name',   v_profile_name
  );
END;
$$;

COMMENT ON FUNCTION public.get_instance_for_webhook IS
'Resolve instância WhatsApp pelo provider_instance_id para uso exclusivo do webhook Uazapi. '
'Retorna found=false quando instância não está conectada ou foi soft-deleted. '
'v2 (2026-08-18): adiciona instance_name e profile_name ao retorno para permitir '
'detecção de senderName que é o próprio nome da instância (UAZAPI fallback).';

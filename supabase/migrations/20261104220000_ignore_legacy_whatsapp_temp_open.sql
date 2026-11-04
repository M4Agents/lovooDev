-- Ignora temporárias legadas sem init_started_at na reserva do QR.
-- Não altera linhas existentes. Não chama a UAZAPI.
-- Preparada. Não aplicar até a publicação aprovada.

CREATE OR REPLACE FUNCTION public.claim_whatsapp_temp_open(
  p_company_id uuid,
  p_instance_name text,
  p_temp_id text,
  p_uazapi_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  existing public.whatsapp_temp_instances%ROWTYPE;
BEGIN
  IF p_company_id IS NULL
     OR p_instance_name IS NULL
     OR length(btrim(p_instance_name)) = 0
     OR length(p_instance_name) > 80
     OR p_temp_id IS NULL
     OR p_uazapi_name IS NULL THEN
    RAISE EXCEPTION 'claim_whatsapp_temp_open: argumentos invalidos';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || E'\x1f' || p_instance_name, 0)
  );

  SELECT *
    INTO existing
  FROM public.whatsapp_temp_instances
  WHERE company_id = p_company_id
    AND instance_name = p_instance_name
    AND status IN ('creating', 'created', 'created_no_qr', 'connecting')
    AND (
      remote_init_state IN ('reserved', 'confirmed')
      OR (remote_init_state = 'unknown' AND init_started_at IS NOT NULL)
    )
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'existing',
      'temp_instance_id', existing.temp_instance_id,
      'uazapi_name', existing.uazapi_name,
      'status', existing.status,
      'remote_init_state', existing.remote_init_state,
      'company_id', existing.company_id,
      'instance_name', existing.instance_name
    );
  END IF;

  INSERT INTO public.whatsapp_temp_instances (
    temp_instance_id,
    company_id,
    instance_name,
    uazapi_name,
    status,
    remote_init_state,
    updated_at
  ) VALUES (
    p_temp_id,
    p_company_id,
    p_instance_name,
    p_uazapi_name,
    'creating',
    'reserved',
    now()
  );

  RETURN jsonb_build_object(
    'outcome', 'created',
    'temp_instance_id', p_temp_id,
    'uazapi_name', p_uazapi_name,
    'status', 'creating',
    'remote_init_state', 'reserved',
    'company_id', p_company_id,
    'instance_name', p_instance_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_temp_open(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_whatsapp_temp_open(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_whatsapp_temp_open(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_temp_open(uuid, text, text, text) TO service_role;

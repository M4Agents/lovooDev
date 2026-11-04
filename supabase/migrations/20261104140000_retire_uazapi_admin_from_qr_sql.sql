-- Pacote B. Preparada. Não aplicar neste passo.
-- Remove exatamente as dez funções confirmadas no inventário.
-- Interrompe se a assinatura, a quantidade ou outra função normal com o header
-- administrativo não corresponderem ao esperado.
-- Não usa CASCADE. Não usa IF EXISTS. Não recria função. Não concede EXECUTE.
-- Preserva, para análise de permissão ainda pendente no Pacote A:
--   public.generate_whatsapp_qr_code(uuid, text)
--   public.generate_whatsapp_qr_code_async_backup()
--   public.create_whatsapp_life_instance_rpc(uuid, text)

DO $$
DECLARE
  expected text[] := ARRAY[
    'public.generate_whatsapp_qr_code_180s_timeout(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_async(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_correct_flow(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_direct_reference(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_pure_webhook(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_reference_based(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_timeout_resilient(p_company_id uuid, p_instance_name text)',
    'public.generate_whatsapp_qr_code_webhook_100(p_company_id uuid, p_instance_name text)',
    'public.test_uazapi_connectivity()',
    'public.test_uazapi_instance_init(p_test_name text)'
  ];
  target_names text[] := ARRAY[
    'generate_whatsapp_qr_code_180s_timeout',
    'generate_whatsapp_qr_code_async',
    'generate_whatsapp_qr_code_correct_flow',
    'generate_whatsapp_qr_code_direct_reference',
    'generate_whatsapp_qr_code_pure_webhook',
    'generate_whatsapp_qr_code_reference_based',
    'generate_whatsapp_qr_code_timeout_resilient',
    'generate_whatsapp_qr_code_webhook_100',
    'test_uazapi_connectivity',
    'test_uazapi_instance_init'
  ];
  found text[];
  header_count integer;
  name_count integer;
  routine record;
BEGIN
  SELECT coalesce(array_agg(signature ORDER BY signature), ARRAY[]::text[])
    INTO found
  FROM (
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY (target_names)
  ) AS inventory;

  SELECT count(*)
    INTO name_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname = ANY (target_names);

  IF found <> expected OR name_count <> 10 THEN
    RAISE EXCEPTION 'Pacote B: inventário das dez funções não corresponde ao esperado';
  END IF;

  SELECT count(*)
    INTO header_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname = ANY (target_names)
    AND strpos(pg_get_functiondef(p.oid), 'http_header(''admintoken''') > 0;

  IF header_count <> 10 THEN
    RAISE EXCEPTION 'Pacote B: inventário das dez funções não corresponde ao esperado';
  END IF;

  FOR routine IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT (p.proname = ANY (target_names))
  LOOP
    BEGIN
      IF strpos(pg_get_functiondef(routine.oid), 'http_header(''admintoken''') > 0 THEN
        RAISE EXCEPTION 'Pacote B: outra função normal ainda contém o header administrativo: %', routine.proname;
      END IF;
    EXCEPTION
      WHEN raise_exception THEN
        RAISE;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Pacote B: não foi possível inspecionar a função %', routine.proname;
    END;
  END LOOP;
END $$;

DROP FUNCTION public.generate_whatsapp_qr_code_180s_timeout(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_async(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_webhook_100(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_direct_reference(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_pure_webhook(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_reference_based(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_timeout_resilient(uuid, text);
DROP FUNCTION public.generate_whatsapp_qr_code_correct_flow(uuid, text);
DROP FUNCTION public.test_uazapi_connectivity();
DROP FUNCTION public.test_uazapi_instance_init(text);

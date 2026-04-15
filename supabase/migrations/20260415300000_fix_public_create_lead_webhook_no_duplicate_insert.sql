-- MIGRATION: Corrigir public_create_lead_webhook para NÃO inserir lead duplicado
-- Estratégia: verificar duplicata por telefone/email ANTES de inserir.
-- Se o lead já existe, retornar o lead original com is_duplicate=true sem criar novo registro.
-- Isso implementa o princípio "Lead = identidade" — um único registro por pessoa.

CREATE OR REPLACE FUNCTION public_create_lead_webhook(lead_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_company_id        UUID;
  v_lead_id           INTEGER;
  v_api_key           TEXT;
  v_phone             TEXT;
  v_email             TEXT;
  v_phone_normalized  TEXT;
  v_existing_lead_id  INTEGER;
BEGIN
  v_api_key := lead_data->>'api_key';

  IF v_api_key IS NULL OR v_api_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'API key is required');
  END IF;

  SELECT id INTO v_company_id
  FROM companies
  WHERE api_key::text = v_api_key;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid API key');
  END IF;

  v_phone := lead_data->>'phone';
  v_email := lead_data->>'email';

  -- Verificar duplicata por telefone normalizado (sem formatação)
  IF v_phone IS NOT NULL AND trim(v_phone) != '' THEN
    v_phone_normalized := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
    IF LENGTH(v_phone_normalized) >= 10 THEN
      SELECT id INTO v_existing_lead_id
      FROM leads
      WHERE company_id = v_company_id
        AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_normalized
        AND phone IS NOT NULL AND trim(phone) != ''
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- Verificar duplicata por e-mail (se ainda não encontrou por telefone)
  IF v_existing_lead_id IS NULL AND v_email IS NOT NULL AND trim(v_email) != '' THEN
    SELECT id INTO v_existing_lead_id
    FROM leads
    WHERE company_id = v_company_id
      AND lower(trim(email)) = lower(trim(v_email))
      AND email IS NOT NULL AND trim(email) != ''
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Duplicata encontrada: retorna lead original sem inserir novo registro
  IF v_existing_lead_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',              true,
      'lead_id',              v_existing_lead_id,
      'company_id',           v_company_id,
      'is_duplicate',         true,
      'duplicate_of_lead_id', v_existing_lead_id
    );
  END IF;

  -- Sem duplicata: inserir normalmente
  INSERT INTO leads (
    company_id, name, email, phone, interest,
    company_name, company_cnpj, company_email, visitor_id,
    status, origin, created_at
  ) VALUES (
    v_company_id,
    COALESCE(lead_data->>'name', 'Lead sem nome'),
    lead_data->>'email',
    lead_data->>'phone',
    lead_data->>'interest',
    lead_data->>'company_name',
    lead_data->>'company_cnpj',
    lead_data->>'company_email',
    lead_data->>'visitor_id',
    'novo',
    'webhook_ultra_simples',
    NOW()
  ) RETURNING id INTO v_lead_id;

  RETURN jsonb_build_object(
    'success',              true,
    'lead_id',              v_lead_id,
    'company_id',           v_company_id,
    'is_duplicate',         false,
    'duplicate_of_lead_id', NULL
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

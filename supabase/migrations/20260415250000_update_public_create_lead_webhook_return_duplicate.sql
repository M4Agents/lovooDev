-- MIGRATION: Atualizar public_create_lead_webhook para retornar is_duplicate e duplicate_of_lead_id
-- O backend webhook-lead.js usa esses campos para acionar handleLeadReentry quando necessário.

CREATE OR REPLACE FUNCTION public_create_lead_webhook(lead_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_company_id        UUID;
  v_lead_id           INTEGER;
  v_api_key           TEXT;
  v_is_duplicate      BOOLEAN;
  v_duplicate_of_id   INTEGER;
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

  -- Ler is_duplicate e duplicate_of_lead_id após triggers executarem
  -- Os triggers AFTER INSERT (lead_duplicate_check) já rodaram e atualizaram is_duplicate
  SELECT is_duplicate, duplicate_of_lead_id
    INTO v_is_duplicate, v_duplicate_of_id
  FROM leads WHERE id = v_lead_id;

  RETURN jsonb_build_object(
    'success',              true,
    'lead_id',              v_lead_id,
    'company_id',           v_company_id,
    'is_duplicate',         COALESCE(v_is_duplicate, false),
    'duplicate_of_lead_id', v_duplicate_of_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

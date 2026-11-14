-- Cadastro real do pop-up de boas-vindas.
-- Não lê nem altera nuvemshop_welcome_test_submissions.
-- Não remove chk_nv_welcome_unpublished e não habilita campanhas.
-- Retenção de 12 meses ou 5 anos permanece pendente: nenhuma política foi adotada.
-- O IP não é coluna de submissão. O limitador guarda apenas o hash da chave.

CREATE TABLE public.nuvemshop_welcome_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nuvemshop_store_id text NOT NULL,
  campaign_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  payload_hash text NOT NULL,
  identity_key text NOT NULL,
  identity_result text NOT NULL,
  eligibility_result text NOT NULL,
  limitation_note text,
  lead_id integer,
  visitor_id text,
  session_id text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  coupon_consent boolean NOT NULL,
  coupon_consent_version text NOT NULL,
  coupon_consented_at timestamptz,
  promo_consent boolean NOT NULL DEFAULT false,
  promo_consent_version text,
  promo_consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_nv_welcome_signup_attempt UNIQUE (company_id, nuvemshop_store_id, attempt_id),
  CONSTRAINT chk_nv_welcome_signup_identity CHECK (identity_result IN ('none', 'reuse', 'conflict')),
  CONSTRAINT chk_nv_welcome_signup_eligibility CHECK (
    eligibility_result IN ('eligible_limited', 'ineligible_paid', 'payment_inconclusive', 'pending_refund_rule', 'unavailable', 'not_evaluated')
  )
);

CREATE TABLE public.nuvemshop_welcome_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  signup_id uuid NOT NULL REFERENCES public.nuvemshop_welcome_signups (id),
  lead_id integer NOT NULL,
  identity_key text NOT NULL,
  email_key text NOT NULL,
  phone_key text NOT NULL,
  coupon_code text NOT NULL,
  apply_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_nv_welcome_grant_identity UNIQUE (campaign_id, identity_key),
  CONSTRAINT uq_nv_welcome_grant_email UNIQUE (campaign_id, email_key),
  CONSTRAINT uq_nv_welcome_grant_phone UNIQUE (campaign_id, phone_key)
);

CREATE TABLE public.nuvemshop_welcome_automation_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  signup_id uuid NOT NULL REFERENCES public.nuvemshop_welcome_signups (id),
  status text NOT NULL DEFAULT 'reserved',
  execution_id uuid,
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT uq_nv_welcome_claim UNIQUE (company_id, flow_id, signup_id),
  CONSTRAINT chk_nv_welcome_claim_status CHECK (status IN ('reserved', 'delivered'))
);

CREATE TABLE public.nuvemshop_welcome_automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  signup_id uuid NOT NULL REFERENCES public.nuvemshop_welcome_signups (id),
  grant_id uuid NOT NULL REFERENCES public.nuvemshop_welcome_grants (id),
  status text NOT NULL DEFAULT 'pending',
  result text,
  attempts integer NOT NULL DEFAULT 0,
  lock_token uuid,
  locked_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_nv_welcome_job_signup UNIQUE (signup_id),
  CONSTRAINT chk_nv_welcome_job_status CHECK (
    status IN ('pending', 'dispatching', 'no_automation', 'linked', 'started', 'needs_review')
  )
);

CREATE INDEX idx_nv_welcome_jobs_claim
  ON public.nuvemshop_welcome_automation_jobs (created_at)
  WHERE status IN ('pending', 'dispatching');

CREATE TABLE public.nuvemshop_welcome_rate_buckets (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);

COMMENT ON TABLE public.nuvemshop_welcome_signups IS
  'Cadastro real do pop-up. Isolado do ensaio. Retenção de 12 meses ou 5 anos pendente; sem expurgo.';
COMMENT ON TABLE public.nuvemshop_welcome_rate_buckets IS
  'Contador por hash. A chave não contém IP, e-mail nem telefone.';
COMMENT ON TABLE public.nuvemshop_welcome_automation_jobs IS
  'Trabalho de automação gravado na mesma transação da concessão. Sem e-mail, telefone ou cupom.';

ALTER TABLE public.nuvemshop_welcome_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuvemshop_welcome_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuvemshop_welcome_automation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuvemshop_welcome_automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuvemshop_welcome_rate_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nuvemshop_welcome_signups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nuvemshop_welcome_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nuvemshop_welcome_automation_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nuvemshop_welcome_automation_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nuvemshop_welcome_rate_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nuvemshop_welcome_signups TO service_role;
GRANT ALL ON TABLE public.nuvemshop_welcome_grants TO service_role;
GRANT ALL ON TABLE public.nuvemshop_welcome_automation_claims TO service_role;
GRANT ALL ON TABLE public.nuvemshop_welcome_automation_jobs TO service_role;
GRANT ALL ON TABLE public.nuvemshop_welcome_rate_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_rate_hit(p_key text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hits integer;
BEGIN
  INSERT INTO public.nuvemshop_welcome_rate_buckets (bucket_key, window_start, hits)
  VALUES (p_key, now(), 1)
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    hits = CASE
      WHEN public.nuvemshop_welcome_rate_buckets.window_start < now() - interval '1 hour' THEN 1
      ELSE public.nuvemshop_welcome_rate_buckets.hits + 1
    END,
    window_start = CASE
      WHEN public.nuvemshop_welcome_rate_buckets.window_start < now() - interval '1 hour' THEN now()
      ELSE public.nuvemshop_welcome_rate_buckets.window_start
    END
  RETURNING hits INTO v_hits;
  RETURN v_hits > p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_purchase_result(
  p_company uuid,
  p_store text,
  p_lead integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_paid boolean := false;
  v_refund boolean := false;
  v_other boolean := false;
BEGIN
  IF p_lead IS NULL THEN
    RETURN 'not_evaluated';
  END IF;

  SELECT
    COALESCE(bool_or(lower(nuvemshop_payment_data->>'payment_status') = 'paid'), false),
    COALESCE(bool_or(lower(nuvemshop_payment_data->>'payment_status') IN ('refunded', 'partially_refunded')), false),
    COALESCE(bool_or(
      nuvemshop_order_id IS NOT NULL
      AND COALESCE(lower(nuvemshop_payment_data->>'payment_status'), '') NOT IN ('paid', 'refunded', 'partially_refunded')
    ), false)
  INTO v_paid, v_refund, v_other
  FROM public.opportunities
  WHERE company_id = p_company
    AND lead_id = p_lead
    AND nuvemshop_store_id = p_store
    AND nuvemshop_order_id IS NOT NULL;

  IF v_paid THEN
    RETURN 'ineligible_paid';
  ELSIF v_refund THEN
    RETURN 'pending_refund_rule';
  ELSIF v_other THEN
    RETURN 'payment_inconclusive';
  END IF;
  RETURN 'eligible_limited';
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_commit_signup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_store text;
  v_campaign uuid;
  v_attempt uuid;
  v_email text;
  v_phone text;
  v_name text;
  v_origin text;
  v_hash text;
  v_campaign_row public.nuvemshop_welcome_campaigns%ROWTYPE;
  v_signup public.nuvemshop_welcome_signups%ROWTYPE;
  v_grant public.nuvemshop_welcome_grants%ROWTYPE;
  v_phone_ids integer[];
  v_email_ids integer[];
  v_lead_id integer;
  v_identity text;
  v_eligibility text := 'not_evaluated';
  v_note text;
  v_paid boolean := false;
  v_refund boolean := false;
  v_other boolean := false;
  v_created boolean := false;
  v_apply text;
  v_promo boolean;
  v_grant_ids uuid[] := ARRAY[]::uuid[];
  v_reveal boolean := false;
  v_grant_lead integer;
BEGIN
  IF octet_length(p_payload::text) > 8000 THEN
    RETURN jsonb_build_object('ok', false, 'status', 413, 'code', 'payload_too_large');
  END IF;

  v_company := (p_payload->>'companyId')::uuid;
  v_store := p_payload->>'storeId';
  v_campaign := (p_payload->>'campaignId')::uuid;
  v_attempt := (p_payload->>'attemptId')::uuid;
  v_email := lower(btrim(p_payload->>'email'));
  v_phone := p_payload->>'phone';
  v_name := btrim(p_payload->>'name');
  v_origin := p_payload->>'origin';
  v_hash := p_payload->>'payloadHash';
  v_promo := COALESCE((p_payload->>'promoConsent')::boolean, false);

  SELECT * INTO v_campaign_row
  FROM public.nuvemshop_welcome_campaigns
  WHERE id = v_campaign
    AND company_id = v_company
    AND nuvemshop_store_id = v_store
  FOR UPDATE;

  IF v_email IS NULL OR v_email = '' OR v_phone IS NULL OR v_phone = '' THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'code', 'validation_error');
  END IF;

  IF NOT FOUND OR v_campaign_row.enabled IS NOT TRUE
     OR v_origin IS NULL
     OR v_campaign_row.allowed_origins IS NULL
     OR cardinality(v_campaign_row.allowed_origins) = 0
     OR NOT (v_origin = ANY (v_campaign_row.allowed_origins))
     OR NULLIF(btrim(v_campaign_row.title), '') IS NULL
     OR NULLIF(btrim(v_campaign_row.button_label), '') IS NULL
     OR v_campaign_row.coupon_code IS NULL
     OR v_campaign_row.consent_text IS NULL
     OR v_campaign_row.consent_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'publication_blocked');
  END IF;

  IF p_payload->>'ipHash' IS NOT NULL
     AND public.nuvemshop_welcome_rate_hit('ip:' || md5('welcome-ip:' || (p_payload->>'ipHash')), 10) THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  END IF;
  IF public.nuvemshop_welcome_rate_hit(
       'id:' || md5('welcome-identity:' || v_company::text || ':' || v_email || ':' || v_phone),
       5
     )
     OR public.nuvemshop_welcome_rate_hit(
       'store:' || md5('welcome-store:' || v_company::text || ':' || v_store),
       60
     ) THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited');
  END IF;

  -- Ordem fixa: e-mail e depois telefone. Um contato em comum serializa as duas tentativas.
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-welcome-email:' || v_company::text || ':' || v_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-welcome-phone:' || v_company::text || ':' || v_phone, 0));

  SELECT * INTO v_signup
  FROM public.nuvemshop_welcome_signups
  WHERE company_id = v_company
    AND nuvemshop_store_id = v_store
    AND attempt_id = v_attempt;

  IF FOUND AND v_signup.payload_hash <> v_hash THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'attempt_conflict');
  END IF;

  IF FOUND THEN
    SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
    INTO v_grant_ids
    FROM public.nuvemshop_welcome_grants
    WHERE campaign_id = v_campaign
      AND (signup_id = v_signup.id OR email_key = v_email OR phone_key = v_phone);

    IF COALESCE(cardinality(v_grant_ids), 0) = 1 AND v_signup.lead_id IS NOT NULL
       AND public.nuvemshop_welcome_purchase_result(v_company, v_store, v_signup.lead_id) = 'eligible_limited' THEN
      SELECT * INTO v_grant FROM public.nuvemshop_welcome_grants WHERE id = v_grant_ids[1];
      v_reveal := true;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'repeated', true,
      'grantCreated', false,
      'leadId', v_signup.lead_id,
      'signup', to_jsonb(v_signup),
      'grant', CASE WHEN v_reveal THEN to_jsonb(v_grant) ELSE NULL END
    );
  END IF;

  SELECT array_agg(DISTINCT id) INTO v_phone_ids
  FROM public.leads
  WHERE company_id = v_company
    AND deleted_at IS NULL
    AND phone_normalized = ANY (public.br_mobile_phone_lookup_values(v_phone));

  SELECT array_agg(DISTINCT id) INTO v_email_ids
  FROM public.leads
  WHERE company_id = v_company
    AND deleted_at IS NULL
    AND lower(email) = v_email;

  IF COALESCE(cardinality(v_phone_ids), 0) > 1 OR COALESCE(cardinality(v_email_ids), 0) > 1
     OR (v_phone_ids[1] IS NOT NULL AND v_email_ids[1] IS NOT NULL AND v_phone_ids[1] <> v_email_ids[1]) THEN
    v_identity := 'conflict';
    v_lead_id := NULL;
  ELSIF v_phone_ids[1] IS NOT NULL THEN
    v_identity := 'reuse';
    v_lead_id := v_phone_ids[1];
  ELSIF v_email_ids[1] IS NOT NULL THEN
    v_identity := 'reuse';
    v_lead_id := v_email_ids[1];
  ELSE
    v_identity := 'none';
    v_lead_id := NULL;
  END IF;

  IF v_identity = 'reuse' THEN
    v_eligibility := public.nuvemshop_welcome_purchase_result(v_company, v_store, v_lead_id);
  ELSIF v_identity = 'none' THEN
    v_eligibility := 'eligible_limited';
  END IF;

  IF v_eligibility = 'eligible_limited' THEN
    v_note := 'Nenhuma compra paga foi encontrada no histórico sincronizado. Pedidos ainda não sincronizados podem não aparecer. Isso não comprova primeira compra.';
  ELSIF v_eligibility = 'payment_inconclusive' THEN
    v_note := 'Há pedido sincronizado, mas o status de pagamento local não permite concluir se ele foi pago. Isso não é tratado como ausência de compra.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  INTO v_grant_ids
  FROM public.nuvemshop_welcome_grants
  WHERE campaign_id = v_campaign
    AND (email_key = v_email OR phone_key = v_phone);

  IF COALESCE(cardinality(v_grant_ids), 0) = 1 THEN
    SELECT * INTO v_grant FROM public.nuvemshop_welcome_grants WHERE id = v_grant_ids[1];
    SELECT id INTO v_grant_lead
    FROM public.leads
    WHERE id = v_grant.lead_id
      AND company_id = v_company
      AND deleted_at IS NULL;
  END IF;

  IF v_identity = 'conflict' OR COALESCE(cardinality(v_grant_ids), 0) > 1
     OR (
       COALESCE(cardinality(v_grant_ids), 0) = 1
       AND v_identity = 'reuse'
       AND v_grant_lead IS NOT NULL
       AND v_lead_id IS DISTINCT FROM v_grant.lead_id
     )
     OR (COALESCE(cardinality(v_grant_ids), 0) = 1 AND v_identity = 'none' AND v_grant_lead IS NULL) THEN
    v_identity := 'conflict';
    v_lead_id := NULL;
    v_eligibility := 'not_evaluated';
    v_note := NULL;
    v_grant := NULL;
    v_grant_ids := ARRAY[]::uuid[];
  ELSIF COALESCE(cardinality(v_grant_ids), 0) = 1 THEN
    IF v_identity = 'none' THEN
      v_lead_id := v_grant.lead_id;
      v_identity := 'reuse';
    END IF;
    v_eligibility := public.nuvemshop_welcome_purchase_result(v_company, v_store, v_lead_id);
    v_note := NULL;
    IF v_eligibility = 'eligible_limited' THEN
      v_note := 'Nenhuma compra paga foi encontrada no histórico sincronizado. Pedidos ainda não sincronizados podem não aparecer. Isso não comprova primeira compra.';
      v_reveal := true;
    ELSIF v_eligibility = 'payment_inconclusive' THEN
      v_note := 'Há pedido sincronizado, mas o status de pagamento local não permite concluir se ele foi pago. Isso não é tratado como ausência de compra.';
      v_grant := NULL;
    ELSE
      v_grant := NULL;
    END IF;
  END IF;

  IF v_identity = 'none' AND v_eligibility = 'eligible_limited' AND COALESCE(cardinality(v_grant_ids), 0) = 0 THEN
    INSERT INTO public.leads (company_id, name, email, phone, origin, status, visitor_id, nuvemshop_store_id)
    VALUES (v_company, v_name, v_email, v_phone, 'nuvemshop_popup', 'novo', NULLIF(p_payload->>'visitorId', ''), v_store)
    RETURNING id INTO v_lead_id;
  ELSIF v_identity = 'reuse' AND v_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET
      name = CASE WHEN name IS NULL OR btrim(name) = '' THEN v_name ELSE name END,
      email = CASE WHEN email IS NULL OR btrim(email) = '' THEN v_email ELSE email END,
      phone = CASE WHEN phone IS NULL OR btrim(phone) = '' THEN v_phone ELSE phone END,
      visitor_id = CASE WHEN visitor_id IS NULL OR btrim(visitor_id) = '' THEN NULLIF(p_payload->>'visitorId', '') ELSE visitor_id END
    WHERE id = v_lead_id
      AND company_id = v_company;
  END IF;

  v_apply := v_origin || '/discount/' || v_campaign_row.coupon_code || '?redirect_to=/';

  INSERT INTO public.nuvemshop_welcome_signups (
    company_id, nuvemshop_store_id, campaign_id, attempt_id, payload_hash, identity_key,
    identity_result, eligibility_result, limitation_note, lead_id, visitor_id, session_id, utm,
    coupon_consent, coupon_consent_version, coupon_consented_at,
    promo_consent, promo_consent_version, promo_consented_at
  ) VALUES (
    v_company, v_store, v_campaign, v_attempt, v_hash, v_email || '|' || v_phone,
    v_identity, v_eligibility, v_note, v_lead_id,
    NULLIF(p_payload->>'visitorId', ''), NULLIF(p_payload->>'sessionId', ''),
    COALESCE(p_payload->'utm', '{}'::jsonb),
    true, v_campaign_row.consent_version, now(),
    v_promo, CASE WHEN v_promo THEN v_campaign_row.promo_consent_version ELSE NULL END,
    CASE WHEN v_promo THEN now() ELSE NULL END
  ) RETURNING * INTO v_signup;

  IF COALESCE(cardinality(v_grant_ids), 0) = 0
     AND v_eligibility = 'eligible_limited'
     AND v_lead_id IS NOT NULL THEN
    INSERT INTO public.nuvemshop_welcome_grants (
      company_id, campaign_id, signup_id, lead_id, identity_key, email_key, phone_key, coupon_code, apply_url
    ) VALUES (
      v_company, v_campaign, v_signup.id, v_lead_id, v_signup.identity_key, v_email, v_phone,
      v_campaign_row.coupon_code, v_apply
    )
    RETURNING * INTO v_grant;
    v_created := true;
    v_reveal := true;

    INSERT INTO public.nuvemshop_welcome_automation_jobs (company_id, signup_id, grant_id)
    VALUES (v_company, v_signup.id, v_grant.id);
  ELSIF NOT v_reveal THEN
    v_grant := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'repeated', false,
    'grantCreated', v_created,
    'leadId', v_lead_id,
    'signup', to_jsonb(v_signup),
    'grant', CASE WHEN v_reveal THEN to_jsonb(v_grant) ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_claim_automation(
  p_company uuid,
  p_flow uuid,
  p_signup uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_token uuid;
  v_row public.nuvemshop_welcome_automation_claims%ROWTYPE;
BEGIN
  v_token := gen_random_uuid();
  INSERT INTO public.nuvemshop_welcome_automation_claims (company_id, flow_id, signup_id, lease_token)
  VALUES (p_company, p_flow, p_signup, v_token)
  ON CONFLICT (company_id, flow_id, signup_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'create', 'claim_id', v_id, 'lease_token', v_token);
  END IF;

  SELECT * INTO v_row
  FROM public.nuvemshop_welcome_automation_claims
  WHERE company_id = p_company AND flow_id = p_flow AND signup_id = p_signup
  FOR UPDATE;

  IF v_row.execution_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'resume',
      'claim_id', v_row.id,
      'execution_id', v_row.execution_id,
      'lease_token', v_row.lease_token
    );
  END IF;

  IF v_row.reserved_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('action', 'wait', 'claim_id', v_row.id);
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.nuvemshop_welcome_automation_claims
  SET reserved_at = now(), lease_token = v_token
  WHERE id = v_row.id
    AND execution_id IS NULL
    AND reserved_at = v_row.reserved_at
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('action', 'wait', 'claim_id', v_row.id);
  END IF;
  RETURN jsonb_build_object('action', 'create', 'claim_id', v_id, 'lease_token', v_token, 'recovered', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_bind_claim(
  p_claim uuid,
  p_token uuid,
  p_execution uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.nuvemshop_welcome_automation_claims
  SET execution_id = p_execution
  WHERE id = p_claim
    AND lease_token = p_token
    AND execution_id IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN true;
  END IF;

  SELECT id INTO v_id
  FROM public.nuvemshop_welcome_automation_claims
  WHERE id = p_claim
    AND lease_token = p_token
    AND execution_id = p_execution;

  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_hold_job(
  p_id uuid,
  p_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.nuvemshop_welcome_automation_jobs
  SET locked_at = now(), updated_at = now()
  WHERE id = p_id
    AND lock_token = p_token
    AND status = 'dispatching'
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_finish_job(
  p_id uuid,
  p_token uuid,
  p_status text,
  p_result text,
  p_count_failure boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_status text;
  v_result text;
  v_row public.nuvemshop_welcome_automation_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.nuvemshop_welcome_automation_jobs
  WHERE id = p_id
    AND lock_token = p_token
    AND status = 'dispatching'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  v_attempts := v_row.attempts;
  v_status := p_status;
  v_result := p_result;

  IF p_count_failure THEN
    v_attempts := v_row.attempts + 1;
    IF v_attempts >= 8 THEN
      v_status := 'needs_review';
      v_result := 'retry_exhausted';
    ELSE
      v_status := 'pending';
    END IF;
  END IF;

  UPDATE public.nuvemshop_welcome_automation_jobs
  SET
    status = v_status,
    result = v_result,
    attempts = v_attempts,
    lock_token = NULL,
    locked_at = NULL,
    next_attempt_at = CASE
      WHEN p_count_failure AND v_attempts < 8 THEN now() + (
        CASE v_attempts
          WHEN 1 THEN interval '1 minute'
          WHEN 2 THEN interval '2 minutes'
          WHEN 3 THEN interval '4 minutes'
          WHEN 4 THEN interval '8 minutes'
          WHEN 5 THEN interval '16 minutes'
          WHEN 6 THEN interval '32 minutes'
          ELSE interval '60 minutes'
        END
      )
      WHEN NOT p_count_failure AND v_status = 'pending' THEN now() + interval '2 minutes'
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_id
    AND lock_token = p_token
    AND status = 'dispatching';

  RETURN jsonb_build_object(
    'applied', true,
    'status', v_status,
    'result', v_result,
    'attempts', v_attempts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nuvemshop_welcome_claim_jobs(
  p_limit integer,
  p_signup uuid
)
RETURNS SETOF public.nuvemshop_welcome_automation_jobs
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT candidate.id
    FROM public.nuvemshop_welcome_automation_jobs AS candidate
    WHERE (
      (
        candidate.status = 'pending'
        AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= now())
      )
      OR (
        candidate.status = 'dispatching'
        AND candidate.locked_at < now() - interval '2 minutes'
      )
    )
    AND (p_signup IS NULL OR candidate.signup_id = p_signup)
    ORDER BY candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 20), 0)
  )
  UPDATE public.nuvemshop_welcome_automation_jobs AS job
  SET
    status = 'dispatching',
    lock_token = gen_random_uuid(),
    locked_at = now(),
    updated_at = now()
  FROM claimed
  WHERE job.id = claimed.id
  RETURNING job.*;
END;
$$;

-- Uma execução por empresa, fluxo e submissão do pop-up.
-- A submissão entra na chave estável ns:nuvemshop.popup_signup:{signup_id},
-- gravada por createExecution em trigger_data.dedup_key.
-- O predicado deixa pedidos, carrinho, Instagram e os demais gatilhos de fora.
CREATE UNIQUE INDEX uq_ae_nv_popup_signup
  ON public.automation_executions (
    company_id,
    flow_id,
    (trigger_data ->> 'dedup_key')
  )
  WHERE starts_with(trigger_data ->> 'dedup_key', 'ns:nuvemshop.popup_signup:');

REVOKE ALL ON FUNCTION public.nuvemshop_welcome_rate_hit(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_purchase_result(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_commit_signup(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_claim_automation(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_bind_claim(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_hold_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_finish_job(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nuvemshop_welcome_claim_jobs(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_rate_hit(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_purchase_result(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_commit_signup(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_claim_automation(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_bind_claim(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_hold_job(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_finish_job(uuid, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.nuvemshop_welcome_claim_jobs(integer, uuid) TO service_role;

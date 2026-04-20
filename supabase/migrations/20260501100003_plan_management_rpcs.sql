-- RPC para togglear is_publicly_listed (campo que controla visibilidade na vitrine)
CREATE OR REPLACE FUNCTION public.set_plan_publicly_listed(
  p_plan_id            UUID,
  p_is_publicly_listed BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.plans
  SET is_publicly_listed = p_is_publicly_listed
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- get_plans_full atualizado para incluir is_publicly_listed
DROP FUNCTION IF EXISTS public.get_plans_full();

CREATE FUNCTION public.get_plans_full()
RETURNS TABLE(
  id uuid, name character varying, slug character varying, description text,
  price numeric, currency character varying, billing_cycle character varying,
  is_active boolean, is_popular boolean, is_publicly_listed boolean, sort_order integer,
  max_whatsapp_instances integer, max_leads integer, max_users integer, max_landing_pages integer,
  max_funnels integer, max_funnel_stages integer, max_automation_flows integer,
  max_automation_executions_monthly integer, max_products integer, storage_mb integer,
  features jsonb,
  ai_plan_id uuid, ai_plan_name character varying, ai_plan_slug character varying,
  ai_plan_monthly_credits integer, ai_plan_internal_price numeric, estimated_conversations integer,
  created_at timestamp with time zone, updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'access_denied' USING HINT = 'apenas platform admins podem acessar get_plans_full';
  END IF;
  RETURN QUERY
  SELECT
    p.id, p.name, p.slug, p.description, p.price, p.currency, p.billing_cycle,
    p.is_active, p.is_popular, p.is_publicly_listed, p.sort_order,
    p.max_whatsapp_instances, p.max_leads, p.max_users, p.max_landing_pages,
    p.max_funnels, p.max_funnel_stages, p.max_automation_flows,
    p.max_automation_executions_monthly, p.max_products, p.storage_mb,
    p.features,
    ap.id, ap.name, ap.slug, ap.monthly_credits, ap.internal_price,
    (ap.monthly_credits / NULLIF(50, 0)) AS estimated_conversations,
    p.created_at, p.updated_at
  FROM public.plans p
  LEFT JOIN public.ai_plans ap ON ap.id = p.ai_plan_id
  ORDER BY p.sort_order ASC, p.name ASC;
END;
$$;

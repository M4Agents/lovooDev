-- Seller com reassign_own_leads pode transferir apenas leads que já são dele
-- para um seller ou manager ativo da mesma empresa.
-- A troca propaga o dono das oportunidades abertas e o responsável do chat.
-- service_role, admin da empresa pai e quem tem view_all_leads seguem o fluxo atual.

CREATE OR REPLACE FUNCTION public.classify_lead_responsible_change(
  p_company_id uuid,
  p_old_responsible uuid,
  p_new_responsible uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_perms jsonb;
BEGIN
  IF p_old_responsible IS NOT DISTINCT FROM p_new_responsible THEN
    RETURN 'unchanged';
  END IF;

  -- Automação, importação e lote usam service_role, sem usuário final.
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN 'bypass';
  END IF;

  -- Trilha 2: super_admin / system_admin da empresa pai.
  IF public.auth_user_is_parent_admin(p_company_id) THEN
    RETURN 'bypass';
  END IF;

  SELECT cu.role, cu.permissions
    INTO v_role, v_perms
    FROM public.company_users cu
   WHERE cu.user_id = auth.uid()
     AND cu.company_id = p_company_id
     AND cu.is_active = true;

  IF NOT FOUND THEN
    RETURN 'forbidden';
  END IF;

  -- Quem já redistribui hoje continua pelo caminho amplo.
  IF COALESCE((v_perms ->> 'view_all_leads')::boolean, false) THEN
    RETURN 'bypass';
  END IF;

  IF v_role = 'seller'
     AND COALESCE((v_perms ->> 'reassign_own_leads')::boolean, false)
     AND p_old_responsible = auth.uid()
     AND p_new_responsible IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.company_users target
        WHERE target.user_id = p_new_responsible
          AND target.company_id = p_company_id
          AND target.is_active = true
          AND target.role IN ('seller', 'manager')
     )
  THEN
    RETURN 'seller';
  END IF;

  RETURN 'forbidden';
END;
$$;

REVOKE ALL ON FUNCTION public.classify_lead_responsible_change(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.classify_lead_responsible_change(uuid, uuid, uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public.classify_lead_responsible_change(uuid, uuid, uuid) IS
  'Classifica troca de leads.responsible_user_id: unchanged, bypass, seller ou forbidden. '
  'A trilha seller exige reassign_own_leads, lead já do próprio usuário e destino seller/manager ativo.';


CREATE OR REPLACE FUNCTION public.guard_lead_responsible_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class text;
BEGIN
  v_class := public.classify_lead_responsible_change(
    NEW.company_id,
    OLD.responsible_user_id,
    NEW.responsible_user_id
  );

  IF TG_WHEN = 'BEFORE' THEN
    IF v_class = 'forbidden' THEN
      RAISE EXCEPTION 'Sem permissão para alterar o responsável deste lead'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER: só a trilha estreita do seller propaga oportunidade aberta e chat.
  IF v_class = 'seller' THEN
    UPDATE public.opportunities
       SET owner_user_id = NEW.responsible_user_id,
           updated_at = now()
     WHERE lead_id = NEW.id
       AND company_id = NEW.company_id
       AND status = 'open'
       AND owner_user_id IS DISTINCT FROM NEW.responsible_user_id;

    PERFORM public.sync_lead_responsible_to_conversations(
      NEW.id::integer,
      NEW.responsible_user_id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_lead_responsible_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_lead_responsible_change() FROM anon;
GRANT EXECUTE ON FUNCTION public.guard_lead_responsible_change() TO authenticated, service_role;

COMMENT ON FUNCTION public.guard_lead_responsible_change() IS
  'BEFORE bloqueia troca de responsável fora da regra. '
  'AFTER, na trilha seller, atualiza oportunidades abertas e sincroniza o chat.';


DROP TRIGGER IF EXISTS trg_guard_lead_responsible_before ON public.leads;
CREATE TRIGGER trg_guard_lead_responsible_before
  BEFORE UPDATE OF responsible_user_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lead_responsible_change();

DROP TRIGGER IF EXISTS trg_guard_lead_responsible_after ON public.leads;
CREATE TRIGGER trg_guard_lead_responsible_after
  AFTER UPDATE OF responsible_user_id ON public.leads
  FOR EACH ROW
  WHEN (OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id)
  EXECUTE FUNCTION public.guard_lead_responsible_change();


-- Lista só seller e manager ativos. Exige a permissão no próprio seller.
CREATE OR REPLACE FUNCTION public.get_reassign_own_lead_targets(p_company_id uuid)
RETURNS TABLE(
  id                  uuid,
  user_id             uuid,
  display_name        text,
  email               character varying,
  profile_picture_url text,
  role                text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  IF p_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden: empresa ou sessão ausente'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_user_is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  SELECT
    cu.role = 'seller'
    AND COALESCE((cu.permissions ->> 'reassign_own_leads')::boolean, false)
    INTO v_allowed
  FROM public.company_users cu
  WHERE cu.user_id = auth.uid()
    AND cu.company_id = p_company_id
    AND cu.is_active = true;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'forbidden: permissão reassign_own_leads ausente'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cu.id,
    cu.user_id,
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1)
    )::text AS display_name,
    au.email,
    cu.profile_picture_url,
    cu.role
  FROM public.company_users cu
  LEFT JOIN auth.users au ON cu.user_id = au.id
  WHERE cu.company_id = p_company_id
    AND cu.is_active = true
    AND cu.is_platform_member = false
    AND cu.role IN ('seller', 'manager')
  ORDER BY display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reassign_own_lead_targets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reassign_own_lead_targets(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_reassign_own_lead_targets(uuid) IS
  'Destinos de transferência para seller com reassign_own_leads: seller e manager ativos da mesma empresa.';

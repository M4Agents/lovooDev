-- A policy de leitura exige que o lead continue do próprio seller.
-- O Postgres aplica essa mesma condição à linha nova do UPDATE, então a
-- transferência para outro seller/manager era recusada com 42501 mesmo
-- com o WITH CHECK de membership verdadeiro.
-- O tíquete abaixo só existe durante a transação da trilha seller e só
-- libera a leitura desse lead, para esse destino. Admin continua fora.

CREATE TABLE IF NOT EXISTS public.seller_lead_reassign_tickets (
  lead_id integer PRIMARY KEY,
  company_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  new_responsible uuid NOT NULL,
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_lead_reassign_tickets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.seller_lead_reassign_tickets FROM PUBLIC;
REVOKE ALL ON TABLE public.seller_lead_reassign_tickets FROM anon, authenticated, service_role;

COMMENT ON TABLE public.seller_lead_reassign_tickets IS
  'Tíquete interno da transferência seller. Sem policy e sem grant: só funções SECURITY DEFINER acessam.';


CREATE OR REPLACE FUNCTION public.seller_lead_reassign_visible(
  p_company_id uuid,
  p_lead_id integer,
  p_responsible uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_responsible IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce(current_setting('lovoo.seller_reassign_visible_lead_id', true), '')
       IS DISTINCT FROM p_lead_id::text THEN
    RETURN false;
  END IF;

  IF coalesce(current_setting('lovoo.seller_reassign_nonce', true), '') = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.seller_lead_reassign_tickets t
      JOIN public.company_users target
        ON target.company_id = t.company_id
       AND target.user_id = t.new_responsible
       AND target.is_active = true
       AND target.role IN ('seller', 'manager')
     WHERE t.lead_id = p_lead_id
       AND t.company_id = p_company_id
       AND t.actor_id = auth.uid()
       AND t.new_responsible = p_responsible
       AND t.nonce = current_setting('lovoo.seller_reassign_nonce', true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_lead_reassign_visible(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seller_lead_reassign_visible(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.seller_lead_reassign_visible(uuid, integer, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.seller_lead_reassign_visible(uuid, integer, uuid) IS
  'Verdadeiro só para o lead da transferência seller em andamento, com destino seller ou manager ativo.';


CREATE OR REPLACE FUNCTION public.guard_lead_responsible_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class text;
  v_nonce text;
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

    IF v_class = 'seller' THEN
      v_nonce := gen_random_uuid()::text;

      DELETE FROM public.seller_lead_reassign_tickets
       WHERE created_at < now() - interval '10 minutes';

      INSERT INTO public.seller_lead_reassign_tickets (
        lead_id, company_id, actor_id, new_responsible, nonce
      ) VALUES (
        NEW.id, NEW.company_id, auth.uid(), NEW.responsible_user_id, v_nonce
      )
      ON CONFLICT (lead_id) DO UPDATE
        SET company_id = EXCLUDED.company_id,
            actor_id = EXCLUDED.actor_id,
            new_responsible = EXCLUDED.new_responsible,
            nonce = EXCLUDED.nonce,
            created_at = now();

      PERFORM set_config('lovoo.seller_reassign_visible_lead_id', NEW.id::text, true);
      PERFORM set_config('lovoo.seller_reassign_nonce', v_nonce, true);
    END IF;

    RETURN NEW;
  END IF;

  IF v_class = 'seller' THEN
    PERFORM set_config('lovoo.seller_lead_reassign_lead_id', NEW.id::text, true);

    UPDATE public.opportunities
       SET owner_user_id = NEW.responsible_user_id,
           updated_at = now()
     WHERE lead_id = NEW.id
       AND company_id = NEW.company_id
       AND status = 'open'
       AND owner_user_id IS DISTINCT FROM NEW.responsible_user_id;

    PERFORM set_config('lovoo.seller_lead_reassign_lead_id', '', true);

    PERFORM public.sync_lead_responsible_to_conversations(
      NEW.id::integer,
      NEW.responsible_user_id
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_lead_responsible_change() IS
  'BEFORE bloqueia troca fora da regra e, na trilha seller, abre um tíquete só deste lead. '
  'AFTER propaga oportunidade aberta e chat. Admin não entra nesta trilha.';


ALTER POLICY leads_member_or_parent_admin
  ON public.leads
  USING (
    (current_setting('role'::text) = 'service_role'::text)
    OR (
      (auth.uid() IS NOT NULL)
      AND (auth_user_is_company_member(company_id) OR auth_user_is_parent_admin(company_id))
      AND (
        (NOT auth_user_restricted_to_own_leads(company_id))
        OR (responsible_user_id = auth.uid())
        OR (
          CASE
            WHEN coalesce(current_setting('lovoo.seller_reassign_visible_lead_id', true), '') = ''
              THEN false
            ELSE public.seller_lead_reassign_visible(company_id, id, responsible_user_id)
          END
        )
      )
    )
  );

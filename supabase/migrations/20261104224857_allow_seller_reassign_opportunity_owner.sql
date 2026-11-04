-- A trilha seller (reassign_own_leads) já pode gravar leads.responsible_user_id
-- para outro seller ou manager ativo. A propagação para opportunities.owner_user_id
-- era desfeita por protect_opportunity_owner_reassign, que só reconhecia gestão.
-- Admin continua fora desta trilha.

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
    -- Marca local da transação. O gatilho da oportunidade só aceita esta
    -- propagação para o lead que acabou de ser classificado.
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
  'BEFORE bloqueia troca de responsável fora da regra. '
  'AFTER, na trilha seller, atualiza oportunidades abertas e sincroniza o chat. '
  'A marca lovoo.seller_lead_reassign_lead_id vale só nesta transação.';


CREATE OR REPLACE FUNCTION public.protect_opportunity_owner_reassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id THEN
    RETURN NEW;
  END IF;

  -- Propagação do gatilho do lead. O destino já foi validado como seller ou
  -- manager ativo. Admin, partner e responsável vazio não passam aqui.
  IF current_setting('lovoo.seller_lead_reassign_lead_id', true) = OLD.lead_id::text
     AND NEW.owner_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.company_users target
        WHERE target.user_id = NEW.owner_user_id
          AND target.company_id = OLD.company_id
          AND target.is_active = true
          AND target.role IN ('seller', 'manager')
     )
  THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.company_users cu
     WHERE cu.user_id = auth.uid()
       AND cu.company_id = OLD.company_id
       AND cu.is_active = true
       AND cu.role IN ('super_admin', 'support', 'admin', 'partner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Apenas administradores e gerentes podem reatribuir o responsável pela oportunidade';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_opportunity_owner_reassign() IS
  'Bloqueia troca direta de opportunities.owner_user_id por seller. '
  'Aceita a propagação da trilha reassign_own_leads quando o destino é seller ou manager ativo.';

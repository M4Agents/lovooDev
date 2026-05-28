-- Migration: expor responsible_user_id na RPC get_leads_for_notifications
-- Necessário para filtrar notificações de duplicatas por dono do lead
-- quando a restrição restrict_leads_to_owner está ativa na empresa.

DROP FUNCTION IF EXISTS public.get_leads_for_notifications(integer[], uuid);

CREATE OR REPLACE FUNCTION public.get_leads_for_notifications(
  p_lead_ids integer[],
  p_company_id uuid
)
RETURNS TABLE(
  id smallint,
  name text,
  email text,
  phone text,
  responsible_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT l.id, l.name, l.email, l.phone, l.responsible_user_id
  FROM leads l
  WHERE l.id = ANY(p_lead_ids)
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL
    AND (l.duplicate_status IS NULL OR l.duplicate_status != 'merged');
END;
$function$;

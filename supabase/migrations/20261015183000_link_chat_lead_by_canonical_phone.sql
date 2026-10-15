-- =====================================================
-- Liga a conversa ao lead quando o WhatsApp omite o 9º dígito.
--
-- Não altera contact_phone, não altera leads.phone e não funde leads.
-- A view passa a devolver um único lead por conversa:
--   1) chat_conversations.lead_id, se o telefone canônico for o mesmo
--      ou se o lead não tiver telefone
--   2) senão, um lead ativo da mesma empresa cujo phone_normalized
--      esteja entre as variantes (cru, canônico, JID sem o 9, nacional de 11)
--
-- Fixo (assinante começando em 2–5) não recebe o 9.
-- =====================================================

CREATE OR REPLACE FUNCTION public.br_mobile_phone_lookup_values(p_phone text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT v), ARRAY[]::text[])
  FROM (
    SELECT regexp_replace(p_phone, '[^0-9]', '', 'g') AS v
    UNION ALL
    SELECT public.canonicalize_br_mobile_phone(p_phone)
    UNION ALL
    SELECT CASE
      WHEN length(c.canon) = 13
       AND left(c.canon, 2) = '55'
       AND substring(c.canon FROM 5 FOR 1) = '9'
      THEN left(c.canon, 4) || substring(c.canon FROM 6)
    END
    FROM (SELECT public.canonicalize_br_mobile_phone(p_phone) AS canon) c
    UNION ALL
    SELECT CASE
      WHEN length(c.canon) = 13
       AND left(c.canon, 2) = '55'
       AND substring(c.canon FROM 5 FOR 1) = '9'
      THEN right(c.canon, 11)
    END
    FROM (SELECT public.canonicalize_br_mobile_phone(p_phone) AS canon) c
  ) s
  WHERE v IS NOT NULL AND v <> '';
$$;

COMMENT ON FUNCTION public.br_mobile_phone_lookup_values(text) IS
  'Variantes de telefone móvel BR para lookup: dígitos, canônico com 9º, JID sem 9º e nacional de 11 dígitos.';

REVOKE ALL ON FUNCTION public.br_mobile_phone_lookup_values(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.br_mobile_phone_lookup_values(text) TO anon;
GRANT EXECUTE ON FUNCTION public.br_mobile_phone_lookup_values(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.br_mobile_phone_lookup_values(text) TO service_role;

CREATE OR REPLACE VIEW public.chat_conversations_with_leads AS
SELECT
    cc.id,
    cc.company_id,
    COALESCE(cc.instance_id, cc.last_instance_id) AS instance_id,
    cc.contact_phone,
    COALESCE(
        NULLIF(l.name, ''::text),
        NULLIF(ctc.name::text, ''::text),
        cc.contact_name::text
    ) AS contact_name,
    ctc.profile_picture_url,
    cc.assigned_to,
    cc.last_message_at,
    cc.last_message_content,
    cc.last_message_direction,
    cc.unread_count,
    cc.status,
    cc.created_at,
    cc.updated_at,
    l.id AS lead_id,
    l.name AS lead_name,
    ctc.name AS chat_contact_name,
    cc.contact_name AS original_contact_name,
    l.company_name
FROM chat_conversations cc
LEFT JOIN LATERAL (
    SELECT
        picked.id,
        picked.name,
        picked.company_name
    FROM leads picked
    WHERE picked.company_id = cc.company_id
      AND picked.deleted_at IS NULL
      AND (
        (
          picked.id = cc.lead_id
          AND (
            NULLIF(btrim(picked.phone), '') IS NULL
            OR public.canonicalize_br_mobile_phone(picked.phone)
               IS NOT DISTINCT FROM public.canonicalize_br_mobile_phone(cc.contact_phone)
          )
        )
        OR picked.phone_normalized = ANY (public.br_mobile_phone_lookup_values(cc.contact_phone))
      )
    ORDER BY
      CASE
        WHEN picked.id = cc.lead_id
         AND (
           NULLIF(btrim(picked.phone), '') IS NULL
           OR public.canonicalize_br_mobile_phone(picked.phone)
              IS NOT DISTINCT FROM public.canonicalize_br_mobile_phone(cc.contact_phone)
         )
        THEN 0
        ELSE 1
      END,
      picked.created_at ASC,
      picked.id ASC
    LIMIT 1
) l ON true
LEFT JOIN chat_contacts ctc
    ON ctc.company_id = cc.company_id
   AND ctc.phone_number::text = cc.contact_phone::text;

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_filter_type character varying,
  p_instance_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations        jsonb;
  v_visibility_restricted boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM companies
    WHERE id = p_company_id AND user_id = p_user_id
    UNION
    SELECT 1 FROM company_users
    WHERE company_id = p_company_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Acesso negado à empresa'
    );
  END IF;

  v_visibility_restricted := public.auth_chat_visibility_restricted(p_company_id);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                     sub.id,
      'company_id',             sub.company_id,
      'instance_id',            sub.instance_id,
      'contact_phone',          sub.contact_phone,
      'contact_name',           sub.contact_name,
      'lead_id',                sub.lead_id,
      'profile_picture_url',    sub.profile_picture_url,
      'company_name',           sub.company_name,
      'is_lead_over_plan',      sub.is_lead_over_plan,
      'ai_state',               sub.ai_state,
      'ai_assignment_id',       sub.ai_assignment_id,
      'assigned_to',            sub.assigned_to,
      'last_message_at',        sub.last_message_at,
      'last_message_content',   sub.last_message_content,
      'last_message_direction', sub.last_message_direction,
      'unread_count',           sub.unread_count,
      'status',                 sub.status,
      'instance_name',          sub.instance_name,
      'instance_status',        sub.instance_status,
      'instance_deleted',       sub.instance_deleted,
      'created_at',             sub.created_at,
      'updated_at',             sub.updated_at
    ) ORDER BY sub.last_message_at DESC NULLS LAST
  )
  INTO v_conversations
  FROM (
    SELECT
      ccl.id,
      ccl.company_id,
      ccl.instance_id,
      CASE WHEN COALESCE(l.is_over_plan, false) THEN NULL ELSE ccl.contact_phone END  AS contact_phone,
      ccl.contact_name,
      ccl.lead_id,
      ccl.profile_picture_url,
      ccl.company_name,
      COALESCE(l.is_over_plan, false)                                                  AS is_lead_over_plan,
      cc.ai_state,
      cc.ai_assignment_id,
      CASE
        WHEN ccl.assigned_to IS NOT NULL
        THEN jsonb_build_object('id', ccl.assigned_to, 'email', au.email)
        ELSE NULL
      END                                                                               AS assigned_to,
      ccl.last_message_at,
      CASE WHEN COALESCE(l.is_over_plan, false) THEN NULL ELSE ccl.last_message_content END AS last_message_content,
      ccl.last_message_direction,
      ccl.unread_count,
      ccl.status,
      COALESCE(wli.instance_name, 'Instância Desconectada')  AS instance_name,
      COALESCE(wli.status, 'disconnected')                   AS instance_status,
      (wli.deleted_at IS NOT NULL)                           AS instance_deleted,
      ccl.created_at,
      ccl.updated_at

    FROM chat_conversations_with_leads ccl
    LEFT JOIN auth.users           au  ON au.id  = ccl.assigned_to
    LEFT JOIN whatsapp_life_instances wli ON wli.id = ccl.instance_id
    LEFT JOIN chat_conversations    cc  ON cc.id  = ccl.id
    LEFT JOIN leads                 l   ON l.id   = ccl.lead_id AND l.deleted_at IS NULL

    WHERE ccl.company_id = p_company_id
      AND (
        p_instance_id IS NULL
        OR
        wli.phone_number = (
          SELECT phone_number
          FROM whatsapp_life_instances
          WHERE id = p_instance_id
        )
      )
      AND CASE
        WHEN p_filter_type = 'assigned'   THEN ccl.assigned_to = p_user_id
        WHEN p_filter_type = 'unassigned' THEN ccl.assigned_to IS NULL
        ELSE TRUE
      END
      AND (
        NOT v_visibility_restricted
        OR ccl.assigned_to = p_user_id
      )
      AND ccl.status = 'active'
      AND (
        NULLIF(trim(p_search), '') IS NULL
        OR ccl.contact_name  ILIKE '%' || trim(p_search) || '%'
        OR ccl.contact_phone ILIKE '%' || trim(p_search) || '%'
        OR (
          length(regexp_replace(trim(p_search), '[^0-9]', '', 'g')) >= 10
          AND ccl.contact_phone = ANY (public.br_mobile_phone_lookup_values(trim(p_search)))
        )
      )

    ORDER BY ccl.last_message_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset

  ) sub;

  RETURN jsonb_build_object(
    'success', TRUE,
    'data', COALESCE(v_conversations, '[]'::jsonb)
  );
END;
$function$;

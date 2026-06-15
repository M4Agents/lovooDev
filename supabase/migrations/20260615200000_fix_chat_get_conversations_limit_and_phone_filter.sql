-- =============================================================================
-- Fix chat_get_conversations: dois bugs corrigidos na mesma migration
--
-- BUG 1 — LIMIT ineficaz:
--   O LIMIT/OFFSET estava posicionado FORA do jsonb_agg. Como jsonb_agg
--   sempre retorna exatamente 1 linha (o array JSON completo), LIMIT 50
--   limitava o número de linhas do SELECT externo (1), não o número de
--   conversas dentro do array. Resultado: todos os registros eram retornados
--   independentemente do valor de p_limit.
--   Correção: LIMIT/OFFSET movido para uma subquery interna, aplicada ANTES
--   da agregação.
--
-- BUG 2 — Instâncias recriadas com mesmo número perdem conversas históricas:
--   O filtro original era `ccl.instance_id = p_instance_id`, que exigia
--   correspondência exata de UUID. Quando uma instância era deletada e uma
--   nova criada com o mesmo número de telefone, as conversas antigas ficavam
--   vinculadas ao ID da instância deletada e deixavam de aparecer.
--   Correção: o filtro passa a usar phone_number da instância selecionada,
--   incluindo conversas de todas as instâncias (ativas ou deletadas) com o
--   mesmo número.
--
-- Nenhum parâmetro externo alterado. Todos os campos retornados são idênticos
-- à versão anterior. SECURITY DEFINER, company_id e validação de acesso
-- permanecem intocados.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id  uuid,
  p_user_id     uuid,
  p_filter_type character varying,
  p_instance_id uuid    DEFAULT NULL::uuid,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations jsonb;
BEGIN
  -- Validar acesso à empresa: aceita o dono OU membros ativos via company_users
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

  -- BUG 1 FIX: LIMIT/OFFSET aplicado na subquery (antes do jsonb_agg)
  -- BUG 2 FIX: filtro por phone_number inclui instâncias recriadas com mesmo número
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
      -- Telefone: mascarado se o lead estiver fora do plano
      CASE WHEN COALESCE(l.is_over_plan, false) THEN NULL ELSE ccl.contact_phone END  AS contact_phone,
      ccl.contact_name,
      ccl.lead_id,
      ccl.profile_picture_url,
      ccl.company_name,
      -- Flag que indica lead restrito
      COALESCE(l.is_over_plan, false)                                                  AS is_lead_over_plan,
      -- Campos de IA
      cc.ai_state,
      cc.ai_assignment_id,
      -- Responsável
      CASE
        WHEN ccl.assigned_to IS NOT NULL
        THEN jsonb_build_object('id', ccl.assigned_to, 'email', au.email)
        ELSE NULL
      END                                                                               AS assigned_to,
      ccl.last_message_at,
      -- Conteúdo da última mensagem: mascarado se lead restrito
      CASE WHEN COALESCE(l.is_over_plan, false) THEN NULL ELSE ccl.last_message_content END AS last_message_content,
      ccl.last_message_direction,
      ccl.unread_count,
      ccl.status,
      -- Dados da instância vinculada (pode ser deletada)
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
        -- Sem filtro de instância → retorna todas
        p_instance_id IS NULL
        OR
        -- Com filtro: inclui conversas de TODAS as instâncias com o mesmo número
        -- de telefone, garantindo que instâncias recriadas mostrem histórico completo
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
      AND ccl.status = 'active'

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

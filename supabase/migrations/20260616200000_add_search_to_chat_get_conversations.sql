-- =============================================================================
-- FASE 5ZG — Adiciona parâmetro p_search à chat_get_conversations
--
-- MUDANÇA:
--   Novo parâmetro opcional: p_search TEXT DEFAULT NULL
--   Novo AND na cláusula WHERE da subquery interna:
--     AND (
--       NULLIF(trim(p_search), '') IS NULL
--       OR ccl.contact_name  ILIKE '%' || trim(p_search) || '%'
--       OR ccl.contact_phone ILIKE '%' || trim(p_search) || '%'
--     )
--
-- SEGURANÇA DO FILTRO:
--   NULLIF(trim(p_search), '') IS NULL protege contra:
--     - p_search = NULL  → filtro inativo (comportamento normal)
--     - p_search = ''    → filtro inativo (não expõe dados)
--     - p_search = '   ' → filtro inativo (espaços viram NULL após trim)
--
-- INVARIANTES (nada abaixo muda):
--   - Todos os parâmetros existentes preservados com mesmos defaults
--   - v_visibility_restricted e guard assigned_to inalterados (FASE 5ZC)
--   - SECURITY DEFINER preservado
--   - Retorno JSON idêntico
--   - LIMIT/OFFSET/ORDER BY inalterados
--   - Chamadas sem p_search se comportam exatamente igual (DEFAULT NULL)
--   - RLS não alterado
--   - auth_chat_visibility_restricted() não alterada
--   - available_to_all não alterado
--
-- NOTA: O DROP abaixo é necessário porque CREATE OR REPLACE com assinatura
-- diferente cria um novo overload ao invés de substituir a função existente,
-- causando ambiguidade quando a função é chamada sem p_search.
-- A versão de 7 parâmetros é 100% backward-compatible (DEFAULT NULL).
-- =============================================================================

-- Drop do overload antigo (6 parâmetros) para evitar ambiguidade de resolução
DROP FUNCTION IF EXISTS public.chat_get_conversations(
  uuid, uuid, character varying, uuid, integer, integer
);

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id  uuid,
  p_user_id     uuid,
  p_filter_type character varying,
  p_instance_id uuid    DEFAULT NULL::uuid,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0,
  p_search      text    DEFAULT NULL        -- FASE 5ZG: busca por nome/telefone (opcional)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations        jsonb;
  v_visibility_restricted boolean; -- FASE 5ZC: computado uma vez, usado no WHERE
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

  -- FASE 5ZC: verifica UMA VEZ se o caller é seller em empresa com flag ativa.
  -- auth_chat_visibility_restricted usa auth.uid() internamente (funciona em SECURITY DEFINER).
  -- Resultado: TRUE = seller restrito, FALSE = admin/manager/outros (sem restrição).
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
      -- FASE 5ZC: enforcement de visibilidade no banco, antes do LIMIT/OFFSET.
      -- Seller restrito vê SOMENTE conversas atribuídas a si.
      -- Admin/manager/system_admin/super_admin: v_visibility_restricted=false → NOT false=true → sem restrição.
      AND (
        NOT v_visibility_restricted
        OR ccl.assigned_to = p_user_id
      )
      AND ccl.status = 'active'
      -- FASE 5ZG: filtro de busca textual (só ativo quando p_search não é NULL nem vazio).
      -- NULLIF(trim(p_search),'') protege contra string vazia e espaços que gerariam ILIKE '%%'.
      -- Aplicado APÓS o guard de visibilidade: seller nunca encontra conversa de outro seller.
      AND (
        NULLIF(trim(p_search), '') IS NULL
        OR ccl.contact_name  ILIKE '%' || trim(p_search) || '%'
        OR ccl.contact_phone ILIKE '%' || trim(p_search) || '%'
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

-- =============================================================================
-- MIGRATION: Chat Visibility by Assigned To — RPC Enforcement
-- Data: 2026-06-11
-- Fase: 5I
--
-- Objetivo:
--   Adicionar guards de enforcement da feature flag chat_visibility_by_assigned_to
--   nas RPCs SECURITY DEFINER do módulo de chat.
--
-- Pré-requisito:
--   Migration 20260611200000_chat_visibility_flag_rls_cleanup.sql deve estar
--   aplicada (cria a coluna e a função auth_chat_visibility_restricted()).
--
-- RPCs alteradas:
--   1. chat_get_conversations         — filtro no WHERE da query principal
--   2. chat_get_messages (Overload A)  — guard após existence check
--   3. chat_get_messages (Overload B)  — guard após existence check (overload principal)
--   4. chat_get_messages_before_timestamp — guard após existence check
--   5. chat_create_message            — guard com isenção service_role
--   6. chat_mark_conversation_as_read — guard de visibilidade
--   7. chat_assign_conversation       — guard contra auto-atribuição invisível
--
-- Comportamento quando flag = FALSE (default):
--   auth_chat_visibility_restricted() retorna FALSE → guards nunca ativam →
--   comportamento 100% idêntico ao atual para todas as empresas.
--
-- Isenção service_role em chat_create_message:
--   current_setting('role', true) = 'service_role' → guard ignorado.
--   Cobre: agentes IA, automações, webhook WhatsApp, cron.
--   Os demais RPCs não precisam da isenção explícita pois auth.uid() = NULL
--   quando chamados via service_role → auth_chat_visibility_restricted() retorna
--   FALSE automaticamente (nenhum seller encontrado para uid NULL).
--
-- Rollback:
--   CREATE OR REPLACE FUNCTION de cada RPC com a versão anterior.
--   As versões anteriores estão nos snapshots indicados em cada seção.
-- =============================================================================


-- =============================================================================
-- RPC 1: chat_get_conversations
--
-- Alteração:
--   [ADICIONA] v_is_restricted BOOLEAN via auth_chat_visibility_restricted()
--   [ADICIONA] AND condicional no WHERE da query principal
--
-- Snapshot de referência: migration 20260514190000_fix_chat_rpcs_parent_admin_access.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id   uuid,
  p_user_id      uuid,
  p_filter_type  character varying,
  p_instance_id  uuid    DEFAULT NULL::uuid,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations jsonb;
  v_has_access    boolean;
  v_is_restricted boolean := false;
BEGIN
  -- Trilha 1: membership direto
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE company_id = p_company_id
      AND user_id    = p_user_id
      AND is_active  = true
  ) INTO v_has_access;

  -- Trilha 2: super_admin / system_admin da empresa pai
  IF NOT v_has_access THEN
    SELECT public.auth_user_is_parent_admin(p_company_id) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Acesso negado à empresa'
    );
  END IF;

  -- Verificar se a restrição de visibilidade por responsável se aplica ao caller.
  -- auth_chat_visibility_restricted() retorna TRUE apenas quando:
  --   companies.chat_visibility_by_assigned_to = TRUE E caller.role = 'seller'.
  -- É STABLE: cacheado por transação (uma leitura em companies + company_users).
  SELECT public.auth_chat_visibility_restricted(p_company_id) INTO v_is_restricted;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                    ccl.id,
      'company_id',            ccl.company_id,
      'instance_id',           ccl.instance_id,
      'contact_phone',         CASE
                                 WHEN COALESCE(l.is_over_plan, false) THEN NULL
                                 ELSE ccl.contact_phone
                               END,
      'contact_name',          ccl.contact_name,
      'lead_id',               ccl.lead_id,
      'profile_picture_url',   ccl.profile_picture_url,
      'company_name',          ccl.company_name,
      'is_lead_over_plan',     COALESCE(l.is_over_plan, false),
      'ai_state',              cc.ai_state,
      'ai_assignment_id',      cc.ai_assignment_id,
      'assigned_to',           CASE
                                 WHEN ccl.assigned_to IS NOT NULL THEN
                                   jsonb_build_object(
                                     'id',    ccl.assigned_to,
                                     'email', au.email
                                   )
                                 ELSE NULL
                               END,
      'last_message_at',       ccl.last_message_at,
      'last_message_content',  CASE
                                 WHEN COALESCE(l.is_over_plan, false) THEN NULL
                                 ELSE ccl.last_message_content
                               END,
      'last_message_direction', ccl.last_message_direction,
      'unread_count',          ccl.unread_count,
      'status',                ccl.status,
      'instance_name',         COALESCE(wli.instance_name, 'Instância Desconectada'),
      'instance_status',       COALESCE(wli.status, 'disconnected'),
      'instance_deleted',      CASE WHEN wli.deleted_at IS NOT NULL THEN true ELSE false END,
      'created_at',            ccl.created_at,
      'updated_at',            ccl.updated_at
    ) ORDER BY ccl.last_message_at DESC NULLS LAST
  ) INTO v_conversations
  FROM chat_conversations_with_leads ccl
  LEFT JOIN auth.users                au  ON ccl.assigned_to  = au.id
  LEFT JOIN whatsapp_life_instances   wli ON ccl.instance_id  = wli.id
  LEFT JOIN chat_conversations        cc  ON cc.id            = ccl.id
  LEFT JOIN leads                     l   ON l.id             = ccl.lead_id AND l.deleted_at IS NULL
  WHERE ccl.company_id = p_company_id
    AND (
      p_instance_id IS NULL OR
      ccl.instance_id = p_instance_id OR
      (ccl.instance_id IS NULL AND p_instance_id IS NULL)
    )
    AND CASE
          WHEN p_filter_type = 'assigned'   THEN ccl.assigned_to = p_user_id
          WHEN p_filter_type = 'unassigned' THEN ccl.assigned_to IS NULL
          ELSE TRUE
        END
    AND ccl.status = 'active'
    -- Guard de visibilidade por responsável.
    -- v_is_restricted = FALSE (default) → condição sempre verdadeira (sem impacto).
    -- v_is_restricted = TRUE (seller com flag ativa) → filtra por assigned_to.
    AND (
      NOT v_is_restricted
      OR ccl.assigned_to = auth.uid()
      OR ccl.assigned_to IS NULL
    )
  LIMIT p_limit OFFSET p_offset;

  RETURN jsonb_build_object(
    'success', TRUE,
    'data',    COALESCE(v_conversations, '[]'::jsonb)
  );
END;
$function$;


-- =============================================================================
-- RPC 2: chat_get_messages — Overload A (5 parâmetros)
-- Assinatura: (conversation_id, company_id, limit, offset, user_id?)
--
-- Alteração:
--   [ADICIONA] Guard de acesso após verificação de existência da conversa.
--   Quando a restrição está ativa, verifica se assigned_to = auth.uid() ou NULL.
--
-- Snapshot de referência: migration 20260506220000_update_chat_get_messages_reactions.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0,
  p_user_id         UUID    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_messages JSONB;
  v_count    INTEGER;
BEGIN
  IF p_conversation_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'conversation_id e company_id são obrigatórios'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence à empresa'
    );
  END IF;

  -- Guard de visibilidade por responsável.
  -- Ativa apenas quando: flag = TRUE E caller.role = seller.
  -- Quando auth.uid() = NULL (service_role): helper retorna FALSE → guard não ativa.
  IF public.auth_chat_visibility_restricted(p_company_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = p_company_id
        AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado a esta conversa'
      );
    END IF;
  END IF;

  WITH paginated_ids AS (
    SELECT m.id,
           COALESCE(m.timestamp, m.created_at) AS sort_ts
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY COALESCE(m.timestamp, m.created_at) ASC
    LIMIT  p_limit
    OFFSET p_offset
  ),
  emoji_counts AS (
    SELECT
      r.message_id,
      r.emoji,
      COUNT(*)                                                           AS cnt,
      bool_or(p_user_id IS NOT NULL AND r.user_id = p_user_id)          AS reacted_by_me
    FROM chat_message_reactions r
    WHERE r.message_id  IN (SELECT id FROM paginated_ids)
      AND r.company_id   = p_company_id
      AND r.removed_at   IS NULL
    GROUP BY r.message_id, r.emoji
  ),
  reaction_aggs AS (
    SELECT
      ec.message_id,
      jsonb_agg(
        jsonb_build_object(
          'emoji',         ec.emoji,
          'count',         ec.cnt,
          'reacted_by_me', ec.reacted_by_me
        )
        ORDER BY ec.cnt DESC
      ) AS reactions,
      MAX(CASE WHEN ec.reacted_by_me THEN ec.emoji END) AS my_reaction
    FROM emoji_counts ec
    GROUP BY ec.message_id
  ),
  ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')     AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')      AS status,
      COALESCE(m.is_scheduled, false)      AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      pi.sort_ts                           AS timestamp,
      m.created_at,
      m.updated_at,
      COALESCE(m.is_ai_generated, false)   AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type,
      m.reply_to_message_id,
      rm.content                           AS reply_to_content,
      rm.direction                         AS reply_to_direction,
      rm.message_type                      AS reply_to_message_type,
      ra.reactions                         AS reactions,
      ra.my_reaction                       AS my_reaction
    FROM paginated_ids pi
    JOIN chat_messages m ON m.id = pi.id
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
    LEFT JOIN reaction_aggs ra ON ra.message_id = m.id
    ORDER BY pi.sort_ts ASC
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    om.id,
        'conversation_id',       om.conversation_id,
        'company_id',            om.company_id,
        'instance_id',           om.instance_id,
        'message_type',          om.message_type,
        'content',               om.content,
        'media_url',             om.media_url,
        'direction',             om.direction,
        'status',                om.status,
        'is_scheduled',          om.is_scheduled,
        'scheduled_for',         om.scheduled_for,
        'sent_by',               om.sent_by,
        'uazapi_message_id',     om.uazapi_message_id,
        'timestamp',             om.timestamp,
        'created_at',            om.created_at,
        'updated_at',            om.updated_at,
        'is_ai_generated',       om.is_ai_generated,
        'ai_run_id',             om.ai_run_id,
        'ai_block_index',        om.ai_block_index,
        'ai_block_type',         om.ai_block_type,
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type,
        'reactions',             om.reactions,
        'my_reaction',           om.my_reaction
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id;

  RETURN jsonb_build_object(
    'success',     true,
    'data',        v_messages,
    'total_count', v_count,
    'limit',       p_limit,
    'offset',      p_offset
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;


-- =============================================================================
-- RPC 3: chat_get_messages — Overload B (6 parâmetros, principal do frontend)
-- Assinatura: (conversation_id, company_id, limit, offset, reverse_order, user_id?)
--
-- Alteração: idêntica ao Overload A — guard após existence check.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages(
  p_conversation_id UUID,
  p_company_id      UUID,
  p_limit           INTEGER DEFAULT 50,
  p_offset          INTEGER DEFAULT 0,
  p_reverse_order   BOOLEAN DEFAULT false,
  p_user_id         UUID    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_messages JSONB;
  v_count    INTEGER;
BEGIN
  IF p_conversation_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'conversation_id e company_id são obrigatórios'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence à empresa'
    );
  END IF;

  -- Guard de visibilidade por responsável (idêntico ao Overload A).
  IF public.auth_chat_visibility_restricted(p_company_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = p_company_id
        AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado a esta conversa'
      );
    END IF;
  END IF;

  WITH paginated_ids AS (
    SELECT m.id,
           COALESCE(m.timestamp, m.created_at) AS sort_ts
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
    ORDER BY
      CASE WHEN     p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END DESC,
      CASE WHEN NOT p_reverse_order THEN COALESCE(m.timestamp, m.created_at) END ASC
    LIMIT  p_limit
    OFFSET p_offset
  ),
  emoji_counts AS (
    SELECT
      r.message_id,
      r.emoji,
      COUNT(*)                                                           AS cnt,
      bool_or(p_user_id IS NOT NULL AND r.user_id = p_user_id)          AS reacted_by_me
    FROM chat_message_reactions r
    WHERE r.message_id  IN (SELECT id FROM paginated_ids)
      AND r.company_id   = p_company_id
      AND r.removed_at   IS NULL
    GROUP BY r.message_id, r.emoji
  ),
  reaction_aggs AS (
    SELECT
      ec.message_id,
      jsonb_agg(
        jsonb_build_object(
          'emoji',         ec.emoji,
          'count',         ec.cnt,
          'reacted_by_me', ec.reacted_by_me
        )
        ORDER BY ec.cnt DESC
      ) AS reactions,
      MAX(CASE WHEN ec.reacted_by_me THEN ec.emoji END) AS my_reaction
    FROM emoji_counts ec
    GROUP BY ec.message_id
  ),
  ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')     AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')      AS status,
      COALESCE(m.is_scheduled, false)      AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      pi.sort_ts                           AS timestamp,
      m.created_at,
      m.updated_at,
      COALESCE(m.is_ai_generated, false)   AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type,
      m.reply_to_message_id,
      rm.content                           AS reply_to_content,
      rm.direction                         AS reply_to_direction,
      rm.message_type                      AS reply_to_message_type,
      ra.reactions                         AS reactions,
      ra.my_reaction                       AS my_reaction
    FROM paginated_ids pi
    JOIN chat_messages m ON m.id = pi.id
    LEFT JOIN chat_messages rm
      ON rm.id         = m.reply_to_message_id
     AND rm.company_id = m.company_id
    LEFT JOIN reaction_aggs ra ON ra.message_id = m.id
    ORDER BY pi.sort_ts ASC
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                    om.id,
        'conversation_id',       om.conversation_id,
        'company_id',            om.company_id,
        'instance_id',           om.instance_id,
        'message_type',          om.message_type,
        'content',               om.content,
        'media_url',             om.media_url,
        'direction',             om.direction,
        'status',                om.status,
        'is_scheduled',          om.is_scheduled,
        'scheduled_for',         om.scheduled_for,
        'sent_by',               om.sent_by,
        'uazapi_message_id',     om.uazapi_message_id,
        'timestamp',             om.timestamp,
        'created_at',            om.created_at,
        'updated_at',            om.updated_at,
        'is_ai_generated',       om.is_ai_generated,
        'ai_run_id',             om.ai_run_id,
        'ai_block_index',        om.ai_block_index,
        'ai_block_type',         om.ai_block_type,
        'reply_to_message_id',   om.reply_to_message_id,
        'reply_to_content',      om.reply_to_content,
        'reply_to_direction',    om.reply_to_direction,
        'reply_to_message_type', om.reply_to_message_type,
        'reactions',             om.reactions,
        'my_reaction',           om.my_reaction
      )
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id;

  RETURN jsonb_build_object(
    'success',     true,
    'data',        v_messages,
    'total_count', v_count,
    'limit',       p_limit,
    'offset',      p_offset
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;


-- =============================================================================
-- RPC 4: chat_get_messages_before_timestamp
--
-- Alteração: guard após existence check, mesmo padrão dos overloads acima.
--
-- Snapshot de referência: migration 20260409110000_rpc_chat_get_messages_before_timestamp_add_ai_fields.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_messages_before_timestamp(
  p_conversation_id   UUID,
  p_company_id        UUID,
  p_before_timestamp  TIMESTAMP WITH TIME ZONE,
  p_limit             INTEGER DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_messages JSONB;
  v_count    INTEGER;
BEGIN
  IF p_conversation_id IS NULL OR p_company_id IS NULL OR p_before_timestamp IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'conversation_id, company_id e before_timestamp são obrigatórios'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence à empresa'
    );
  END IF;

  -- Guard de visibilidade por responsável.
  IF public.auth_chat_visibility_restricted(p_company_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = p_company_id
        AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado a esta conversa'
      );
    END IF;
  END IF;

  WITH ordered_messages AS (
    SELECT
      m.id,
      m.conversation_id,
      m.company_id,
      m.instance_id,
      COALESCE(m.message_type, 'text')       AS message_type,
      m.content,
      m.media_url,
      m.direction,
      COALESCE(m.status, 'delivered')        AS status,
      COALESCE(m.is_scheduled, false)        AS is_scheduled,
      m.scheduled_for,
      m.sent_by,
      m.uazapi_message_id,
      COALESCE(m.timestamp, m.created_at)   AS timestamp,
      m.created_at,
      m.updated_at,
      COALESCE(m.is_ai_generated, false)    AS is_ai_generated,
      m.ai_run_id,
      m.ai_block_index,
      m.ai_block_type
    FROM chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.company_id      = p_company_id
      AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp
    ORDER BY COALESCE(m.timestamp, m.created_at) DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               om.id,
        'conversation_id',  om.conversation_id,
        'company_id',       om.company_id,
        'instance_id',      om.instance_id,
        'message_type',     om.message_type,
        'content',          om.content,
        'media_url',        om.media_url,
        'direction',        om.direction,
        'status',           om.status,
        'is_scheduled',     om.is_scheduled,
        'scheduled_for',    om.scheduled_for,
        'sent_by',          om.sent_by,
        'uazapi_message_id',om.uazapi_message_id,
        'timestamp',        om.timestamp,
        'created_at',       om.created_at,
        'updated_at',       om.updated_at,
        'is_ai_generated',  om.is_ai_generated,
        'ai_run_id',        om.ai_run_id,
        'ai_block_index',   om.ai_block_index,
        'ai_block_type',    om.ai_block_type
      )
      ORDER BY om.timestamp ASC
    ), '[]'::jsonb)
  INTO v_messages
  FROM ordered_messages om;

  SELECT COUNT(*)
  INTO v_count
  FROM chat_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.company_id      = p_company_id
    AND COALESCE(m.timestamp, m.created_at) < p_before_timestamp;

  RETURN jsonb_build_object(
    'success',          true,
    'data',             v_messages,
    'remaining_count',  v_count,
    'limit',            p_limit,
    'before_timestamp', p_before_timestamp
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Erro interno: ' || SQLERRM
  );
END;
$function$;


-- =============================================================================
-- RPC 5: chat_create_message
--
-- Alteração:
--   [ADICIONA] Guard de acesso após verificação de existência da conversa.
--   [ISENÇÃO] current_setting('role', true) = 'service_role' — backend/agentes/
--             webhooks/cron não são afetados.
--
-- Snapshot de referência: migration 20260506110000_update_chat_create_message_reply.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_create_message(
  p_conversation_id   uuid,
  p_company_id        uuid,
  p_content           text,
  p_message_type      text,
  p_direction         text,
  p_sent_by           uuid     DEFAULT NULL,
  p_media_url         text     DEFAULT NULL,
  p_is_ai_generated   boolean  DEFAULT false,
  p_ai_run_id         uuid     DEFAULT NULL,
  p_ai_block_index    smallint DEFAULT NULL,
  p_ai_block_type     text     DEFAULT NULL,
  p_reply_to_message_id uuid   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message_id        UUID;
  v_instance_id       UUID;
  v_exists            BOOLEAN := FALSE;
  v_validated_reply   UUID    := NULL;
BEGIN
  -- Verificar existência da conversa e obter instance_id efetivo.
  SELECT TRUE, COALESCE(cc.instance_id, cc.last_instance_id)
    INTO v_exists, v_instance_id
  FROM chat_conversations cc
  WHERE cc.id = p_conversation_id
    AND cc.company_id = p_company_id;

  IF NOT v_exists OR v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada ou acesso negado'
    );
  END IF;

  -- Guard de visibilidade por responsável.
  -- Isenta explicitamente service_role (agentes IA, automações, webhook, cron).
  -- Para chamadas frontend: current_setting retorna 'authenticated' → guard ativo.
  IF current_setting('role', true) != 'service_role'
     AND public.auth_chat_visibility_restricted(p_company_id)
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = p_company_id
        AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado a esta conversa'
      );
    END IF;
  END IF;

  -- Validar reply_to_message_id (multi-tenant + mesma conversa + anti-self-reply)
  IF p_reply_to_message_id IS NOT NULL THEN
    SELECT rm.id INTO v_validated_reply
    FROM chat_messages rm
    WHERE rm.id              = p_reply_to_message_id
      AND rm.company_id      = p_company_id
      AND rm.conversation_id = p_conversation_id;
  END IF;

  INSERT INTO chat_messages (
    conversation_id,
    company_id,
    instance_id,
    message_type,
    content,
    media_url,
    direction,
    status,
    sent_by,
    is_ai_generated,
    ai_run_id,
    ai_block_index,
    ai_block_type,
    reply_to_message_id
  )
  VALUES (
    p_conversation_id,
    p_company_id,
    v_instance_id,
    p_message_type,
    p_content,
    p_media_url,
    p_direction,
    CASE
      WHEN p_direction = 'outbound' THEN 'sending'
      ELSE 'read'
    END,
    p_sent_by,
    p_is_ai_generated,
    p_ai_run_id,
    p_ai_block_index,
    p_ai_block_type,
    v_validated_reply
  )
  RETURNING id INTO v_message_id;

  IF v_validated_reply IS NOT NULL AND v_validated_reply = v_message_id THEN
    UPDATE chat_messages SET reply_to_message_id = NULL WHERE id = v_message_id;
    v_validated_reply := NULL;
  END IF;

  UPDATE chat_conversations
  SET
    last_message_at        = now(),
    last_message_content   = p_content,
    last_message_direction = p_direction,
    unread_count           = CASE
      WHEN p_direction = 'inbound' THEN unread_count + 1
      ELSE unread_count
    END,
    updated_at             = now()
  WHERE id = p_conversation_id;

  UPDATE chat_contacts
  SET
    last_activity_at = now(),
    total_messages   = total_messages + 1
  WHERE company_id = p_company_id
    AND phone_number = (
      SELECT contact_phone FROM chat_conversations
      WHERE id = p_conversation_id
    );

  RETURN jsonb_build_object(
    'success',             true,
    'message_id',          v_message_id,
    'reply_to_message_id', v_validated_reply,
    'message',             'Mensagem criada com sucesso'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;


-- =============================================================================
-- RPC 6: chat_mark_conversation_as_read
--
-- Nota: esta RPC não possuía migration no repositório.
--       Esta é a migration canônica que registra a versão atual + enforcement.
--
-- Alteração:
--   [ADICIONA] Guard de acesso após verificação de existência da conversa.
--   Sem isenção de service_role — esta RPC é chamada apenas pelo frontend.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_mark_conversation_as_read(
  p_conversation_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations
    WHERE id = p_conversation_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Conversa não encontrada ou acesso negado');
  END IF;

  -- Guard de visibilidade por responsável.
  IF public.auth_chat_visibility_restricted(p_company_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = p_company_id
        AND (assigned_to = auth.uid() OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Acesso negado a esta conversa');
    END IF;
  END IF;

  UPDATE chat_conversations
  SET unread_count = 0, last_read_at = NOW(), updated_at = NOW()
  WHERE id = p_conversation_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'message', 'Conversa marcada como lida');
END;
$function$;


-- =============================================================================
-- RPC 7: chat_assign_conversation
--
-- Alteração:
--   [ADICIONA] Guard após validação de membership de p_assigned_by.
--   Impede seller restrito de atribuir ou se auto-atribuir a conversa invisível.
--   Permite:
--     - Conversa com assigned_to = p_assigned_by (já atribuída ao próprio caller)
--     - Conversa com assigned_to IS NULL (sem atribuição → visível para todos)
--
-- Snapshot de referência: migration 20260514190000_fix_chat_rpcs_parent_admin_access.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_assign_conversation(
  p_conversation_id uuid,
  p_assigned_to     uuid,
  p_assigned_by     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_has_access boolean;
BEGIN
  SELECT company_id INTO v_company_id
  FROM chat_conversations
  WHERE id = p_conversation_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada'
    );
  END IF;

  -- Trilha 1: membership direto
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE company_id = v_company_id
      AND user_id    = p_assigned_by
      AND is_active  = true
  ) INTO v_has_access;

  -- Trilha 2: super_admin / system_admin da empresa pai
  IF NOT v_has_access THEN
    SELECT public.auth_user_is_parent_admin(v_company_id) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Acesso negado'
    );
  END IF;

  -- Guard de visibilidade: seller restrito só pode operar em conversas visíveis.
  -- Usa p_assigned_by (já validado acima como membro ativo) como referência do caller.
  IF public.auth_chat_visibility_restricted(v_company_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE id         = p_conversation_id
        AND company_id = v_company_id
        AND (assigned_to = p_assigned_by OR assigned_to IS NULL)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado a esta conversa'
      );
    END IF;
  END IF;

  UPDATE chat_conversations
  SET assigned_to = p_assigned_to,
      updated_at  = now()
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Conversa atribuída com sucesso'
  );
END;
$function$;

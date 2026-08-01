-- =====================================================================
-- Migration F — RPC claim_automation_conversation_lock_v1
--
-- Adquire (ou renova) lease atômica por conversa.
-- Operação única: INSERT ON CONFLICT DO UPDATE.
-- Nenhuma lógica de SELECT + INSERT separada — atômica por design.
--
-- Comportamento:
--   1. Sem lease existente → INSERT. Retorna acquired=true.
--   2. Lease expirada (expires_at < now) → "roubo" atômico. acquired=true.
--   3. Lease válida, mesmo schedule_id → renovação. acquired=true.
--   4. Lease válida, schedule_id diferente → recusa. acquired=false.
--
-- Parâmetros:
--   p_company_id      — obrigatório, validação multi-tenant
--   p_channel         — obrigatório ('instagram', etc.)
--   p_conversation_id — UUID da instagram_conversations
--   p_schedule_id     — UUID do schedule atual (vínculo informativo)
--   p_duration_seconds— duração da lease em segundos (default 180 = 3min)
--
-- Retorno JSONB:
--   { acquired: bool, lock_id: uuid|null, expires_at: timestamptz|null,
--     reason: text }
--
-- SECURITY DEFINER: executa como owner. Ignora RLS.
-- Grant apenas para service_role — nunca chamado por usuário autenticado.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.claim_automation_conversation_lock_v1(
  p_company_id       UUID,
  p_channel          TEXT,
  p_conversation_id  UUID,
  p_schedule_id      UUID    DEFAULT NULL,
  p_duration_seconds INTEGER DEFAULT 180
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ := v_now + (p_duration_seconds * INTERVAL '1 second');
  v_lock_id    UUID;
  v_lock_expires TIMESTAMPTZ;
  v_existing   public.automation_conversation_locks%ROWTYPE;
BEGIN
  -- Validações obrigatórias
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'company_id_required');
  END IF;
  IF p_channel IS NULL OR p_channel = '' THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'channel_required');
  END IF;
  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'conversation_id_required');
  END IF;

  -- Tentativa atômica: INSERT ou UPDATE condicional
  -- INSERT quando não existe; UPDATE quando lease expirada ou mesmo schedule
  INSERT INTO public.automation_conversation_locks
    (company_id, channel, conversation_id, schedule_id, locked_at, expires_at, updated_at)
  VALUES
    (p_company_id, p_channel, p_conversation_id, p_schedule_id, v_now, v_expires_at, v_now)
  ON CONFLICT (company_id, channel, conversation_id)
  DO UPDATE SET
    schedule_id = EXCLUDED.schedule_id,
    locked_at   = v_now,
    expires_at  = v_expires_at,
    updated_at  = v_now
  WHERE
    -- Condição de "roubo": lease expirada
    automation_conversation_locks.expires_at < v_now
    OR
    -- Condição de renovação: mesmo schedule
    automation_conversation_locks.schedule_id = p_schedule_id
  RETURNING id, expires_at
  INTO v_lock_id, v_lock_expires;

  -- Se RETURNING não trouxe id, significa que UPDATE não executou
  -- (lease válida pertence a outro schedule)
  IF v_lock_id IS NULL THEN
    -- Buscar motivo real (diagnóstico, sem expor dados sensíveis)
    SELECT expires_at INTO v_lock_expires
      FROM public.automation_conversation_locks
     WHERE company_id      = p_company_id
       AND channel          = p_channel
       AND conversation_id  = p_conversation_id
     LIMIT 1;

    RETURN jsonb_build_object(
      'acquired',   false,
      'lock_id',    NULL,
      'expires_at', v_lock_expires,
      'reason',     'lease_held_by_other'
    );
  END IF;

  RETURN jsonb_build_object(
    'acquired',   true,
    'lock_id',    v_lock_id,
    'expires_at', v_lock_expires,
    'reason',     'ok'
  );
END;
$$;

-- Somente service_role — nunca chamado por usuário autenticado ou anônimo.
-- REVOKE FROM anon explícito: Supabase pode adicionar grant automático a anon
-- após a criação da função; o REVOKE FROM PUBLIC não cobre grants explícitos
-- pré-existentes aplicados pelo ambiente.
REVOKE ALL ON FUNCTION public.claim_automation_conversation_lock_v1(UUID, TEXT, UUID, UUID, INTEGER)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_automation_conversation_lock_v1(UUID, TEXT, UUID, UUID, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.claim_automation_conversation_lock_v1 IS
  'Adquire lease exclusiva por conversa para o motor de automação Instagram.
   Atômica: INSERT ON CONFLICT DO UPDATE com condição de expiração.
   Nunca usa SELECT + INSERT separados. Apenas service_role pode chamar.';

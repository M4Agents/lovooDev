-- =====================================================
-- MIGRATION: Fix respond_on_activation — permitir requeue de skipped_ai_inactive
-- Data: 2026-08-12
-- Funcionalidade: Fix 1 de 2 — RPC agent_message_enqueue_v1
--
-- Problema:
--   Quando um lead envia mensagem enquanto a IA está inativa (ai_inactive),
--   o conversationRouter.js grava APM com result='skipped_ai_inactive'.
--   Depois, uma automação ativa o agente (ai_active) e chama triggerPendingMessage
--   que, por sua vez, chama enqueueMessage. A RPC tentava INSERT e recebia conflito
--   (mesma uazapi_message_id + instance_id já existe no APM), lendo o resultado
--   existente 'skipped_ai_inactive' e lançando INCOMPATIBLE_STATE. Resultado: a
--   mensagem nunca era processada, sem log de erro visível.
--
-- Correção:
--   No PASSO 4 da RPC, permitir a transição:
--     skipped_ai_inactive → buffered
--   quando o ai_state ATUAL da conversa for 'ai_active'.
--   Qualquer outro estado skipped_* ou final NÃO é reprocessado (condição explícita,
--   não usa LIKE 'skipped_%').
--
-- Garantias:
--   1. Transição só ocorre se ai_state = 'ai_active' (validado dentro da RPC).
--   2. UPDATE restrito por (uazapi_message_id, instance_id, company_id, result='skipped_ai_inactive').
--   3. RETURNING id INTO v_apm_id garante que o PASSO 9 atualiza o registro correto.
--   4. GET DIAGNOSTICS após UPDATE: 0 linhas = caller concorrente ganhou → safe duplicate.
--   5. Checks 4b–4g (validações de batch existente) só executam para result='buffered',
--      não para o caminho novo (não há batch ainda para validar).
--   6. Função é LANGUAGE plpgsql sem COMMIT explícito → transação atômica:
--      UPDATE + PASSO 5 + PASSO 7 + PASSO 9 fazem rollback conjunto em qualquer RAISE.
--
-- Estados NÃO reprocessados (INCOMPATIBLE_STATE):
--   skipped_no_rule, skipped_out_of_schedule, skipped_lock_busy, processed, error
--
-- Escopo:
--   Altera apenas DECLARE, PASSO 3 e PASSO 4 da função.
--   PASSOS 5–10, schema de tabelas, índices, FKs, RLS e demais RPCs: inalterados.
--
-- Dependências:
--   20260714160000_fix_agent_enqueue_v1_multitenancy.sql (Migration D — versão anterior da RPC)
--
-- Rollback:
--   Reaplicar a versão anterior da função (CREATE OR REPLACE com corpo da Migration D).
-- =====================================================


-- ════════════════════════════════════════════════════════════════════════════════
-- RPC agent_message_enqueue_v1 — versão corrigida (requeue de skipped_ai_inactive)
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Mudanças em relação à Migration D (160000):
--
--   DECLARE:
--     + v_conv_ai_state TEXT   — captura ai_state da conversa no PASSO 3
--
--   PASSO 3 (validação multi-tenant):
--     SELECT company_id, ai_state INTO v_conv_company, v_conv_ai_state
--     (era: SELECT company_id INTO v_conv_company)
--
--   PASSO 4 (dedup gate) — check 4a:
--     Antes: IF v_existing_result <> 'buffered' THEN RAISE INCOMPATIBLE_STATE END IF;
--     Depois:
--       IF v_existing_result = 'buffered' THEN NULL;    -- continua para 4b–4g
--       ELSIF v_existing_result = 'skipped_ai_inactive' THEN
--         -- validar ai_state, UPDATE para buffered, GET DIAGNOSTICS, safe-duplicate ou continuar
--       ELSE RAISE INCOMPATIBLE_STATE
--       END IF;
--       IF v_existing_result = 'buffered' THEN 4b–4g → RETURN duplicate END IF;
--
--   PASSOS 5–10: inalterados.

CREATE OR REPLACE FUNCTION public.agent_message_enqueue_v1(
  -- ── Parâmetros obrigatórios ──────────────────────────────────────────────────
  p_company_id                  UUID,
  p_conversation_id             UUID,
  p_window_seconds              INT,
  p_provider_message_id         TEXT,
  p_instance_id                 UUID,

  -- ── Parâmetros opcionais ─────────────────────────────────────────────────────
  p_assignment_id               UUID        DEFAULT NULL,
  p_channel                     TEXT        DEFAULT 'whatsapp',
  p_max_batch_duration_seconds  INT         DEFAULT 120,
  p_message_text                TEXT        DEFAULT NULL,
  p_message_type                TEXT        DEFAULT 'text',
  p_provider_timestamp          TIMESTAMPTZ DEFAULT NULL,
  p_received_at                 TIMESTAMPTZ DEFAULT NULL,
  p_payload                     JSONB       DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Constantes de validação de entrada ───────────────────────────────────────
  c_max_window_seconds         CONSTANT INT := 120;
  c_max_batch_duration         CONSTANT INT := 600;
  c_max_msg_id_len             CONSTANT INT := 512;
  c_max_msg_type_len           CONSTANT INT := 50;
  c_max_msg_text_len           CONSTANT INT := 10000;
  c_max_payload_bytes          CONSTANT INT := 65536;

  -- ── Constantes de limite por lote (V1 — fixas na função, não controláveis pelo chamador) ──
  c_max_messages_per_batch     CONSTANT INT := 50;
  c_max_total_text_length      CONSTANT INT := 100000;

  -- ── Tolerâncias para normalização de timestamps ──────────────────────────────
  c_received_at_future_tol_s   CONSTANT INT := 300;
  c_provider_ts_future_tol_s   CONSTANT INT := 1800;

  -- ── Variáveis de trabalho ────────────────────────────────────────────────────
  v_now                        TIMESTAMPTZ;
  v_max_dur_interval           INTERVAL;
  v_conv_company               UUID;
  v_conv_ai_state              TEXT;       -- [FIX] ai_state da conversa para validação de requeue
  v_inst_company               UUID;
  v_batch_id                   UUID;
  v_batch_status               TEXT;
  v_batch_msg_count            INT;
  v_batch_text_len             INT;
  v_batch_max_deadline         TIMESTAMPTZ;
  v_batch_message_id           UUID;
  v_final_deadline             TIMESTAMPTZ;
  v_text_len                   INT;
  v_apm_id                     UUID;
  v_apm_rows                   INT;
  v_msg_rows                   INT;

  -- ── Variáveis de validação de duplicata ──────────────────────────────────────
  v_existing_result            TEXT;
  v_existing_batch_id          UUID;
  v_existing_msg_id            UUID;
  v_existing_conv              UUID;
  v_batch_company              UUID;
  v_batch_conv                 UUID;
  v_bmm_batch                  UUID;
  v_bmm_company                UUID;
  v_bmm_conv                   UUID;
  v_bmm_inst                   UUID;
  v_bmm_pmid                   TEXT;

  -- ── Timestamps normalizados ───────────────────────────────────────────────────
  v_received_at                TIMESTAMPTZ;
  v_provider_timestamp_norm    TIMESTAMPTZ;

  -- ── Valores do RETURNING do UPDATE final do lote ─────────────────────────────
  v_final_status               TEXT;
  v_final_deadline_ret         TIMESTAMPTZ;
  v_batch_max_deadline_ret     TIMESTAMPTZ;
  v_final_msg_count            INT;
  v_final_text_len             INT;

BEGIN

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 1: VALIDAÇÃO DE PARÂMETROS
  -- ══════════════════════════════════════════════════════════════════════════════

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_conversation_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_instance_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_provider_message_id IS NULL OR trim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_provider_message_id e obrigatorio e nao pode ser vazio'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(p_provider_message_id) > c_max_msg_id_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_provider_message_id excede % caracteres', c_max_msg_id_len
      USING ERRCODE = 'P0001';
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('whatsapp') THEN
    RAISE EXCEPTION 'INVALID_PARAM: canal nao suportado nesta versao: %',
      COALESCE(p_channel, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > c_max_window_seconds THEN
    RAISE EXCEPTION 'INVALID_PARAM: window_seconds deve ser inteiro entre 1 e %', c_max_window_seconds
      USING ERRCODE = 'P0001';
  END IF;

  IF p_max_batch_duration_seconds IS NOT NULL
    AND (p_max_batch_duration_seconds <= 0 OR p_max_batch_duration_seconds > c_max_batch_duration)
  THEN
    RAISE EXCEPTION 'INVALID_PARAM: max_batch_duration_seconds deve estar entre 1 e %', c_max_batch_duration
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PARAM: payload deve ser objeto JSON (recebido: %)',
      COALESCE(jsonb_typeof(p_payload), 'null')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payload IS NOT NULL AND octet_length(p_payload::text) > c_max_payload_bytes THEN
    RAISE EXCEPTION 'INVALID_PARAM: payload excede limite de % bytes', c_max_payload_bytes
      USING ERRCODE = 'P0001';
  END IF;

  IF p_message_type IS NOT NULL AND length(p_message_type) > c_max_msg_type_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: message_type excede % caracteres', c_max_msg_type_len
      USING ERRCODE = 'P0001';
  END IF;

  IF p_message_text IS NOT NULL AND length(p_message_text) > c_max_msg_text_len THEN
    RAISE EXCEPTION 'INVALID_PARAM: message_text excede % caracteres', c_max_msg_text_len
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 2: INICIALIZAÇÃO E NORMALIZAÇÃO DE TIMESTAMPS
  -- ══════════════════════════════════════════════════════════════════════════════

  v_now            := now();
  v_text_len       := COALESCE(length(p_message_text), 0);
  v_max_dur_interval := (COALESCE(p_max_batch_duration_seconds, 120) || ' seconds')::interval;

  v_received_at := CASE
    WHEN p_received_at IS NULL THEN v_now
    WHEN p_received_at > v_now + (c_received_at_future_tol_s || ' seconds')::interval THEN v_now
    ELSE p_received_at
  END;

  v_provider_timestamp_norm := CASE
    WHEN p_provider_timestamp IS NOT NULL
      AND p_provider_timestamp > v_now + (c_provider_ts_future_tol_s || ' seconds')::interval
    THEN NULL
    ELSE p_provider_timestamp
  END;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 3: VALIDAÇÃO MULTI-TENANT
  -- ══════════════════════════════════════════════════════════════════════════════
  -- [FIX] Adicionado ai_state ao SELECT para uso na validação de requeue no PASSO 4.

  SELECT company_id, ai_state
    INTO v_conv_company, v_conv_ai_state
  FROM public.chat_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND OR v_conv_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: conversa nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id INTO v_inst_company
  FROM public.whatsapp_life_instances
  WHERE id = p_instance_id;

  IF NOT FOUND OR v_inst_company IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'TENANT_VIOLATION: instancia nao encontrada ou nao pertence a empresa informada'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_assignment_id IS NOT NULL THEN
    PERFORM 1 FROM public.company_agent_assignments
    WHERE id = p_assignment_id
      AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TENANT_VIOLATION: assignment nao encontrado ou nao pertence a empresa informada'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 4: DEDUP GATE EM AGENT_PROCESSED_MESSAGES
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Mecanismo base (inalterado):
  --   INSERT ON CONFLICT DO NOTHING via índice parcial apm_dedup_enqueue:
  --     UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL
  --   v_apm_rows = 1 → INSERT bem-sucedido → mensagem nova → continuar para PASSO 5
  --   v_apm_rows = 0 → DO NOTHING → duplicata → SELECT + validação do estado existente
  --
  -- [FIX] Novo caminho para result='skipped_ai_inactive':
  --   Se o registro existente tem result='skipped_ai_inactive' E o ai_state atual
  --   da conversa é 'ai_active', o registro é atualizado para 'buffered' e o
  --   processamento continua normalmente para o PASSO 5.
  --   Condição explícita — não usa LIKE 'skipped_%'. Outros estados skipped_*
  --   (skipped_no_rule, skipped_out_of_schedule) não são reprocessados.
  --
  -- Análise de concorrência do caminho novo:
  --   UPDATE ... WHERE result = 'skipped_ai_inactive' adquire row lock.
  --   Caller concorrente aguarda o lock. Após commit do primeiro caller,
  --   o segundo vê result='buffered' (0 linhas afetadas) → retorna safe duplicate.
  --   O lock garante que batch_id está preenchido (PASSO 9 faz parte da mesma txn).

  INSERT INTO public.agent_processed_messages (
    uazapi_message_id,
    instance_id,
    conversation_id,
    company_id,
    assignment_id,
    result
  ) VALUES (
    p_provider_message_id,
    p_instance_id,
    p_conversation_id,
    p_company_id,
    p_assignment_id,
    'buffered'
  )
  ON CONFLICT (company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_apm_id;

  GET DIAGNOSTICS v_apm_rows = ROW_COUNT;

  IF v_apm_rows = 0 THEN
    -- ── Duplicata detectada: ler e validar o registro existente ────────────────
    SELECT
      apm.id,
      apm.result,
      apm.batch_id,
      apm.batch_message_id,
      apm.conversation_id
    INTO
      v_apm_id,
      v_existing_result,
      v_existing_batch_id,
      v_existing_msg_id,
      v_existing_conv
    FROM public.agent_processed_messages apm
    WHERE apm.company_id        = p_company_id
      AND apm.instance_id       = p_instance_id
      AND apm.uazapi_message_id = p_provider_message_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEDUP_CONFLICT_UNRESOLVABLE: conflito detectado mas linha nao encontrada. company_id=%, instance_id=%, provider_message_id=%',
        p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4a. [FIX] Verificar result e direcionar para o caminho correto ────────
    IF v_existing_result = 'buffered' THEN
      -- Duplicata saudável com batch existente → continuar para 4b–4g abaixo.
      NULL;

    ELSIF v_existing_result = 'skipped_ai_inactive' THEN
      -- [FIX] Mensagem foi ignorada quando a IA estava inativa.
      -- Verificar que o agente está ativo AGORA antes de re-enfileirar.
      -- Nunca usar LIKE 'skipped_%' — condição explícita e restrita.
      IF v_conv_ai_state IS DISTINCT FROM 'ai_active' THEN
        RAISE EXCEPTION 'REQUEUE_DENIED: re-enqueue de skipped_ai_inactive bloqueado: ai_state atual nao e ai_active (atual: %). company_id=%, instance_id=%, provider_message_id=%',
          COALESCE(v_conv_ai_state, 'NULL'), p_company_id, p_instance_id, p_provider_message_id
          USING ERRCODE = 'P0001';
      END IF;

      -- UPDATE restrito por state + compound key (tenant-safe).
      -- RETURNING id INTO v_apm_id garante que PASSO 9 atualiza a linha correta.
      UPDATE public.agent_processed_messages
         SET result        = 'buffered',
             assignment_id = p_assignment_id
       WHERE uazapi_message_id = p_provider_message_id
         AND instance_id       = p_instance_id
         AND company_id        = p_company_id
         AND result            = 'skipped_ai_inactive'
      RETURNING id INTO v_apm_id;

      GET DIAGNOSTICS v_apm_rows = ROW_COUNT;

      IF v_apm_rows = 0 THEN
        -- Caller concorrente atualizou para 'buffered' antes desta txn adquirir o lock.
        -- O row lock do UPDATE garante que a txn concorrente commitou integralmente
        -- (incluindo batch_id preenchido no PASSO 9 da outra txn).
        SELECT apm.batch_id, apm.batch_message_id
          INTO v_existing_batch_id, v_existing_msg_id
          FROM public.agent_processed_messages apm
         WHERE apm.company_id        = p_company_id
           AND apm.instance_id       = p_instance_id
           AND apm.uazapi_message_id = p_provider_message_id;

        RETURN jsonb_build_object(
          'ok',               true,
          'inserted',         false,
          'duplicate',        true,
          'batch_id',         v_existing_batch_id,
          'batch_message_id', v_existing_msg_id,
          'reason',           'already_buffered'
        );
      END IF;

      -- v_apm_rows = 1: UPDATE bem-sucedido, v_apm_id setado pelo RETURNING.
      -- Sair do bloco sem RETURN → pular 4b–4g (sem batch existente a validar)
      -- → continuar para PASSO 5.

    ELSE
      -- Estados não reprocessáveis: skipped_no_rule, skipped_out_of_schedule,
      -- skipped_lock_busy, processed, error — qualquer outro valor presente ou futuro.
      RAISE EXCEPTION 'INCOMPATIBLE_STATE: mensagem ja registrada com result=% impossibilita agrupamento. company_id=%, instance_id=%, provider_message_id=%',
        v_existing_result, p_company_id, p_instance_id, p_provider_message_id
        USING ERRCODE = 'P0001';
    END IF;

    -- ── 4b–4g: verificações de batch existente (apenas para result='buffered') ──
    -- Para o caminho skipped_ai_inactive → buffered não existe batch ainda,
    -- portanto estas verificações são puladas (o caminho ELSIF não retorna
    -- nem levanta exceção, portanto chega aqui com v_existing_result='skipped_ai_inactive'
    -- → condição abaixo é falsa → sai do bloco IF v_apm_rows = 0 para PASSO 5).
    IF v_existing_result = 'buffered' THEN

      -- ── 4b. Verificar conversation_id ──────────────────────────────────────
      IF v_existing_conv IS DISTINCT FROM p_conversation_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro duplicado pertence a conversa diferente. esperado=%, encontrado=%',
          p_conversation_id, COALESCE(v_existing_conv::text, 'null')
          USING ERRCODE = 'P0001';
      END IF;

      -- ── 4c. Verificar que batch_id está preenchido ──────────────────────────
      IF v_existing_batch_id IS NULL THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro buffered sem batch_id. '
          'Estado incompativel — transacao anterior pode ter sido interrompida. '
          'company_id=%, instance_id=%, provider_message_id=%',
          p_company_id, p_instance_id, p_provider_message_id
          USING ERRCODE = 'P0001';
      END IF;

      -- ── 4d. Verificar que batch_message_id está preenchido ─────────────────
      IF v_existing_msg_id IS NULL THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: registro buffered sem batch_message_id. '
          'Estado incompativel — transacao anterior pode ter sido interrompida. '
          'company_id=%, instance_id=%, provider_message_id=%',
          p_company_id, p_instance_id, p_provider_message_id
          USING ERRCODE = 'P0001';
      END IF;

      -- ── 4e. Validar que o batch pertence à empresa e conversa corretas ──────
      SELECT b.company_id, b.conversation_id
      INTO   v_batch_company, v_batch_conv
      FROM   public.agent_message_batches b
      WHERE  b.id = v_existing_batch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_id nao encontrado em agent_message_batches. batch_id=%',
          v_existing_batch_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_batch_company IS DISTINCT FROM p_company_id THEN
        RAISE EXCEPTION 'TENANT_VIOLATION: batch pertence a empresa diferente do registro APM. batch_id=%',
          v_existing_batch_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_batch_conv IS DISTINCT FROM p_conversation_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch pertence a conversa diferente do registro APM. batch_id=%',
          v_existing_batch_id
          USING ERRCODE = 'P0001';
      END IF;

      -- ── 4f. Validar batch_message ───────────────────────────────────────────
      SELECT bmm.batch_id, bmm.company_id, bmm.conversation_id,
             bmm.instance_id, bmm.provider_message_id
      INTO   v_bmm_batch, v_bmm_company, v_bmm_conv, v_bmm_inst, v_bmm_pmid
      FROM   public.agent_message_batch_messages bmm
      WHERE  bmm.id = v_existing_msg_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message_id nao encontrado em agent_message_batch_messages. batch_message_id=%',
          v_existing_msg_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_bmm_batch IS DISTINCT FROM v_existing_batch_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a batch diferente do registrado no APM. esperado=%, encontrado=%',
          v_existing_batch_id, v_bmm_batch
          USING ERRCODE = 'P0001';
      END IF;

      IF v_bmm_company IS DISTINCT FROM p_company_id THEN
        RAISE EXCEPTION 'TENANT_VIOLATION: batch_message pertence a empresa diferente. batch_message_id=%',
          v_existing_msg_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_bmm_conv IS DISTINCT FROM p_conversation_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a conversa diferente. batch_message_id=%',
          v_existing_msg_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_bmm_inst IS DISTINCT FROM p_instance_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message pertence a instancia diferente. batch_message_id=%',
          v_existing_msg_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_bmm_pmid IS DISTINCT FROM p_provider_message_id THEN
        RAISE EXCEPTION 'DEDUP_INCONSISTENCY: batch_message tem provider_message_id diferente do esperado. esperado=%, encontrado=%',
          p_provider_message_id, v_bmm_pmid
          USING ERRCODE = 'P0001';
      END IF;

      -- ── 4g. Todos os vínculos validados — duplicata saudável ────────────────
      RETURN jsonb_build_object(
        'ok',               true,
        'inserted',         false,
        'duplicate',        true,
        'batch_id',         v_existing_batch_id,
        'batch_message_id', v_existing_msg_id,
        'reason',           'already_buffered'
      );

    END IF; -- fim IF v_existing_result = 'buffered'

  END IF; -- fim IF v_apm_rows = 0

  -- v_apm_rows = 1: INSERT bem-sucedido (mensagem nova) OU UPDATE de skipped_ai_inactive
  -- para buffered bem-sucedido. Em ambos os casos, v_apm_id está setado. Continuar.


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 5: LOCALIZAR OU CRIAR LOTE ABERTO
  -- ══════════════════════════════════════════════════════════════════════════════

  INSERT INTO public.agent_message_batches (
    company_id,
    conversation_id,
    enqueue_assignment_id,
    channel,
    status,
    deadline_at,
    max_deadline_at,
    first_message_at,
    last_message_at,
    message_count,
    total_text_length
  ) VALUES (
    p_company_id,
    p_conversation_id,
    p_assignment_id,
    p_channel,
    'pending',
    v_now + (p_window_seconds || ' seconds')::interval,
    v_now + v_max_dur_interval,
    v_now,
    v_now,
    0,
    0
  )
  ON CONFLICT (company_id, conversation_id, channel)
    WHERE status IN ('pending', 'retry_pending')
  DO UPDATE SET
    updated_at = now()
  RETURNING
    id,
    status,
    message_count,
    total_text_length,
    max_deadline_at
  INTO
    v_batch_id,
    v_batch_status,
    v_batch_msg_count,
    v_batch_text_len,
    v_batch_max_deadline;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 6: VERIFICAR LIMITES ACUMULADOS (ATÔMICO)
  -- ══════════════════════════════════════════════════════════════════════════════

  IF v_batch_msg_count + 1 > c_max_messages_per_batch THEN
    RAISE EXCEPTION 'BATCH_LIMIT_REACHED: limite de mensagens por lote atingido (max=%, atual=%). '
      'Processar o lote antes de enfileirar novas mensagens. batch_id=%',
      c_max_messages_per_batch, v_batch_msg_count, v_batch_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_batch_text_len + v_text_len > c_max_total_text_length THEN
    RAISE EXCEPTION 'BATCH_LIMIT_REACHED: limite de texto total do lote atingido (max=%, atual=%, novo=%chars). '
      'Processar o lote antes de enfileirar novas mensagens. batch_id=%',
      c_max_total_text_length, v_batch_text_len, v_text_len, v_batch_id
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 7: INSERIR MENSAGEM NO LOTE
  -- ══════════════════════════════════════════════════════════════════════════════

  INSERT INTO public.agent_message_batch_messages (
    batch_id,
    company_id,
    conversation_id,
    provider_message_id,
    instance_id,
    provider_timestamp,
    received_at,
    message_text,
    message_type,
    payload
  ) VALUES (
    v_batch_id,
    p_company_id,
    p_conversation_id,
    p_provider_message_id,
    p_instance_id,
    v_provider_timestamp_norm,
    v_received_at,
    p_message_text,
    COALESCE(p_message_type, 'text'),
    COALESCE(p_payload, '{}')
  )
  ON CONFLICT (company_id, instance_id, provider_message_id) DO NOTHING
  RETURNING id INTO v_batch_message_id;

  GET DIAGNOSTICS v_msg_rows = ROW_COUNT;

  IF v_msg_rows = 0 THEN
    RAISE EXCEPTION
      'DEDUP_INCONSISTENCY: mensagem passou pelo gate APM mas ja existe em batch_messages. '
      'provider_message_id=%. Verifique integridade dos indices apm_dedup_enqueue e agent_message_batch_messages_dedup.',
      p_provider_message_id
      USING ERRCODE = 'P0001';
  END IF;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 8: ATUALIZAR LOTE — DEADLINE, CONTADORES E STATUS
  -- ══════════════════════════════════════════════════════════════════════════════

  v_final_deadline := LEAST(
    v_now + (p_window_seconds || ' seconds')::interval,
    v_batch_max_deadline
  );

  UPDATE public.agent_message_batches SET
    deadline_at       = v_final_deadline,
    last_message_at   = v_now,
    message_count     = message_count + 1,
    total_text_length = total_text_length + v_text_len,
    status            = CASE WHEN v_batch_status = 'retry_pending' THEN 'pending'
                             ELSE status END,
    next_attempt_at   = CASE WHEN v_batch_status = 'retry_pending' THEN NULL
                             ELSE next_attempt_at END,
    updated_at        = v_now
  WHERE id = v_batch_id
  RETURNING
    status,
    deadline_at,
    max_deadline_at,
    message_count,
    total_text_length
  INTO
    v_final_status,
    v_final_deadline_ret,
    v_batch_max_deadline_ret,
    v_final_msg_count,
    v_final_text_len;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 9: ASSOCIAR LOTE AO REGISTRO DE AGENT_PROCESSED_MESSAGES
  -- ══════════════════════════════════════════════════════════════════════════════
  --
  -- Usa WHERE id = v_apm_id (PK UUID interna).
  -- Para o caminho novo (skipped_ai_inactive), v_apm_id foi setado pelo
  -- RETURNING do UPDATE no PASSO 4 — identifica exatamente a linha atualizada.
  -- Para o caminho original (INSERT), v_apm_id foi setado pelo RETURNING do INSERT.

  UPDATE public.agent_processed_messages SET
    batch_id         = v_batch_id,
    batch_message_id = v_batch_message_id
  WHERE id = v_apm_id;


  -- ══════════════════════════════════════════════════════════════════════════════
  -- PASSO 10: RETORNAR RESULTADO ESTRUTURADO
  -- ══════════════════════════════════════════════════════════════════════════════

  RETURN jsonb_build_object(
    'ok',                true,
    'inserted',          true,
    'duplicate',         false,
    'batch_id',          v_batch_id,
    'batch_message_id',  v_batch_message_id,
    'batch_status',      v_final_status,
    'deadline_at',       v_final_deadline_ret,
    'max_deadline_at',   v_batch_max_deadline_ret,
    'message_count',     v_final_msg_count,
    'total_text_length', v_final_text_len,
    'reason',            'buffered'
  );

END;
$$;


-- ════════════════════════════════════════════════════════════════════════════════
-- SEGURANÇA — REVOKE E GRANT (inalterados em relação à Migration D)
-- ════════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM anon;

REVOKE ALL ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════════
-- COMENTÁRIO ATUALIZADO
-- ════════════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.agent_message_enqueue_v1(
  UUID, UUID, INT, TEXT, UUID, UUID, TEXT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) IS
  'RPC transacional de enqueue de mensagens para agrupamento (v1 — fix skipped_ai_inactive). '
  'Dedup via UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL. '
  'Transição skipped_ai_inactive → buffered permitida quando ai_state = ai_active. '
  'Estados não reprocessáveis: skipped_no_rule, skipped_out_of_schedule, processed, error. '
  'Validação completa de duplicata: company_id, conversation_id, batch_id, batch_message_id '
  'e pertencimento cruzado em agent_message_batches e agent_message_batch_messages. '
  'Limites atômicos: 50 mensagens/lote, 100.000 chars de texto/lote. '
  'BATCH_LIMIT_REACHED → rollback completo (sem órfão em APM). '
  'retry_pending → pending ao receber nova mensagem (preserva attempts/last_error). '
  'Timestamps normalizados: received_at futuro > 5min → now(); '
  'provider_timestamp futuro > 30min → NULL. '
  'Contadores e deadline retornados via RETURNING (valores exatos persistidos). '
  'Acesso exclusivo via service_role.';

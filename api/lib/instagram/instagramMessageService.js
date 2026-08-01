// =====================================================
// instagramMessageService.js
//
// Serviço compartilhado de envio de mensagens Instagram.
// Usado por:
//   - api/instagram/conversations/[conversationId]/send.js (chat manual)
//   - api/lib/automation/instagramSender.js (automação)
//
// Responsabilidades:
//   - Buscar conversa com validação de company_id
//   - Validar conexão ativa
//   - Descriptografar access_token
//   - Chamar Meta Graph API (com Handover Protocol)
//   - Persistir mensagem outbound
//   - Atualizar last_message_at da conversa
//   - Registrar audit log
//
// Não depende de req/res/JWT — é um serviço puro de backend.
// Toda validação de auth/RBAC é responsabilidade do caller.
//
// SEGURANÇA:
//   - company_id validado em cada query (multi-tenant obrigatório)
//   - Nunca logar access_token
//   - connection_id validado contra a conversa
//   - sent_by = null para automação (nunca string constante)
// =====================================================

import { decryptInstagramToken } from './tokenCrypto.js';

const GRAPH_API_VERSION   = 'v21.0';
const TEXT_MAX_BYTES      = 1000;
const META_FETCH_TIMEOUT_MS = 15_000;

/**
 * Envia uma mensagem de texto via Instagram Graph API e persiste localmente.
 *
 * @param {object} params
 * @param {object}  params.supabase          - Cliente Supabase (service_role)
 * @param {string}  params.conversationId    - UUID da instagram_conversations
 * @param {string}  params.companyId         - UUID da empresa (validado em todas as queries)
 * @param {string}  params.text              - Texto a enviar (obrigatório)
 * @param {string|null} [params.sentBy]      - UUID de auth.users (manual) ou null (automação)
 * @param {string}  [params.origin]          - 'manual' | 'automation' (default: 'manual')
 * @param {string|null} [params.automationExecutionId] - UUID da execution (automação)
 * @param {string|null} [params.automationNodeId]      - ID do nó no flow (automação)
 * @param {string|null} [params.replyToIgMessageId]    - ig_message_id para citação
 *
 * @returns {Promise<SendResult>}
 *   { ok: bool, igMessageId, savedMessage, error, errorCode, errorType }
 *   errorType: 'validation' | 'connection_inactive' | 'token_error' | 'meta_error' |
 *              'meta_timeout' | 'meta_window_expired' | 'token_expired' | 'rate_limit' |
 *              'user_blocked' | 'db_error'
 */
export async function sendInstagramMessage({
  supabase,
  conversationId,
  companyId,
  text,
  sentBy            = null,
  origin            = 'manual',
  automationExecutionId = null,
  automationNodeId  = null,
  replyToIgMessageId = null,
}) {
  // ── 1. Validação de entrada ────────────────────────────────────────────────
  if (!supabase || !conversationId || !companyId || !text) {
    return failure('validation', 'Parâmetros obrigatórios ausentes')
  }

  const trimmedText = typeof text === 'string' ? text.trim() : ''
  if (!trimmedText) {
    return failure('validation', 'text não pode ser vazio')
  }
  if (Buffer.byteLength(trimmedText, 'utf8') > TEXT_MAX_BYTES) {
    return failure('validation', `Mensagem excede ${TEXT_MAX_BYTES} bytes`)
  }

  // ── 2. Buscar conversa (company_id obrigatório — multi-tenant) ─────────────
  const { data: conversation, error: convErr } = await supabase
    .from('instagram_conversations')
    .select('id, company_id, connection_id, ig_participant_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)  // guard multi-tenant
    .maybeSingle()

  if (convErr || !conversation) {
    return failure('validation', 'Conversa não encontrada ou não pertence à empresa')
  }

  // ── 3. Buscar conexão com validação de company_id ──────────────────────────
  const { data: connection, error: connErr } = await supabase
    .from('instagram_connections')
    .select('id, company_id, instagram_user_id, ig_webhook_id, access_token_enc, status')
    .eq('id', conversation.connection_id)
    .eq('company_id', companyId)  // guard multi-tenant
    .maybeSingle()

  if (connErr || !connection) {
    return failure('validation', 'Conexão Instagram não encontrada')
  }

  if (connection.status !== 'active') {
    return failure('connection_inactive', 'connection_inactive')
  }
  if (!connection.access_token_enc) {
    return failure('connection_inactive', 'connection_inactive: sem token')
  }

  // ── 4. Descriptografar token ───────────────────────────────────────────────
  let accessToken
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc)
  } catch (decErr) {
    console.error('[ig-service] decrypt_failed:', { conversationId, err: decErr?.message })
    return failure('token_error', 'Erro ao processar credenciais da conexão')
  }

  // ── 5. Resolver snapshot da mensagem citada (se houver) ────────────────────
  let replyToContent   = null
  let replyToDirection = null
  if (replyToIgMessageId && typeof replyToIgMessageId === 'string') {
    const { data: quoted } = await supabase
      .from('instagram_messages')
      .select('content, direction')
      .eq('ig_message_id', replyToIgMessageId)
      .eq('company_id', companyId)
      .maybeSingle()
    replyToContent   = quoted?.content   ?? null
    replyToDirection = quoted?.direction ?? null
  }

  // Montar texto para Meta com prefixo de citação, se couber
  let textForMeta = trimmedText
  if (replyToContent) {
    const snippet  = replyToContent.length > 80 ? replyToContent.slice(0, 80) + '…' : replyToContent
    const prefixed = `↩ ${snippet}\n\n${trimmedText}`
    if (Buffer.byteLength(prefixed, 'utf8') <= TEXT_MAX_BYTES) {
      textForMeta = prefixed
    }
  }

  // ── 6. Enviar via Meta Graph API ───────────────────────────────────────────
  const igBusinessId = connection.ig_webhook_id ?? connection.instagram_user_id
  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igBusinessId}/messages`

  let metaMessageId  = null
  let metaSendFailed = false

  try {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS)

    let metaRes, metaData
    try {
      metaRes  = await fetch(metaUrl, {
        method:  'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          recipient: { id: conversation.ig_participant_id },
          message:   { text: textForMeta },
        }),
        signal: controller.signal,
      })
      metaData = await metaRes.json()
    } finally {
      clearTimeout(timeout)
    }

    // Handover Protocol: subcode 2534037 = outro app é o dono da thread
    if (metaData.error?.error_subcode === 2534037) {
      const tookControl = await tryTakeThreadControl(
        metaUrl, igBusinessId, conversation.ig_participant_id, accessToken
      )
      if (tookControl) {
        try {
          const retryCtrl    = new AbortController()
          const retryTimeout = setTimeout(() => retryCtrl.abort(), META_FETCH_TIMEOUT_MS)
          try {
            const retryRes  = await fetch(metaUrl, {
              method:  'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                recipient: { id: conversation.ig_participant_id },
                message:   { text: textForMeta },
              }),
              signal: retryCtrl.signal,
            })
            const retryData = await retryRes.json()
            if (retryRes.ok && !retryData.error) { metaRes = retryRes; metaData = retryData }
          } finally {
            clearTimeout(retryTimeout)
          }
        } catch (_e) { /* mantém erro original */ }
      }
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData.error?.code
      const errMsg  = metaData.error?.message ?? ''

      console.error('[ig-service] meta_error code:%s subcode:%s msg:%s igBusinessId=%s participantId=%s',
        errCode, metaData.error?.error_subcode ?? 'none', errMsg, igBusinessId,
        conversation.ig_participant_id)

      if (errCode === 10 || errMsg.toLowerCase().includes('outside the allowed window')) {
        return failure('meta_window_expired', 'Janela de 24h expirada', errCode)
      }
      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return failure('token_expired', 'Token expirado', errCode)
      }
      if (metaRes.status === 429 || errCode === 32 || errCode === 613) {
        return failure('rate_limit', 'Limite de envio atingido', errCode)
      }
      if (errCode === 551 || errMsg.toLowerCase().includes('block')) {
        return failure('user_blocked', 'Usuário bloqueou mensagens', errCode)
      }

      metaSendFailed = true
      return failure('meta_error', `Meta error code:${errCode}`, errCode)
    }

    metaMessageId = metaData.message_id ?? null

  } catch (err) {
    if (err?.name === 'AbortError') {
      return failure('meta_timeout', 'Timeout na API do Instagram')
    }
    return failure('meta_error', 'API do Instagram indisponível')
  }

  // ── 7. Persistir mensagem outbound ─────────────────────────────────────────
  const now = new Date().toISOString()

  const { data: savedMessage, error: insertErr } = await supabase
    .from('instagram_messages')
    .insert({
      conversation_id:          conversationId,
      company_id:               companyId,
      ig_message_id:            metaMessageId ?? `local_${Date.now()}`,
      direction:                'outbound',
      message_type:             'text',
      content:                  trimmedText,   // texto original (sem prefixo de citação)
      sent_by:                  sentBy,        // null para automação
      status:                   'sent',
      timestamp:                now,
      origin:                   origin,
      automation_execution_id:  automationExecutionId,
      automation_node_id:       automationNodeId,
      reply_to_ig_message_id:   replyToIgMessageId ?? null,
      reply_to_content:         replyToContent,
      reply_to_direction:       replyToDirection,
    })
    .select('id, ig_message_id, direction, message_type, content, sent_by, status, timestamp, created_at, reply_to_ig_message_id, reply_to_content, reply_to_direction, origin, automation_execution_id, automation_node_id')
    .single()

  if (insertErr) {
    // Mensagem foi enviada — não bloquear por falha de persistência
    console.error('[ig-service] persist_failed:', { conversationId, err: insertErr.message })
  }

  // ── 8. Atualizar última mensagem da conversa ───────────────────────────────
  await supabase
    .from('instagram_conversations')
    .update({
      last_message_at:      now,
      last_message_preview: trimmedText.slice(0, 100),
      updated_at:           now,
    })
    .eq('id', conversationId)
    .eq('company_id', companyId)  // guard multi-tenant

  return {
    ok:           true,
    igMessageId:  metaMessageId,
    savedMessage: savedMessage ?? {
      id: null, ig_message_id: metaMessageId, direction: 'outbound',
      message_type: 'text', content: trimmedText, sent_by: sentBy,
      status: 'sent', timestamp: now, created_at: now, origin,
      automation_execution_id: automationExecutionId,
      automation_node_id: automationNodeId,
    },
    error:        null,
    errorCode:    null,
    errorType:    null,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function failure(errorType, error, errorCode = null) {
  return { ok: false, igMessageId: null, savedMessage: null, error, errorCode, errorType }
}

async function tryTakeThreadControl(metaUrl, igBusinessId, participantId, accessToken) {
  try {
    const takeUrl = metaUrl.replace('/messages', '/take_thread_control')
      .replace(`/${igBusinessId}/messages`, `/${igBusinessId}/take_thread_control`)
    const takeRes  = await fetch(
      `https://graph.instagram.com/${GRAPH_API_VERSION}/${igBusinessId}/take_thread_control`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ recipient: { id: participantId } }),
      }
    )
    const takeData = await takeRes.json()
    return takeRes.ok && takeData.success === true
  } catch (_e) {
    return false
  }
}

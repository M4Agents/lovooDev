// =============================================================================
// POST /api/chat/react-message
//
// Envia ou remove uma reação em uma mensagem do chat via Uazapi /message/react.
//
// Body:
//   company_id       (string, UUID)   — empresa do caller (obrigatório)
//   conversation_id  (string, UUID)   — conversa (obrigatório)
//   message_id       (string, UUID)   — mensagem a reagir (obrigatório)
//   emoji            (string | null)  — emoji da reação; null = remover reação
//
// Regras funcionais:
//   - Somente mensagens inbound
//   - Mensagem não pode ter mais de 7 dias
//   - Mensagem deve ter uazapi_message_id (necessário para a API externa)
//   - Uma reação ativa por usuário por mensagem (upsert — troca ou remove)
//
// Persistência condicional:
//   A reação SÓ é salva no banco após confirmação da Uazapi (uazapiRes.ok).
//   Falhas da Uazapi bloqueiam a persistência e retornam erro ao frontend
//   para que o update otimista seja revertido.
//
// Mapeamento de erros Uazapi → HTTP:
//   400  → 422  (payload inválido — ex: emoji não suportado)
//   401  → 502  (token inválido — problema de configuração da instância)
//   404  → 404  (mensagem não encontrada na Uazapi)
//   5xx  → 502  (erro interno da Uazapi — bad gateway)
//   rede → 502  (timeout / DNS fail)
//
// Segurança multi-tenant:
//   - Token JWT validado via Supabase auth.getUser
//   - Membership validado em company_users (is_active = true)
//   - Todas as queries ao banco usam company_id + conversation_id
//   - Nunca confia em dados do frontend para resolver o JID ou token Uazapi
//
// JID (Ajuste Conceitual 2):
//   chat_conversations não possui campo remote_jid nem campo JID nativo.
//   O número de contato fica em contact_phone (somente dígitos, ex: 5511999198369).
//   Portanto o JID é montado como `${contact_phone}@s.whatsapp.net`.
//   Validar em dev se o endpoint /message/react aceita sem @s.whatsapp.net.
// =============================================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

const UAZAPI_BASE_URL = 'https://lovoo.uazapi.com'
const REACTION_TTL_DAYS = 7

/** Traduz o status HTTP da Uazapi para o status HTTP que devolvemos ao frontend. */
function uazapiStatusToHttp(uazapiStatus: number): number {
  if (uazapiStatus === 400) return 422  // payload inválido → unprocessable
  if (uazapiStatus === 401) return 502  // token inválido → bad gateway
  if (uazapiStatus === 404) return 404  // mensagem não encontrada
  if (uazapiStatus >= 500)  return 502  // erro interno da Uazapi → bad gateway
  return 502                            // qualquer outro não-ok → bad gateway
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ─── 1. Autenticação ───────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // ─── 2. Validação do body ─────────────────────────────────────────────
    const { company_id, conversation_id, message_id, emoji } = req.body ?? {}

    if (!company_id)      { jsonError(res, 400, 'company_id é obrigatório'); return }
    if (!conversation_id) { jsonError(res, 400, 'conversation_id é obrigatório'); return }
    if (!message_id)      { jsonError(res, 400, 'message_id é obrigatório'); return }

    // emoji null/undefined/'' = remover reação; string = definir/trocar
    const isRemoval = emoji === null || emoji === undefined || emoji === ''
    const emojiValue: string | null = isRemoval ? null : String(emoji).trim()

    // ─── 3. Membership ────────────────────────────────────────────────────
    const membership = await assertMembership(svc, user.id, company_id)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ─── 4. Buscar mensagem (multi-tenant: company_id + conversation_id) ──
    const { data: msg, error: msgError } = await svc
      .from('chat_messages')
      .select('id, direction, uazapi_message_id, conversation_id, company_id, created_at, instance_id')
      .eq('id', message_id)
      .eq('company_id', company_id)
      .eq('conversation_id', conversation_id)
      .maybeSingle()

    if (msgError || !msg) {
      jsonError(res, 404, 'Mensagem não encontrada ou acesso negado'); return
    }

    // ─── 5. Validações funcionais ─────────────────────────────────────────
    if (msg.direction !== 'inbound') {
      jsonError(res, 422, 'Reação só é permitida em mensagens recebidas (inbound)'); return
    }

    if (!msg.uazapi_message_id) {
      jsonError(res, 422, 'Mensagem sem ID externo — não é possível enviar reação'); return
    }

    const messageDate = new Date(msg.created_at)
    const diffDays    = (Date.now() - messageDate.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays > REACTION_TTL_DAYS) {
      jsonError(res, 422, `Reação não permitida em mensagens com mais de ${REACTION_TTL_DAYS} dias`); return
    }

    // ─── 6. Buscar token da instância + telefone do contato ───────────────
    const { data: conv, error: convError } = await svc
      .from('chat_conversations')
      .select('contact_phone, instance_id')
      .eq('id', conversation_id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (convError || !conv) {
      jsonError(res, 404, 'Conversa não encontrada'); return
    }

    const instanceId = conv.instance_id ?? msg.instance_id
    if (!instanceId) {
      jsonError(res, 422, 'Instância WhatsApp não identificada'); return
    }

    const { data: instance, error: instanceError } = await svc
      .from('whatsapp_life_instances')
      .select('provider_token')
      .eq('id', instanceId)
      .eq('company_id', company_id)
      .maybeSingle()

    if (instanceError || !instance?.provider_token) {
      jsonError(res, 422, 'Instância WhatsApp sem token configurado'); return
    }

    // ─── 7. Montar JID (Ajuste Conceitual 2 — sem remote_jid disponível) ─
    // contact_phone contém somente dígitos (ex: 5511999198369)
    // Conforme contrato da Uazapi: number deve ser `numero@s.whatsapp.net`
    const jid = `${conv.contact_phone}@s.whatsapp.net`

    // ─── 8. Chamar Uazapi /message/react ─────────────────────────────────
    // A persistência no banco SÓ ocorre após sucesso (uazapiRes.ok).
    // Qualquer falha bloqueia a persistência e retorna erro ao frontend.
    let uazapiData: any = null
    let uazapiStatus = 0

    try {
      const reactPayload = {
        number: jid,
        text:   emojiValue ?? '',    // string vazia = remover reação na Uazapi
        id:     msg.uazapi_message_id,
      }

      console.log('[react-message] Enviando para Uazapi:', {
        endpoint: '/message/react',
        number:   jid,
        hasEmoji: !!emojiValue,
        msgId:    msg.uazapi_message_id,
      })

      const uazapiRes = await fetch(`${UAZAPI_BASE_URL}/message/react`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'token':        instance.provider_token,
        },
        body:   JSON.stringify(reactPayload),
        signal: AbortSignal.timeout(15000),
      })

      uazapiStatus = uazapiRes.status
      uazapiData   = await uazapiRes.json().catch(() => null)

      if (!uazapiRes.ok) {
        const httpCode = uazapiStatusToHttp(uazapiStatus)
        console.warn('[react-message] Uazapi rejeitou reação:', {
          uazapiStatus,
          httpCode,
          body: uazapiData,
        })
        jsonError(res, httpCode,
          `Uazapi recusou a reação (HTTP ${uazapiStatus})` +
          (uazapiData?.message ? `: ${uazapiData.message}` : '')
        )
        return
      }
    } catch (fetchErr: any) {
      // Timeout, DNS fail, rede indisponível
      console.error('[react-message] Falha de rede ao chamar Uazapi:', fetchErr?.message)
      jsonError(res, 502, 'Não foi possível comunicar com o serviço de mensagens')
      return
    }

    // ─── 9. Persistir reação no banco (somente após sucesso da Uazapi) ────
    let dbResult: any = null
    let dbError: any  = null

    if (isRemoval) {
      const { data, error } = await svc.rpc('chat_remove_reaction', {
        p_company_id:      company_id,
        p_conversation_id: conversation_id,
        p_message_id:      message_id,
        p_user_id:         user.id,
      })
      dbResult = data; dbError = error
    } else {
      const { data, error } = await svc.rpc('chat_upsert_reaction', {
        p_company_id:        company_id,
        p_conversation_id:   conversation_id,
        p_message_id:        message_id,
        p_user_id:           user.id,
        p_emoji:             emojiValue,
        p_provider_response: uazapiData ? JSON.stringify(uazapiData) : null,
      })
      dbResult = data; dbError = error
    }

    if (dbError || dbResult?.success === false) {
      console.error('[react-message] Erro ao persistir reação (Uazapi OK, banco falhou):', dbError ?? dbResult)
      jsonError(res, 500, dbResult?.error ?? 'Reação enviada mas não foi possível persistir'); return
    }

    // ─── 10. Resposta ─────────────────────────────────────────────────────
    res.status(200).json({
      success:     true,
      reaction_id: dbResult?.reaction_id ?? null,
      message_id,
      emoji:       emojiValue,
      removed:     isRemoval,
    })

  } catch (err: any) {
    console.error('[react-message] Erro inesperado:', err?.message)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

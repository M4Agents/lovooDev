// =============================================================================
// POST /api/instagram/suggest-reply
//
// Gera 3 sugestões de resposta para uma conversa Instagram via agente de IA.
//
// Body:
//   conversation_id  (string, UUID) — obrigatório
//   mode             ('sales' | 'consultative' | 'support') — obrigatório
//
// Segurança:
//   - company_id NUNCA vem do body: derivado de instagram_conversations.company_id
//   - membership e RBAC validados via validateInstagramCaller
//   - service_role apenas após validação
//
// Retorno:
//   { success: true, suggestions: string[] }  — sempre 3 itens
// =============================================================================

import { getSupabaseAdmin }        from '../lib/automation/supabaseAdmin.js'
import { validateInstagramCaller } from '../lib/instagram/validateInstagramCaller.js'
import { runAgent }                from '../lib/agents/runner.js'

const USE_ID        = 'chat:reply_suggestion:whatsapp'
const MSG_LIMIT     = 20
const MAX_CTX_CHARS = 6000

const VALID_MODES = ['sales', 'consultative', 'support'] as const
type SuggestionMode = (typeof VALID_MODES)[number]

const MODE_LABELS: Record<SuggestionMode, string> = {
  sales:         'vendas (sales)',
  consultative:  'consultivo (consultative)',
  support:       'suporte (support)',
}

const MODE_INSTRUCTIONS: Record<SuggestionMode, string> = {
  sales: [
    'Tom persuasivo e natural.',
    'Objetivo: gerar desejo e avançar a venda sem ser agressivo.',
    'Destaque benefícios e crie urgência de forma sutil.',
  ].join(' '),
  consultative: [
    'Tom consultivo e empático.',
    'Objetivo: entender a necessidade e orientar a decisão do cliente.',
    'Faça perguntas úteis para aprofundar o contexto.',
  ].join(' '),
  support: [
    'Tom claro, objetivo e empático.',
    'Objetivo: resolver a dúvida ou problema do cliente.',
    'Peça informações objetivas quando necessário.',
  ].join(' '),
}

function buildUserMessage(mode: SuggestionMode, serializedMessages: string): string {
  return [
    `Você é um assistente de atendimento via Instagram Direct.`,
    ``,
    `MODO ATUAL: ${MODE_LABELS[mode]}`,
    `INSTRUÇÃO DE MODO: ${MODE_INSTRUCTIONS[mode]}`,
    ``,
    `REGRAS OBRIGATÓRIAS:`,
    `- Responda EXCLUSIVAMENTE em JSON válido, sem markdown, sem texto antes ou depois.`,
    `- Gere EXATAMENTE 3 sugestões de resposta para o atendente enviar ao cliente.`,
    `- Cada sugestão deve ser curta, natural e pronta para uso no Instagram Direct.`,
    `- Não use emojis.`,
    `- Não use markdown.`,
    `- Não invente informações que não estão na conversa.`,
    `- Não prometa o que não foi discutido.`,
    `- Não mencione que é IA.`,
    ``,
    `FORMATO DE RESPOSTA OBRIGATÓRIO:`,
    `{`,
    `  "suggestions": [`,
    `    "primeira sugestão",`,
    `    "segunda sugestão",`,
    `    "terceira sugestão"`,
    `  ]`,
    `}`,
    ``,
    `HISTÓRICO DA CONVERSA (mais antigas primeiro):`,
    serializedMessages,
    ``,
    `Responda agora com o JSON de sugestões:`,
  ].join('\n')
}

function parseJsonSuggestions(raw: string): string[] | null {
  try {
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
    const parsed  = JSON.parse(cleaned)
    if (
      parsed &&
      Array.isArray(parsed.suggestions) &&
      parsed.suggestions.length >= 1 &&
      parsed.suggestions.every((s: unknown) => typeof s === 'string' && s.trim().length > 0)
    ) {
      return parsed.suggestions.map((s: string) => s.trim()).slice(0, 3)
    }
  } catch { /* JSON inválido */ }
  return null
}

function parseNumberedList(raw: string): string[] | null {
  const matches = [...raw.matchAll(/^\d+[\.\)]\s*(.+)$/gm)]
  const items   = matches.map(m => m[1].trim()).filter(Boolean)
  return items.length >= 1 ? items.slice(0, 3) : null
}

function parsePlainLines(raw: string): string[] | null {
  const delimiter = raw.includes('\n\n') ? '\n\n' : '\n'
  const items     = raw.split(delimiter).map(s => s.trim()).filter(Boolean)
  return items.length >= 1 ? items.slice(0, 3) : null
}

function parseSuggestions(raw: string): string[] | null {
  return parseJsonSuggestions(raw) ?? parseNumberedList(raw) ?? parsePlainLines(raw)
}

function jsonError(res: any, status: number, message: string): void {
  res.status(status).json({ error: message })
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    const svc = getSupabaseAdmin()

    // ─── 1. Validação do body ─────────────────────────────────────────────
    const body           = req.body ?? {}
    const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const mode           = body.mode

    if (!conversationId) { jsonError(res, 400, 'conversation_id é obrigatório'); return }
    if (!VALID_MODES.includes(mode)) {
      jsonError(res, 400, `mode inválido. Valores aceitos: ${VALID_MODES.join(', ')}`); return
    }

    // ─── 2. Buscar conversa e derivar company_id ──────────────────────────
    const { data: conv, error: convErr } = await svc
      .from('instagram_conversations')
      .select('id, company_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convErr || !conv) { jsonError(res, 404, 'Conversa não encontrada'); return }

    // ─── 3. Autenticar caller ─────────────────────────────────────────────
    const auth = await validateInstagramCaller(req, svc, conv.company_id)
    if (!auth.ok) { jsonError(res, auth.status, auth.error); return }

    // ─── 4. Buscar últimas 20 mensagens de texto ──────────────────────────
    const { data: messages, error: msgErr } = await svc
      .from('instagram_messages')
      .select('direction, content, timestamp, created_at')
      .eq('conversation_id', conversationId)
      .eq('company_id', conv.company_id)
      .not('content', 'is', null)
      .neq('content', '')
      .order('timestamp', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(MSG_LIMIT)

    if (msgErr) { jsonError(res, 500, 'Erro ao buscar mensagens da conversa'); return }

    if (!messages || messages.length === 0) {
      jsonError(res, 422, 'Nenhuma mensagem disponível para gerar sugestão'); return
    }

    const orderedMessages = [...messages].reverse()

    let serialized = orderedMessages
      .map(m => {
        const label = m.direction === 'inbound' ? 'Contato' : 'Atendente'
        return `[${label}]: ${m.content}`
      })
      .join('\n')

    if (serialized.length > MAX_CTX_CHARS) {
      serialized = serialized.slice(-MAX_CTX_CHARS)
    }

    // ─── 5. Executar agente ───────────────────────────────────────────────
    const userMessage = buildUserMessage(mode as SuggestionMode, serialized)

    const runResult = await runAgent(USE_ID, {
      userMessage,
      company_id:      conv.company_id,
      user_id:         auth.userId,
      channel:         'web',
      conversation_id: conversationId,
    })

    if (!runResult.ok) {
      const errorCode = (runResult as any).errorCode ?? 'agent_error'
      if (errorCode === 'no_binding' || errorCode === 'agent_inactive') {
        jsonError(res, 422, 'Agente de sugestão não configurado. Acesse Configurações > Agentes Globais para configurar.')
      } else {
        jsonError(res, 502, `Erro ao executar agente de IA: ${errorCode}`)
      }
      return
    }

    if (runResult.fallback) {
      jsonError(res, 422, 'Agente de sugestão não disponível no momento. Tente novamente.'); return
    }

    // ─── 6. Parsear sugestões ─────────────────────────────────────────────
    const suggestions = parseSuggestions(runResult.result)

    if (!suggestions || suggestions.length === 0) {
      console.error('[ig/suggest-reply] Falha ao parsear sugestões:', runResult.result?.slice(0, 300))
      jsonError(res, 503, 'Agente retornou resposta em formato inesperado. Tente novamente.')
      return
    }

    while (suggestions.length < 3) {
      suggestions.push(suggestions[suggestions.length - 1])
    }

    res.status(200).json({ success: true, suggestions })

  } catch (err: any) {
    console.error('[ig/suggest-reply] Erro inesperado:', err?.message ?? err)
    jsonError(res, 500, 'Erro interno no servidor')
  }
}

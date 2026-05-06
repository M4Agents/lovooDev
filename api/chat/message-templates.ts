// =============================================================================
// GET /api/chat/message-templates?conversation_id=
//
// Retorna templates disponíveis para uso no chat (acionamento por "/").
//
// Difere do endpoint de Configurações:
//   - company_id derivado da conversa (nunca do body/query)
//   - Retorna apenas templates ativos + canal whatsapp_life
//   - Usado pelo picker de templates no compositor de mensagem
//
// Segurança:
//   - conversation_id → busca chat_conversations → extrai company_id
//   - membership do usuário validada nesse company_id
//   - service_role usado apenas após auth + membership
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'GET') return jsonError(res, 405, 'Método não permitido')

  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const conversationId = (req as any).query?.conversation_id as string | undefined
  if (!conversationId) return jsonError(res, 400, 'conversation_id obrigatório')

  // Derivar company_id a partir da conversa — nunca confiar no frontend
  const { data: conversation, error: convErr } = await svc
    .from('chat_conversations')
    .select('company_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (convErr || !conversation) {
    return jsonError(res, 404, 'Conversa não encontrada')
  }

  const companyId = conversation.company_id as string

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  // Categorias da empresa (apenas custom — não há mais categorias system)
  const { data: categories, error: catErr } = await svc
    .from('message_template_categories')
    .select('id, company_id, name, is_system, sort_order')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (catErr) {
    console.error('[chat/message-templates GET] categories error:', catErr)
    return jsonError(res, 500, 'Erro ao carregar categorias')
  }

  // Templates: apenas ativos, canal whatsapp_life, da empresa
  const { data: templates, error: tplErr } = await svc
    .from('message_templates')
    .select('id, category_id, name, content, channel')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('channel', 'whatsapp_life')
    .order('name', { ascending: true })

  if (tplErr) {
    console.error('[chat/message-templates GET] templates error:', tplErr)
    return jsonError(res, 500, 'Erro ao carregar templates')
  }

  return res.status(200).json({ categories: categories ?? [], templates: templates ?? [] })
}

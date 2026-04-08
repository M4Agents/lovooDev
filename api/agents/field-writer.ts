// =====================================================
// POST /api/agents/field-writer
//
// Gera texto para campos de IA no cadastro de produtos/serviços.
// Acesso: qualquer usuário autenticado e membro da company_id informada.
//
// Body: { use_id, item_type, item_name, item_description?, company_id }
//
// use_ids aceitos:
//   products:field_writer:internal_notes
//   products:field_writer:unavailable_behavior
//   services:field_writer:internal_notes
//   services:field_writer:unavailable_behavior
//
// Retorno: { ok: true, result: string }
// =====================================================

import { createClient } from '@supabase/supabase-js'
import { runAgent } from '../lib/agents/runner.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const ALLOWED_USE_IDS = new Set([
  'products:field_writer:internal_notes',
  'products:field_writer:unavailable_behavior',
  'services:field_writer:internal_notes',
  'services:field_writer:unavailable_behavior',
])

const FIELD_LABELS: Record<string, string> = {
  'products:field_writer:internal_notes':       'Notas internas do produto',
  'products:field_writer:unavailable_behavior': 'Comportamento quando indisponível (produto)',
  'services:field_writer:internal_notes':       'Notas internas do serviço',
  'services:field_writer:unavailable_behavior': 'Comportamento quando indisponível (serviço)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url     = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url.trim() || !anonKey.trim()) return null
  return { url, anonKey }
}

function jsonError(res: any, status: number, message: string): void {
  res.setHeader('Content-Type', 'application/json')
  res.status(status).json({ ok: false, error: message })
}

// ── Auth: valida JWT e verifica membership na company ─────────────────────────

async function assertCompanyMember(
  req: any,
  companyId: string
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; message: string }> {
  const env = getSupabaseEnv()
  if (!env) return { ok: false, status: 403, message: 'Configuração de servidor incompleta' }

  const authHeader = req.headers?.authorization
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Autenticação necessária' }
  }

  const supabase = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { ok: false, status: 401, message: 'Sessão inválida ou expirada' }

  const { data: membership } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!membership) return { ok: false, status: 403, message: 'Acesso negado' }

  return { ok: true, userId: user.id }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Método não permitido')
  }

  // ── 1. Validar body ───────────────────────────────────────────────────────

  const body = req.body as Record<string, unknown>

  const useId           = typeof body?.use_id          === 'string' ? body.use_id.trim()          : ''
  const itemType        = typeof body?.item_type        === 'string' ? body.item_type.trim()        : ''
  const itemName        = typeof body?.item_name        === 'string' ? body.item_name.trim()        : ''
  const itemDescription = typeof body?.item_description === 'string' ? body.item_description.trim() : ''
  const companyId       = typeof body?.company_id       === 'string' ? body.company_id.trim()       : ''

  if (!useId)      return jsonError(res, 400, 'use_id é obrigatório')
  if (!itemName)   return jsonError(res, 400, 'item_name é obrigatório')
  if (!companyId)  return jsonError(res, 400, 'company_id é obrigatório')

  if (!ALLOWED_USE_IDS.has(useId)) {
    return jsonError(res, 400, `use_id inválido para este endpoint: ${useId}`)
  }

  // ── 2. Auth ───────────────────────────────────────────────────────────────

  const auth = await assertCompanyMember(req, companyId)
  if (!auth.ok) return jsonError(res, auth.status, auth.message)

  // ── 3. Montar contexto e executar agente ──────────────────────────────────

  const itemLabel = itemType === 'service' ? 'serviço' : 'produto'
  const fieldLabel = FIELD_LABELS[useId] ?? 'campo'

  const userMessage = [
    `Gere o conteúdo para o campo "${fieldLabel}" do ${itemLabel} a seguir.`,
    `Nome: ${itemName}`,
    itemDescription ? `Descrição: ${itemDescription}` : null,
    'Retorne apenas o texto do campo, sem títulos, marcadores ou explicações adicionais.',
  ]
    .filter(Boolean)
    .join('\n')

  const agentResult = await runAgent(useId, {
    userMessage,
    variables: {
      item_name:        itemName,
      item_description: itemDescription,
      item_type:        itemLabel,
    },
    extra_context: [
      `Nome do ${itemLabel}: ${itemName}`,
      itemDescription ? `Descrição: ${itemDescription}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    company_id: companyId,
    user_id:    auth.userId,
    entity_type: itemType || 'product',
    channel:     'web',
  })

  if (!agentResult.ok) {
    return jsonError(res, 500, 'Não foi possível gerar o conteúdo. Verifique se há um agente configurado para este campo.')
  }

  if (agentResult.fallback) {
    return jsonError(res, 503, 'Nenhum agente configurado para este campo. Vincule um agente ao uso funcional correspondente em Configurações → Agentes.')
  }

  res.status(200).json({ ok: true, result: agentResult.result })
}

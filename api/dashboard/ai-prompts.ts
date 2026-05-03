// =====================================================
// GET/POST /api/dashboard/ai-prompts
//
// Gerencia prompts complementares da IA Analítica por empresa.
//
// GET ?company_id=X
//   Retorna os 3 tipos MVP com fallback para vazio se não configurado.
//   Auth: membro ativo da empresa.
//
// POST ?company_id=X
//   Body: { analysis_type, custom_prompt, is_active }
//   Upsert pelo par (company_id, analysis_type).
//   Auth: admin / super_admin / system_admin da empresa.
//
// Segurança:
//   - company_id validado contra membership (nunca apenas do body/query)
//   - Tamanho do custom_prompt limitado a 1000 chars (espelhando DB constraint)
//   - service_role apenas backend
//   - Não alterar prompt base — esse endpoint só toca dashboard_ai_prompts
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { canAiAnalysis }       from '../lib/dashboard/aiAnalysisAccess.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { MVP_ANALYSIS_TYPES, type AnalysisType } from '../lib/dashboard/aiAnalysisContexts.js'

// Roles permitidos para escrita
const WRITE_ROLES = new Set(['admin', 'super_admin', 'system_admin'])

// ── GET ───────────────────────────────────────────────────────────────────────

async function handleGet(req: any, res: any, svc: any, companyId: string): Promise<void> {
  const { data: rows } = await svc
    .from('dashboard_ai_prompts')
    .select('id, analysis_type, custom_prompt, is_active, updated_by, updated_at')
    .eq('company_id', companyId)

  // Normalizar: retornar todos os 3 tipos com fallback para vazio/inativo se ausente
  const promptMap: Record<string, unknown> = {}
  for (const row of (rows ?? []) as any[]) {
    promptMap[row.analysis_type] = row
  }

  const data = MVP_ANALYSIS_TYPES.map((type) => promptMap[type] ?? {
    id:            null,
    analysis_type: type,
    custom_prompt: '',
    is_active:     false,
    updated_by:    null,
    updated_at:    null,
  })

  res.status(200).json({ ok: true, data })
}

// ── POST ──────────────────────────────────────────────────────────────────────

async function handlePost(req: any, res: any, svc: any, companyId: string, userId: string, membership: { role: string }): Promise<void> {
  if (!WRITE_ROLES.has(membership.role)) {
    jsonError(res, 403, 'Apenas administradores podem editar prompts de IA')
    return
  }

  const body = req.body ?? {}
  const { analysis_type, is_active } = body
  const custom_prompt = typeof body.custom_prompt === 'string' ? body.custom_prompt : ''

  // Validar tipo
  if (!MVP_ANALYSIS_TYPES.includes(analysis_type as AnalysisType)) {
    jsonError(res, 400, `analysis_type inválido. Aceitos: ${MVP_ANALYSIS_TYPES.join(', ')}`)
    return
  }

  // Validar tamanho
  if (custom_prompt.length > 1000) {
    jsonError(res, 400, 'custom_prompt deve ter no máximo 1000 caracteres')
    return
  }

  // Upsert por (company_id, analysis_type)
  const { data, error } = await svc
    .from('dashboard_ai_prompts')
    .upsert(
      {
        company_id:    companyId,
        analysis_type,
        custom_prompt: custom_prompt.trim(),
        is_active:     is_active !== false,
        updated_by:    userId,
      },
      { onConflict: 'company_id,analysis_type' },
    )
    .select('id, analysis_type, custom_prompt, is_active, updated_by, updated_at')
    .single()

  if (error) {
    console.error('[dashboard/ai-prompts] Erro upsert:', error.message)
    jsonError(res, 500, 'Erro ao salvar prompt')
    return
  }

  res.status(200).json({ ok: true, data })
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (!['GET', 'POST'].includes(req.method)) {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // 1. Auth
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // 2. company_id
    const companyId = typeof req.query?.company_id === 'string'
      ? req.query.company_id.trim()
      : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    // 3. Membership
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 4. Feature flag
    const allowed = await canAiAnalysis(svc, companyId)
    if (!allowed) { jsonError(res, 403, 'Recurso de IA analítica não habilitado neste plano'); return }

    if (req.method === 'GET') {
      return await handleGet(req, res, svc, companyId)
    }

    return await handlePost(req, res, svc, companyId, user.id, membership)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/ai-prompts] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

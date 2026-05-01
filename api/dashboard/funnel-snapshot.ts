// =====================================================
// GET /api/dashboard/funnel-snapshot
//
// Pipeline atual: onde estão as oportunidades AGORA em cada etapa.
// Não usa filtro de período — representa o estado presente.
//
// Query params:
//   company_id  (obrigatório)
//   funnel_id   (obrigatório quando empresa tem múltiplos funis)
//
// Segurança:
//   - company_id validado contra membership
//   - funnel_id validado contra company_id (assertFunnelBelongsToCompany)
//   - 400 explícito se multi-funnel sem funnel_id
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import {
  detectFunnelMode,
  buildFunnelSnapshotMetrics,
} from '../lib/dashboard/metrics.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ------------------------------------------------------------------
    // 1. Autenticação
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // ------------------------------------------------------------------
    // 2. Validação de company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Detecção de modo + validação de funnel_id
    // ------------------------------------------------------------------
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : ''

    const funnelMode = await detectFunnelMode(svc, companyId)

    if (funnelMode === 'multi-funnel' && !funnelId) {
      jsonError(res, 400, 'funnel_id é obrigatório quando a empresa possui múltiplos funis')
      return
    }

    // Resolve o funnel_id efetivo: se single-funnel sem funnel_id,
    // busca o funil padrão da empresa para não deixar funnelId vazio.
    let effectiveFunnelId = funnelId

    if (!effectiveFunnelId) {
      const { data: defaultFunnel } = await svc
        .from('sales_funnels')
        .select('id')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!defaultFunnel) {
        // Empresa sem funil ativo — retorna estrutura vazia segura
        return res.status(200).json({
          data: { funnel_id: null, stages: [] },
          meta: { funnel_id: null },
        })
      }

      effectiveFunnelId = defaultFunnel.id
    } else {
      // funnel_id foi fornecido — validar que pertence à empresa
      const valid = await assertFunnelBelongsToCompany(svc, effectiveFunnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    // ------------------------------------------------------------------
    // 4. Snapshot
    // ------------------------------------------------------------------
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-snapshot.ts:step4',message:'chamando buildFunnelSnapshotMetrics',data:{companyId,effectiveFunnelId,funnelMode},timestamp:Date.now(),hypothesisId:'H1-H3'})}).catch(()=>{});
    // #endregion
    const snapshot = await buildFunnelSnapshotMetrics(svc, companyId, effectiveFunnelId)
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-snapshot.ts:step4-ok',message:'snapshot ok',data:{stagesCount:snapshot.stages.length},timestamp:Date.now(),hypothesisId:'H1-H3'})}).catch(()=>{});
    // #endregion

    // ------------------------------------------------------------------
    // 5. Resposta
    // Cache maior: snapshot muda apenas quando há movimentação de oportunidade.
    // ------------------------------------------------------------------
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json({
      data: snapshot,
      meta: {
        funnel_id: effectiveFunnelId,
        funnel_mode: funnelMode,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-snapshot.ts:catch',message:'erro no snapshot',data:{error:msg,stack:err instanceof Error?err.stack?.slice(0,400):null},timestamp:Date.now(),hypothesisId:'H1-H3'})}).catch(()=>{});
    // #endregion
    console.error('[dashboard/funnel-snapshot] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

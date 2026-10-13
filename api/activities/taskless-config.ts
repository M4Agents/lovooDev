import { validateCaller, isUUID } from '../lib/activities/activityAuth.js'
import { canEditTasklessConfig, TASKLESS_STAGE_LIMIT } from '../../src/utils/tasklessLeadAccess.js'

function queryText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function cors(res: { setHeader: (name: string, value: string) => void }) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

interface StageRow {
  id: string
  name: string
  position: number
  stage_type: string
}

interface FunnelRow {
  id: string
  name: string
  is_active: boolean
  stages: StageRow[] | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET ou PUT.' })
  }

  const companyId = req.method === 'PUT'
    ? req.body?.company_id
    : queryText(req.query?.company_id)
  const authResult = await validateCaller(req, companyId)
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }

  const { supabase, role, companyId: scopedCompanyId } = authResult.ctx
  const canEdit = canEditTasklessConfig(role)

  if (req.method === 'PUT') {
    if (!canEdit) {
      return res.status(403).json({ success: false, error: 'Permissão insuficiente para alterar as etapas' })
    }
    const rawIds = req.body?.stage_ids
    if (!Array.isArray(rawIds)) {
      return res.status(400).json({ success: false, error: 'stage_ids deve ser uma lista' })
    }
    if (rawIds.length > TASKLESS_STAGE_LIMIT) {
      return res.status(422).json({ success: false, error: 'Selecione no máximo 200 etapas' })
    }
    if (rawIds.some(id => !isUUID(id))) {
      return res.status(400).json({ success: false, error: 'stage_ids contém um identificador inválido' })
    }

    const { data, error } = await supabase.rpc('replace_company_taskless_stages', {
      p_company_id: scopedCompanyId,
      p_stage_ids: rawIds,
    })
    if (error) {
      const message = error.message ?? ''
      if (message.includes('stage_not_in_company')) {
        return res.status(422).json({ success: false, error: 'Uma etapa não pertence a esta empresa' })
      }
      if (message.includes('too_many_stages')) {
        return res.status(422).json({ success: false, error: 'Selecione no máximo 200 etapas' })
      }
      console.error('[taskless-config] replace:', message)
      return res.status(500).json({ success: false, error: 'Erro ao salvar as etapas' })
    }
    return res.status(200).json({ success: true, can_edit: true, stage_ids: data ?? [] })
  }

  const [{ data: funnels, error: funnelError }, { data: selected, error: selectedError }] = await Promise.all([
    supabase
      .from('sales_funnels')
      .select('id, name, is_active, stages:funnel_stages(id, name, position, stage_type)')
      .eq('company_id', scopedCompanyId)
      .order('name'),
    supabase
      .from('company_taskless_stages')
      .select('stage_id')
      .eq('company_id', scopedCompanyId),
  ])

  if (funnelError || selectedError) {
    console.error('[taskless-config] leitura:', funnelError?.message ?? selectedError?.message)
    return res.status(500).json({ success: false, error: 'Erro ao carregar as etapas' })
  }

  const normalized = ((funnels ?? []) as FunnelRow[]).map(funnel => ({
    id: funnel.id,
    name: funnel.name,
    is_active: funnel.is_active,
    stages: [...(funnel.stages ?? [])].sort((a, b) => a.position - b.position),
  }))

  return res.status(200).json({
    success: true,
    can_edit: canEdit,
    funnels: normalized,
    stage_ids: (selected ?? []).map(row => row.stage_id as string),
  })
}

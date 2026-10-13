import { validateCaller, isUUID } from '../lib/activities/activityAuth.js'
import { TASKLESS_STAGE_LIMIT } from '../../src/utils/tasklessLeadAccess.js'
import {
  DEFAULT_TASKLESS_PERIOD,
  isCivilDate,
  isTasklessPeriodType,
} from '../../src/utils/tasklessPeriod.js'

function queryText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function cors(res: { setHeader: (name: string, value: string) => void }) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function civilDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  const date = value.slice(0, 10)
  return isCivilDate(date) ? date : null
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

interface PreferenceRow {
  period_type: string
  custom_start: string | null
  custom_end: string | null
}

function periodPayload(row: PreferenceRow | null) {
  const fallback = {
    period_type: DEFAULT_TASKLESS_PERIOD,
    custom_start: null,
    custom_end: null,
    saved: false,
  }
  if (!row || !isTasklessPeriodType(row.period_type)) return fallback
  if (row.period_type !== 'custom') {
    return { period_type: row.period_type, custom_start: null, custom_end: null, saved: true }
  }
  const customStart = civilDate(row.custom_start)
  const customEnd = civilDate(row.custom_end)
  if (!customStart || !customEnd || customStart > customEnd) return fallback
  return { period_type: row.period_type, custom_start: customStart, custom_end: customEnd, saved: true }
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

  const { supabase, userId, companyId: scopedCompanyId } = authResult.ctx

  if (req.method === 'PUT') {
    const rawIds = req.body?.stage_ids
    const periodType = typeof req.body?.period_type === 'string' ? req.body.period_type : ''
    if (!Array.isArray(rawIds)) {
      return res.status(400).json({ success: false, error: 'stage_ids deve ser uma lista' })
    }
    if (rawIds.length > TASKLESS_STAGE_LIMIT) {
      return res.status(422).json({ success: false, error: 'Selecione no máximo 200 etapas' })
    }
    if (rawIds.some(id => !isUUID(id))) {
      return res.status(400).json({ success: false, error: 'stage_ids contém um identificador inválido' })
    }
    if (!isTasklessPeriodType(periodType)) {
      return res.status(400).json({ success: false, error: 'Período inválido' })
    }

    let customStart: string | null = null
    let customEnd: string | null = null
    if (periodType === 'custom') {
      customStart = civilDate(req.body?.custom_start)
      customEnd = civilDate(req.body?.custom_end)
      if (!customStart || !customEnd || customStart > customEnd) {
        return res.status(400).json({ success: false, error: 'Informe a data de início e a data de término' })
      }
    }

    const { data, error } = await supabase.rpc('replace_user_taskless_config', {
      p_company_id: scopedCompanyId,
      p_user_id: userId,
      p_stage_ids: rawIds,
      p_period_type: periodType,
      p_custom_start: customStart,
      p_custom_end: customEnd,
    })
    if (error) {
      const message = error.message ?? ''
      if (message.includes('stage_not_in_company')) {
        return res.status(422).json({ success: false, error: 'Uma etapa não pertence a esta empresa' })
      }
      if (message.includes('too_many_stages')) {
        return res.status(422).json({ success: false, error: 'Selecione no máximo 200 etapas' })
      }
      if (message.includes('invalid_custom_period') || message.includes('invalid_period')) {
        return res.status(400).json({ success: false, error: 'Período inválido' })
      }
      console.error('[taskless-config] replace:', message)
      return res.status(500).json({ success: false, error: 'Erro ao salvar a configuração' })
    }

    const saved = (data ?? {}) as {
      stage_ids?: string[]
      period_type?: string
      custom_start?: string | null
      custom_end?: string | null
    }
    return res.status(200).json({
      success: true,
      stage_ids: saved.stage_ids ?? [],
      period_type: saved.period_type ?? periodType,
      custom_start: saved.custom_start ?? null,
      custom_end: saved.custom_end ?? null,
      saved: true,
    })
  }

  const [{ data: funnels, error: funnelError }, { data: selected, error: selectedError }, { data: preference, error: preferenceError }] = await Promise.all([
    supabase
      .from('sales_funnels')
      .select('id, name, is_active, stages:funnel_stages(id, name, position, stage_type)')
      .eq('company_id', scopedCompanyId)
      .order('name'),
    supabase
      .from('user_taskless_stages')
      .select('stage_id')
      .eq('company_id', scopedCompanyId)
      .eq('user_id', userId),
    supabase
      .from('user_taskless_preferences')
      .select('period_type, custom_start, custom_end')
      .eq('company_id', scopedCompanyId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (funnelError || selectedError || preferenceError) {
    console.error('[taskless-config] leitura:', funnelError?.message ?? selectedError?.message ?? preferenceError?.message)
    return res.status(500).json({ success: false, error: 'Erro ao carregar a configuração' })
  }

  const normalized = ((funnels ?? []) as FunnelRow[]).map(funnel => ({
    id: funnel.id,
    name: funnel.name,
    is_active: funnel.is_active,
    stages: [...(funnel.stages ?? [])].sort((a, b) => a.position - b.position),
  }))

  return res.status(200).json({
    success: true,
    funnels: normalized,
    stage_ids: (selected ?? []).map(row => row.stage_id as string),
    ...periodPayload(preference as PreferenceRow | null),
  })
}

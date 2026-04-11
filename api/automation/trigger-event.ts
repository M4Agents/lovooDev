// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// #region agent log
// PROBE-4: triggerEvaluator como .js — require() de JS funciona sem compilação TS
console.log('[trigger-event][7a137a] módulo carregado — importando triggerEvaluator.js');
// #endregion
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { matchesTriggerConditions } = require('../lib/automation/triggerEvaluator')

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export default async function handler(req: any, res: any) {
  // #region agent log
  // PROBE-4: confirmar que require() de .js em api/lib/ funciona em runtime Vercel
  console.log('[trigger-event][7a137a] PROBE-4 invocado', { method: req.method })
  // #endregion
  return res.status(200).json({ ok: true, probe: 'PROBE-4-require-js', has_fn: typeof matchesTriggerConditions === 'function' })
}

// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator'
import type { TriggerEvent } from '../lib/automation/triggerEvaluator'
// #region agent log
// PROBE-3: triggerEvaluator de api/lib/ — confirmar que api/lib/ é resolvido pelo Vercel
console.log('[trigger-event][7a137a] módulo carregado — triggerEvaluator de api/lib/automation/');
// #endregion

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export default async function handler(req: any, res: any) {
  // #region agent log
  // PROBE-3: confirmar que api/lib/ funciona e matchesTriggerConditions é função
  console.log('[trigger-event][7a137a] PROBE-3 invocado', { method: req.method })
  // #endregion
  return res.status(200).json({ ok: true, probe: 'PROBE-3-api-lib', has_fn: typeof matchesTriggerConditions === 'function' })
}

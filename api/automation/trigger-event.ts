// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import { matchesTriggerConditions } from '../../src/services/automation/triggerEvaluator'
import type { TriggerEvent } from '../../src/services/automation/triggerEvaluator'
// #region agent log
// PROBE-2: só triggerEvaluator (puro) — sem AutomationEngine
console.log('[trigger-event][7a137a] módulo carregado — com triggerEvaluator, SEM AutomationEngine');
// #endregion

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export default async function handler(req: any, res: any) {
  // #region agent log
  // PROBE-2: testar se triggerEvaluator (puro) carrega sem crash
  console.log('[trigger-event][7a137a] PROBE-2 invocado', { method: req.method })
  // #endregion
  return res.status(200).json({ ok: true, probe: 'PROBE-2-triggerEvaluator-only', has_fn: typeof matchesTriggerConditions === 'function' })
}

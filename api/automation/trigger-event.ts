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
// H-B PROBE: sem imports de src/ — testar se crash é estrutural ou dos imports
console.log('[trigger-event][7a137a] módulo carregado — SEM imports de src/');
// #endregion

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export default async function handler(req: any, res: any) {
  // #region agent log
  // H-B PROBE: handler mínimo sem imports de src/ — confirmar se crash é dos imports
  console.log('[trigger-event][7a137a] handler mínimo invocado', { method: req.method })
  // #endregion
  return res.status(200).json({ ok: true, probe: 'H-B', note: 'handler sem imports de src/' })
}

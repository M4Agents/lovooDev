// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// @ts-ignore — arquivo JS em api/lib/automation (sem types)
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator.js'

// #region agent log
// FASE 0: módulo carregou com import estático de api/lib/automation/triggerEvaluator.js
console.log('[trigger-event][7a137a] FASE-0 módulo carregado')
// #endregion

export default async function handler(req: any, res: any) {
  // #region agent log
  console.log('[trigger-event][7a137a] FASE-0 handler invocado', { method: req.method })
  // #endregion
  return res.status(200).json({
    ok: true,
    probe: 'FASE-0-import-js',
    has_fn: typeof matchesTriggerConditions === 'function'
  })
}

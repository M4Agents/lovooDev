// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// @ts-ignore — arquivo JS ESM em api/lib/automation (sem types)
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator.js'

// #region agent log
console.log('[trigger-event][7a137a] FASE-0c módulo carregado — import estático ESM')
// #endregion

export default async function handler(req: any, res: any) {
  // #region agent log
  console.log('[trigger-event][7a137a] FASE-0c handler invocado', { method: req.method })
  // #endregion

  return res.status(200).json({
    probe: 'FASE-0c-static-import-esm',
    has_fn: typeof matchesTriggerConditions === 'function'
  })
}

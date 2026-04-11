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
console.log('[trigger-event][7a137a] FASE-0b módulo carregado — sem import estático de triggerEvaluator')
// #endregion

export default async function handler(req: any, res: any) {
  // #region agent log
  console.log('[trigger-event][7a137a] FASE-0b handler invocado', { method: req.method })
  // #endregion

  // Probe H-A / H-B / H-C: verificar se triggerEvaluator.js é acessível em runtime
  let has_fn = false
  let import_error: string | null = null
  let import_keys: string[] = []

  try {
    const mod = await import('../lib/automation/triggerEvaluator.js')
    has_fn = typeof mod.matchesTriggerConditions === 'function'
    import_keys = Object.keys(mod)
    // #region agent log
    console.log('[trigger-event][7a137a] import OK', { has_fn, import_keys })
    // #endregion
  } catch (err: any) {
    import_error = err?.message ?? String(err)
    // #region agent log
    console.log('[trigger-event][7a137a] import FALHOU', { error: import_error, code: err?.code })
    // #endregion
  }

  return res.status(200).json({
    probe: 'FASE-0b-dynamic-import',
    has_fn,
    import_error,
    import_keys
  })
}

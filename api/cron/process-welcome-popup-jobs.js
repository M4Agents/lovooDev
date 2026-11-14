// GET /api/cron/process-welcome-popup-jobs
//
// Retoma automações do pop-up cuja concessão já foi gravada.
// cronGuard continua primeiro. Neste endpoint o segredo é obrigatório.
// Os outros crons não mudam. Não registra e-mail, telefone nem cupom.

import { cronGuard } from '../lib/cronGuard.js';
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';
import { processWelcomeAutomationJobs } from '../lib/nuvemshop/welcomeAutomationWorker.js';

export default async function handler(req, res) {
  if (!cronGuard(req, res)) return;

  const authHeader = req.headers?.authorization ?? req.headers?.Authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [{ createExecution, processFlowAsync }, { matchesTriggerConditions }] = await Promise.all([
      import('../lib/automation/executor.js'),
      import('../lib/automation/triggerEvaluator.js'),
    ]);
    const summary = await processWelcomeAutomationJobs({
      supabase,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    console.info(JSON.stringify({ event: 'welcome_popup_jobs', ...summary }));
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    console.info(JSON.stringify({ event: 'welcome_popup_jobs_failed' }));
    return res.status(500).json({ ok: false });
  }
}

// =============================================================================
// GET /api/cron/nuvemshop-retry-failed
//
// Worker de retry da integração Nuvemshop — executado pelo Vercel Cron.
//
// Responsabilidade:
//   Mover eventos 'failed' com next_attempt_at <= now() de volta para 'pending',
//   permitindo que o process-events worker os reivindique na próxima execução.
//
// NÃO reprocessa eventos diretamente — apenas recoloca na fila.
//
// Separação de concerns:
//   - process-events: claim → lock → heartbeat → dispatch → release → update status
//   - retry-failed:   reset failed → pending (simples reset de status)
//
// Frequência: executado com menor frequência que process-events (a cada 2 minutos).
// =============================================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const svc       = getSupabaseAdmin();

  console.log('[nv-retry-failed] started');

  // Buscar eventos failed que já podem ser tentados novamente
  const { data: failedEvents, error: fetchErr } = await svc
    .from('nuvemshop_webhook_events')
    .select('id, company_id, store_id, topic, attempts, max_attempts, next_attempt_at')
    .eq('status', 'failed')
    .lte('next_attempt_at', new Date().toISOString())
    .lt('attempts', svc.raw?.('max_attempts') ?? 5)  // Segurança — filtro inline
    .limit(50);

  if (fetchErr) {
    console.error('[nv-retry-failed] fetch_failed err=%s', fetchErr.message);
    return res.status(500).json({ error: 'Fetch failed' });
  }

  // Filtrar no código para garantir (DB pode não suportar coluna comparison)
  const eligible = (failedEvents ?? []).filter(
    e => e.attempts < e.max_attempts
  );

  if (eligible.length === 0) {
    console.log('[nv-retry-failed] no_eligible_events elapsed=%dms', Date.now() - startedAt);
    return res.status(200).json({ ok: true, reset: 0 });
  }

  const ids = eligible.map(e => e.id);

  // Reset: failed → pending (sem modificar attempts ou next_attempt_at)
  const { error: updateErr } = await svc
    .from('nuvemshop_webhook_events')
    .update({
      status:     'pending',
      worker_id:  null,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('status', 'failed'); // Garante que só moves 'failed' (evita race condition)

  if (updateErr) {
    console.error('[nv-retry-failed] reset_failed err=%s', updateErr.message);
    return res.status(500).json({ error: 'Reset failed' });
  }

  // Limpeza de OAuth states expirados (manutenção inline, best-effort)
  await svc
    .from('nuvemshop_oauth_states')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .then(() => {});

  const elapsed = Date.now() - startedAt;
  console.log('[nv-retry-failed] done reset=%d elapsed=%dms', ids.length, elapsed);

  return res.status(200).json({ ok: true, reset: ids.length, elapsed_ms: elapsed });
}

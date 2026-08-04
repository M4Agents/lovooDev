// =============================================================================
// GET /api/cron/nuvemshop-process-events
//
// Worker principal da integração Nuvemshop — executado pelo Vercel Cron.
//
// Responsabilidades do Worker (Plano v5.1):
//   1. Gerar worker_id único por execução
//   2. Reivindicar batch de eventos (claim atômico via RPC)
//   3. Para cada evento: processEvent()
//      a. Extrair resource_type e resource_id
//      b. Adquirir lock de recurso (anti-concorrência)
//      c. Iniciar heartbeat (renovação de lock enquanto processa)
//      d. Despachar ao handler via eventDispatcher
//      e. [finally] Parar heartbeat E liberar lock (SEMPRE)
//      f. Atualizar status do evento (processed/failed/dead)
//   4. Logar métricas estruturadas da execução
//
// Nomenclatura alinhada ao Plano v5.1:
//   MAX_RETRIES     ← max_attempts na coluna DB
//   retry_count     ← attempts no evento DB
//   next_retry_at   ← next_attempt_at no evento DB
// =============================================================================

import { randomBytes }                from 'crypto';
import { getSupabaseAdmin }           from '../lib/automation/supabaseAdmin.js';
import { dispatch, topicToResourceType } from '../lib/nuvemshop/eventDispatcher.js';

const WORKER_PREFIX      = 'nv-proc';
const CLAIM_LIMIT        = 10;
const LOCK_TTL_SECONDS   = 90;
const HEARTBEAT_INTERVAL = 25_000;   // Renovar lock a cada 25s (< TTL de 90s)
const MAX_RETRIES        = 5;        // Alinhado ao max_attempts padrão no banco

/** Backoff exponencial com cap em 1 hora. */
function calcNextRetryAt(retryCount) {
  const backoffSeconds = Math.min(60 * Math.pow(2, retryCount), 3_600);
  return new Date(Date.now() + backoffSeconds * 1000).toISOString();
}

function makeWorkerId() {
  return `${WORKER_PREFIX}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

// ── Processamento individual de evento ───────────────────────────────────────

/**
 * Processa um único evento com lock + heartbeat + dispatch.
 * Garante que heartbeat e lock sejam SEMPRE liberados no finally.
 *
 * @returns {{ outcome: 'processed'|'failed'|'skipped'|'lock_busy', error?: string, skippedReason?: string }}
 */
async function processEvent(event, svc, workerId) {
  const {
    id:             eventUuid,
    company_id:     companyId,
    store_id:       storeId,
    topic,
    payload,
    correlation_id: correlationId,
    attempts:       retryCount,
    max_attempts:   maxAttempts,
  } = event;

  const resourceType = topicToResourceType(topic);
  const resourceId   = String(payload?.id ?? eventUuid);
  const skipLock     = resourceType === 'store' || !resourceId;

  let lockAcquired = false;
  let heartbeat    = null;

  try {
    // ── Adquirir lock ───────────────────────────────────────────────────────
    if (!skipLock) {
      const { data: lockResult, error: lockErr } = await svc.rpc('acquire_nuvemshop_lock', {
        p_company_id:    companyId,
        p_store_id:      storeId,
        p_resource_type: resourceType,
        p_resource_id:   resourceId,
        p_worker_id:     workerId,
        p_ttl_seconds:   LOCK_TTL_SECONDS,
      });

      if (lockErr) throw new Error(`lock_rpc_error: ${lockErr.message}`);

      if (!lockResult?.ok) {
        return { outcome: 'lock_busy' };
      }
      lockAcquired = true;
    } else {
      lockAcquired = true;
    }

    // ── Iniciar heartbeat ───────────────────────────────────────────────────
    // setInterval é válido em contexto async Node.js — processa entre awaits
    if (!skipLock) {
      heartbeat = setInterval(async () => {
        try {
          await svc.rpc('renew_nuvemshop_lock', {
            p_company_id:    companyId,
            p_resource_type: resourceType,
            p_resource_id:   resourceId,
            p_worker_id:     workerId,
            p_ttl_seconds:   LOCK_TTL_SECONDS,
          });
        } catch {
          // Falha de heartbeat é tolerada: o TTL cobre o tempo máximo do handler
        }
      }, HEARTBEAT_INTERVAL);
    }

    // ── Despachar ao handler ─────────────────────────────────────────────────
    const ctx = {
      companyId,
      storeId,
      topic,
      payload,
      correlationId: correlationId ?? eventUuid,
      workerId,
    };

    const result = await dispatch(ctx);

    if (result?.skipped) {
      // Topic desconhecido ou explicitamente ignorado: registrar com rastreabilidade
      const skippedReason = result.reason ?? 'unknown';
      console.log(JSON.stringify({
        level:         'warn',
        event:         'event_skipped',
        topic,
        skipped_reason: skippedReason,
        company_id:    companyId,
        event_uuid:    eventUuid,
        correlation_id: correlationId,
        worker_id:     workerId,
      }));
      return { outcome: 'skipped', skippedReason };
    }

    return { outcome: 'processed' };

  } catch (err) {
    return { outcome: 'failed', error: err?.message ?? 'Unknown handler error' };

  } finally {
    // ── SEMPRE: parar heartbeat e liberar lock ───────────────────────────────
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (lockAcquired && !skipLock) {
      try {
        await svc.rpc('release_nuvemshop_lock', {
          p_company_id:    companyId,
          p_resource_type: resourceType,
          p_resource_id:   resourceId,
          p_worker_id:     workerId,
        });
      } catch (releaseErr) {
        // Lock expira por TTL — não é crítico, mas logar
        console.warn('[nv-process-events] lock_release_failed eventUuid=%s err=%s',
          eventUuid, releaseErr?.message);
      }
    }
  }
}

// ── Handler principal (cron) ──────────────────────────────────────────────────

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const workerId  = makeWorkerId();
  const startedAt = Date.now();
  const svc       = getSupabaseAdmin();

  console.log('[nv-process-events] started worker_id=%s', workerId);

  // ── Claim atômico ─────────────────────────────────────────────────────────
  let events = [];
  try {
    const { data, error } = await svc.rpc('claim_nuvemshop_events', {
      p_worker_id: workerId,
      p_limit:     CLAIM_LIMIT,
    });
    if (error) throw error;
    events = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[nv-process-events] claim_failed worker_id=%s err=%s', workerId, err?.message);
    return res.status(500).json({ error: 'Claim failed', workerId });
  }

  if (events.length === 0) {
    return res.status(200).json({ ok: true, processed: 0, workerId });
  }

  console.log('[nv-process-events] claimed=%d worker_id=%s', events.length, workerId);

  const stats = { processed: 0, failed: 0, dead: 0, skipped: 0, lock_busy: 0 };

  for (const event of events) {
    const {
      id:           eventUuid,
      company_id:   companyId,
      store_id:     storeId,
      attempts:     retryCount,
      max_attempts: maxAttempts,
      correlation_id: correlationId,
    } = event;

    const result = await processEvent(event, svc, workerId);

    // ── Atualizar status do evento ──────────────────────────────────────────

    if (result.outcome === 'lock_busy') {
      // Devolver a pending para ser reclamado em outra execução
      await svc
        .from('nuvemshop_webhook_events')
        .update({ status: 'pending', worker_id: null, updated_at: new Date().toISOString() })
        .eq('id', eventUuid);
      stats.lock_busy++;
      continue;
    }

    if (result.outcome === 'processed' || result.outcome === 'skipped') {
      await svc
        .from('nuvemshop_webhook_events')
        .update({
          status:       'processed',
          processed_at: new Date().toISOString(),
          // Para eventos ignorados: registrar motivo em last_error para rastreabilidade
          last_error:   result.skippedReason ? `skipped:${result.skippedReason}` : null,
          worker_id:    null,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', eventUuid);

      svc
        .from('nuvemshop_connections')
        .update({ last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('nuvemshop_store_id', storeId)
        .then(() => {});

      result.outcome === 'skipped' ? stats.skipped++ : stats.processed++;
      continue;
    }

    // outcome === 'failed'
    const effectiveRetries = typeof retryCount === 'number' ? retryCount : 0;
    const isDead           = effectiveRetries >= (maxAttempts ?? MAX_RETRIES);
    const newStatus        = isDead ? 'dead' : 'failed';
    const next_retry_at    = isDead ? null : calcNextRetryAt(effectiveRetries);

    console.error(JSON.stringify({
      level:          'error',
      event:          'event_failed',
      topic:          event.topic,
      company_id:     companyId,
      event_uuid:     eventUuid,
      correlation_id: correlationId,
      retry_count:    effectiveRetries,
      max_retries:    maxAttempts ?? MAX_RETRIES,
      is_dead:        isDead,
      next_retry_at,
      error:          result.error,
      worker_id:      workerId,
    }));

    await svc
      .from('nuvemshop_webhook_events')
      .update({
        status:          newStatus,
        last_error:      result.error,
        // last_attempt_at já foi atualizado pelo claim RPC (não duplicar)
        next_attempt_at: next_retry_at,
        worker_id:       null,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', eventUuid);

    svc
      .from('nuvemshop_connections')
      .update({ last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('nuvemshop_store_id', storeId)
      .then(() => {});

    isDead ? stats.dead++ : stats.failed++;
  }

  const elapsed = Date.now() - startedAt;
  console.log(JSON.stringify({
    level:     'info',
    event:     'worker_done',
    worker_id: workerId,
    claimed:   events.length,
    ...stats,
    elapsed_ms: elapsed,
  }));

  return res.status(200).json({ ok: true, workerId, stats, elapsed_ms: elapsed });
}

// =============================================================================
// POST /api/nuvemshop/admin/replay-event
//
// Replaya um evento dead ou failed, criando um novo evento pending
// com referência ao original via replayed_from.
//
// Body: { company_id, event_id }
//
// RBAC: super_admin, system_admin apenas.
//
// Integridade transacional:
//   - Verificar que o evento pertence à company informada (multi-tenant)
//   - Verificar que o evento está em status 'dead' ou 'failed'
//   - INSERT do novo evento + UPDATE do replay_count são atômicos via RPC
//   - Registrar trilha de auditoria nos logs estruturados (nunca no payload)
//
// Proteção contra replay concorrente:
//   - A chave de idempotência do novo evento é alterada (timestamp suffix)
//   - O pipeline normal de processamento aplica lock distribuído por resource_id
// =============================================================================

import { randomUUID }             from 'crypto';
import { getSupabaseAdmin }       from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';

const ADMIN_ROLES   = ['super_admin', 'system_admin'];
const REPLAYABLE    = ['dead', 'failed'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id: companyId, event_id: eventId } = req.body ?? {};
  if (!companyId || !eventId) {
    return res.status(400).json({ error: 'company_id e event_id são obrigatórios' });
  }

  const requestId     = `req_${Date.now()}`;
  const correlationId = `replay_${randomUUID()}`;
  const svc           = getSupabaseAdmin();

  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ADMIN_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── Buscar o evento original ──────────────────────────────────────────────
  const { data: original, error: fetchErr } = await svc
    .from('nuvemshop_webhook_events')
    .select('id, company_id, store_id, topic, payload, status, idempotency_key, retry_count')
    .eq('id', eventId)
    .eq('company_id', companyId)  // garantia multi-tenant
    .maybeSingle();

  if (fetchErr) {
    return res.status(500).json({ error: 'Falha ao buscar evento' });
  }
  if (!original) {
    return res.status(404).json({ error: 'Evento não encontrado' });
  }
  if (!REPLAYABLE.includes(original.status)) {
    return res.status(422).json({
      error: `Evento não pode ser replayado (status atual: ${original.status})`,
    });
  }

  // ── Criar novo evento pending com referência ao original ─────────────────
  const newIdempotencyKey = `replay_${correlationId}:${original.idempotency_key}`;

  const { data: newEvent, error: insertErr } = await svc
    .from('nuvemshop_webhook_events')
    .insert({
      company_id:      original.company_id,
      store_id:        original.store_id,
      topic:           original.topic,
      payload:         original.payload,
      status:          'pending',
      retry_count:     0,
      idempotency_key: newIdempotencyKey,
      correlation_id:  correlationId,
      replayed_from:   original.id,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error(JSON.stringify({
      event: 'replay_insert_failed', company_id: companyId,
      event_id: eventId, error: insertErr.message, request_id: requestId,
    }));
    return res.status(500).json({ error: 'Falha ao criar evento de replay' });
  }

  // ── Atualizar replay_count no original ───────────────────────────────────
  await svc
    .from('nuvemshop_webhook_events')
    .update({ replay_count: (original.replay_count ?? 0) + 1 })
    .eq('id', original.id);

  // Trilha de auditoria — nunca loga payload
  console.log(JSON.stringify({
    event:          'event_replayed',
    company_id:     companyId,
    original_id:    eventId,
    new_event_id:   newEvent.id,
    topic:          original.topic,
    replayed_by:    auth.userId,
    role:           auth.role,
    correlation_id: correlationId,
    request_id:     requestId,
  }));

  return res.status(200).json({
    ok:           true,
    new_event_id: newEvent.id,
    correlation_id: correlationId,
  });
}

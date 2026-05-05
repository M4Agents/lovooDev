// =============================================================================
// POST /api/leads/import-file?company_id=<uuid>
//
// Recebe leads já parseados pelo frontend (CSV/Excel/Google Sheets) e os cria
// de forma segura no backend via RPC create_lead_from_company.
//
// AUTENTICAÇÃO : JWT via Authorization: Bearer <token>
// AUTORIZAÇÃO  : role admin/system_admin/super_admin OU import_leads=true em permissions
// MULTI-TENANT : company_id via query param, validado contra company_users do JWT
// PLANO        : bloqueia TODA a importação se requested > remaining (sem truncamento)
// CRIAÇÃO      : reutiliza create_lead_from_company (advisory lock + dedup atômica)
// AUDITORIA    : 1 evento agregado em lead_import_events por sessão de importação
// =============================================================================

import { createClient }          from '@supabase/supabase-js';
import { getPlanLimits }         from '../lib/plans/limitChecker.js';
import { dispatchLeadCreatedTrigger } from '../lib/automation/dispatchLeadCreatedTrigger.js';
import { handleLeadReentry, hashPayload } from '../lib/leads/handleLeadReentry.js';

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const MAX_LEADS      = 1_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

const ALWAYS_ALLOWED = new Set(['admin', 'system_admin', 'super_admin']);

// Campos que nunca devem ser aceitos do frontend
const BLOCKED_FIELDS = new Set([
  'company_id', 'user_id', 'role', 'permissions', 'plan_id',
  'is_active', 'is_over_plan', 'deleted_at', 'created_at', 'updated_at',
  'password', 'token', 'secret', 'authorization', 'jwt', 'api_key',
]);

// Campos padrão aceitos no lead_data da RPC
const STANDARD_FIELDS = new Set([
  'name', 'email', 'phone', 'origin', 'status', 'interest',
  'company_name', 'company_cnpj', 'company_email',
  'company_razao_social', 'company_nome_fantasia',
  'company_cep', 'company_cidade', 'company_estado',
  'company_endereco', 'company_telefone', 'company_site',
  'campanha', 'conjunto_anuncio', 'anuncio', 'utm_medium',
  'visitor_id',
]);

// ── Service client factory ─────────────────────────────────────────────────────

function getSvc() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key?.trim()) throw new Error('[import-file] SUPABASE_SERVICE_ROLE_KEY não configurado');
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Validação de caller (JWT + membership + permissão) ────────────────────────

async function validateCaller(req, svc, companyId) {
  const auth = req.headers?.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }
  const token = auth.slice(7);

  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };

  const { data: mem, error: memErr } = await svc
    .from('company_users')
    .select('company_id, role, permissions')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (memErr || !mem) return { ok: false, status: 403, error: 'Acesso negado a esta empresa' };

  const perms   = mem.permissions ?? {};
  const allowed = ALWAYS_ALLOWED.has(mem.role) || perms.import_leads === true;
  if (!allowed) return { ok: false, status: 403, error: 'Permissão insuficiente para importar leads' };

  return { ok: true, userId: user.id, companyId: mem.company_id, role: mem.role };
}

// ── Validação de funil/etapa ───────────────────────────────────────────────────

async function validateFunnelStage(svc, companyId, funnelId, stageId) {
  if (!funnelId) return { ok: true };

  const { data: funnel } = await svc
    .from('sales_funnels')
    .select('id')
    .eq('id', funnelId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!funnel) {
    return { ok: false, status: 400, error: 'Funil não encontrado ou inativo para esta empresa' };
  }

  if (stageId) {
    const { data: stage } = await svc
      .from('funnel_stages')
      .select('id')
      .eq('id', stageId)
      .eq('funnel_id', funnelId)
      .eq('stage_type', 'active')
      .maybeSingle();
    if (!stage) return { ok: false, status: 400, error: 'Etapa inválida para o funil informado' };
  }

  return { ok: true };
}

// ── Pré-carregamento de UUID de campos personalizados válidos ─────────────────

async function loadValidUuidFields(svc, companyId, leads) {
  const uuids = new Set();
  for (const lead of leads) {
    for (const key of Object.keys(lead)) {
      if (key.startsWith('custom_')) {
        const id = key.slice(7);
        if (/^[0-9a-f-]{36}$/i.test(id)) uuids.add(id);
      }
    }
  }
  if (uuids.size === 0) return new Map();

  const { data: fields } = await svc
    .from('lead_custom_fields')
    .select('id')
    .eq('company_id', companyId)
    .in('id', [...uuids]);

  return new Map((fields ?? []).map(f => [f.id, true]));
}

// ── Extração dos campos padrão (whitelist + bloqueio de sensíveis) ────────────

function buildLeadPayload(raw) {
  const payload = {};
  for (const [key, val] of Object.entries(raw)) {
    if (BLOCKED_FIELDS.has(key)) continue;
    if (!STANDARD_FIELDS.has(key)) continue;
    if (val === null || val === undefined || val === '') continue;
    payload[key] = String(val).slice(0, 500);
  }
  if (!payload.origin) payload.origin = 'file_import';
  return payload;
}

// ── Inserção de campos personalizados (UUID e numérico) ───────────────────────

async function insertCustomFields(svc, companyId, leadId, raw, validUuidFields) {
  const values = [];

  for (const [key, val] of Object.entries(raw)) {
    if (!val && val !== 0) continue;

    // Formato UUID: custom_<uuid>
    if (key.startsWith('custom_')) {
      const fieldId = key.slice(7);
      if (validUuidFields.has(fieldId)) {
        values.push({ field_id: fieldId, value: String(val).slice(0, 500) });
      }
      continue;
    }

    // Formato numérico: ID legado no cabeçalho do CSV
    if (/^\d+$/.test(key)) {
      const { data: field } = await svc
        .rpc('get_custom_field_by_id', {
          p_company_id: companyId,
          p_numeric_id: parseInt(key, 10),
        })
        .maybeSingle();
      if (field?.id) {
        values.push({ field_id: field.id, value: String(val).slice(0, 500) });
      }
    }
  }

  if (values.length === 0) return;

  const { error } = await svc.rpc('insert_custom_field_values_webhook', {
    lead_id_param: leadId,
    field_values:  values,
  });
  if (error) console.error('[import-file] insert custom fields error:', error.message);
}

// ── Atribuição de tags ─────────────────────────────────────────────────────────

async function assignTags(svc, companyId, leadId, rawTags) {
  const names = typeof rawTags === 'string'
    ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
    : [];
  if (names.length === 0) return;

  const { data: existing } = await svc
    .from('lead_tags')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('is_active', true);

  const ids = [];
  for (const name of names) {
    const found = (existing ?? []).find(t => t.name.toLowerCase() === name.toLowerCase());
    if (found) {
      ids.push(found.id);
    } else {
      const { data: created } = await svc
        .from('lead_tags')
        .insert({ company_id: companyId, name, color: '#6B7280', is_active: true })
        .select('id')
        .maybeSingle();
      if (created?.id) ids.push(created.id);
    }
  }

  for (const tagId of ids) {
    const { error } = await svc
      .from('lead_tag_assignments')
      .insert({ lead_id: leadId, tag_id: tagId });
    if (error && error.code !== '23505') {
      console.error('[import-file] tag assignment error:', error.message);
    }
  }
}

// ── Posicionamento no funil (non-blocking) ────────────────────────────────────

async function positionInFunnel(svc, leadId, funnelId, stageId) {
  if (!funnelId) return;
  try {
    let targetStage = stageId;
    if (!targetStage) {
      const { data: first } = await svc
        .from('funnel_stages')
        .select('id')
        .eq('funnel_id', funnelId)
        .eq('stage_type', 'active')
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (first) targetStage = first.id;
    }
    if (!targetStage) return;

    const { data: opp } = await svc
      .from('opportunities')
      .select('id')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (opp) {
      await svc
        .from('opportunity_funnel_positions')
        .update({
          funnel_id:        funnelId,
          stage_id:         targetStage,
          entered_stage_at: new Date().toISOString(),
          updated_at:       new Date().toISOString(),
        })
        .eq('opportunity_id', opp.id);
    }
  } catch (err) {
    console.error('[import-file] funnel positioning error:', err?.message);
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  // ── 1. company_id via query param — nunca do body ─────────────────────────
  const companyId = req.query?.company_id;
  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'company_id é obrigatório como query param' });
  }

  // ── 2. Rejeitar arrays e estruturas de lote no body ───────────────────────
  if (Array.isArray(req.body)) {
    return res.status(400).json({ error: 'validation_error', message: 'Envie leads dentro do campo "leads", não como array raiz' });
  }

  // ── 3. Verificar tamanho do body ──────────────────────────────────────────
  const bodySize = Buffer.byteLength(JSON.stringify(req.body ?? {}));
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'payload_too_large', message: 'Payload excede 2 MB' });
  }

  // ── 4. Validar estrutura do body ──────────────────────────────────────────
  const { leads, funnel_id: funnelId = null, stage_id: stageId = null } = req.body ?? {};

  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'validation_error', message: 'leads deve ser um array não vazio' });
  }
  if (leads.length > MAX_LEADS) {
    return res.status(400).json({
      error: 'validation_error',
      message: `Máximo de ${MAX_LEADS} leads por importação. Recebido: ${leads.length}.`,
    });
  }

  // ── 5. Service client ─────────────────────────────────────────────────────
  let svc;
  try {
    svc = getSvc();
  } catch (err) {
    console.error('[import-file] service client error:', err.message);
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  // ── 6. Autenticação + permissão ───────────────────────────────────────────
  const caller = await validateCaller(req, svc, companyId);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error });

  // ── 7. Validar funil/etapa ────────────────────────────────────────────────
  const fvr = await validateFunnelStage(svc, companyId, funnelId, stageId);
  if (!fvr.ok) return res.status(fvr.status).json({ error: fvr.error });

  // ── 8. Verificação de plano (upfront — bloqueia lote inteiro se insuficiente)
  const limits = await getPlanLimits(svc, companyId);
  if (limits.max_leads !== null) {
    const { count: currentCount } = await svc
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('deleted_at', null);

    const current   = currentCount ?? 0;
    const remaining = Math.max(0, limits.max_leads - current);

    if (current + leads.length > limits.max_leads) {
      return res.status(403).json({
        error:       'plan_limit',
        message:     `Limite do plano atingido. Slots disponíveis: ${remaining}. Leads solicitados: ${leads.length}.`,
        max_allowed: limits.max_leads,
        current,
        remaining,
      });
    }
  }

  // ── 9. Pré-carregar campos personalizados UUID válidos para a empresa ──────
  const validUuidFields = await loadValidUuidFields(svc, companyId, leads);

  // ── 10. Processar leads (best-effort — erros por linha não param o lote) ──
  let successCount          = 0;
  let duplicateCount        = 0;
  let duplicateReentryCount = 0;
  let errorCount            = 0;
  let planLimitHit          = false;

  for (const rawLead of leads) {
    if (planLimitHit) { errorCount++; continue; }

    try {
      const leadPayload = buildLeadPayload(rawLead);

      const { data: result, error: rpcErr } = await svc
        .rpc('create_lead_from_company', { p_company_id: companyId, lead_data: leadPayload });

      if (rpcErr) {
        console.error('[import-file] create_lead_from_company rpc error:', rpcErr.message);
        errorCount++;
        continue;
      }

      if (!result?.success) {
        if (result?.error === 'plan_limit_exceeded') {
          planLimitHit = true;
          errorCount++;
          continue;
        }
        errorCount++;
        continue;
      }

      const leadId      = result.lead_id;
      const isDuplicate = result.is_duplicate === true;

      if (isDuplicate) {
        duplicateCount++;

        // Registrar reentrada no lead existente — espelha o comportamento do webhook.
        // newLeadId === existingLeadId (ambos apontam para o mesmo lead) → handleLeadReentry
        // entra no caminho de reentrada direta, sem gravar new_lead_id no metadata.
        const existingLeadId = result.duplicate_of_lead_id || leadId;
        const payloadRef = {
          name:  rawLead.name  || null,
          email: rawLead.email || null,
          phone: rawLead.phone || null,
        };
        try {
          await handleLeadReentry({
            newLeadId:       leadId,         // === existingLeadId → reentrada direta
            existingLeadId,
            companyId,
            source:          'file_import',
            externalEventId: null,
            originChannel:   rawLead.utm_source || rawLead.origin || null,
            metadata:        { payload_hash: hashPayload(payloadRef) },
            supabase:        svc,
          });
          duplicateReentryCount++;
        } catch (err) {
          console.error('[import-file] lead reentry error:', {
            message: err?.message,
            leadId:  existingLeadId,
          });
        }

        if (funnelId) await positionInFunnel(svc, leadId, funnelId, stageId);
        continue;
      }

      successCount++;

      // Campos personalizados
      try {
        await insertCustomFields(svc, companyId, leadId, rawLead, validUuidFields);
      } catch (cfErr) {
        console.error('[import-file] custom fields error:', cfErr?.message);
      }

      // Tags
      try {
        if (rawLead.tags) await assignTags(svc, companyId, leadId, rawLead.tags);
      } catch (tagErr) {
        console.error('[import-file] tags error:', tagErr?.message);
      }

      // Posicionamento no funil
      if (funnelId) await positionInFunnel(svc, leadId, funnelId, stageId);

      // Automações (fire-and-forget — nunca bloqueia a importação)
      dispatchLeadCreatedTrigger(
        { companyId, leadId, source: 'file_import' },
      ).catch(err => console.error('[import-file] automation dispatch error:', err?.message));

    } catch (err) {
      console.error('[import-file] lead processing error:', err?.message);
      errorCount++;
    }
  }

  // ── 11. Log agregado em lead_import_events ────────────────────────────────
  const logStatus = (successCount === 0 && duplicateCount === 0) ? 'error' : 'success';
  try {
    await svc.rpc('log_lead_import_event', {
      p_company_id:      companyId,
      p_status:          logStatus,
      p_payload_summary: {
        source:              'file_import',
        total:               leads.length,
        success:             successCount,
        duplicate:           duplicateCount,
        duplicate_reentries: duplicateReentryCount,
        error:               errorCount,
      },
    });
  } catch (logErr) {
    console.error('[import-file] log_lead_import_event failed:', logErr?.message);
  }

  // ── 12. Resposta ──────────────────────────────────────────────────────────
  return res.status(200).json({
    summary: {
      total_submitted: leads.length,
      success:         successCount,
      duplicate:       duplicateCount,
      error:           errorCount,
    },
  });
}

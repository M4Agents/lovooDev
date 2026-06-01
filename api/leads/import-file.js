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
// RESPONSÁVEL  : coluna opcional responsible_user_email — resolve email → user_id via
//               RPC resolve_responsible_users_by_email (SECURITY DEFINER); nunca
//               bloqueia o lote em caso de email inválido ou não encontrado.
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

// ── Pré-carregamento de campos numéricos legados ──────────────────────────────
//
// Elimina a query `get_custom_field_by_id` por lead×campo que antes ocorria
// dentro de insertCustomFields para cada coluna de ID numérico no CSV.
// Resultado: Map<numericId (string), uuid> resolvido uma única vez.

async function loadNumericFieldMap(svc, companyId, leads) {
  const numericIds = new Set();
  for (const lead of leads) {
    for (const key of Object.keys(lead)) {
      if (/^\d+$/.test(key)) numericIds.add(key);
    }
  }
  if (numericIds.size === 0) return new Map();

  const results = await Promise.all(
    [...numericIds].map(async (numericId) => {
      const { data: field } = await svc
        .rpc('get_custom_field_by_id', {
          p_company_id: companyId,
          p_numeric_id: parseInt(numericId, 10),
        })
        .maybeSingle();
      return field?.id ? [numericId, field.id] : null;
    })
  );

  return new Map(results.filter(Boolean));
}

// ── Pré-carregamento de responsible_user_id por email ────────────────────────
//
// Extrai os emails únicos do CSV, chama a RPC SECURITY DEFINER
// resolve_responsible_users_by_email (que faz JOIN em auth.users) e retorna
// um Map<emailNormalizado, user_id> para uso dentro do loop principal.
//
// Design:
//   - Falha silenciosa: erros na RPC retornam Map vazio (lote não é bloqueado).
//   - Emails normalizados (lower + trim) para comparação consistente.
//   - Filtra apenas emails não-vazios presentes no CSV (sem query desnecessária).

async function buildResponsibleUserMap(svc, companyId, leads) {
  const emailSet = new Set();
  for (const lead of leads) {
    const raw = lead.responsible_user_email;
    if (raw && typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized) emailSet.add(normalized);
    }
  }

  if (emailSet.size === 0) return new Map();

  const { data, error } = await svc.rpc('resolve_responsible_users_by_email', {
    p_company_id: companyId,
    p_emails:     Array.from(emailSet),
  });

  if (error) {
    console.error('[import-file] resolve_responsible_users_by_email error:', error.message);
    return new Map();
  }

  // email (já normalizado pela RPC) → user_id
  return new Map((data ?? []).map(row => [row.email, row.user_id]));
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

async function insertCustomFields(svc, companyId, leadId, raw, validUuidFields, numericFieldMap) {
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

    // Formato numérico: usa mapa pré-carregado (sem query por lead)
    if (/^\d+$/.test(key)) {
      const fieldId = numericFieldMap.get(key);
      if (fieldId) {
        values.push({ field_id: fieldId, value: String(val).slice(0, 500) });
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

// ── Pré-carregamento de tags existentes da empresa ────────────────────────────
//
// Carregada uma única vez antes do loop para evitar N queries idênticas
// (uma por lead). Tags criadas durante a importação não aparecem nesta lista,
// mas a criação de novas tags dentro de assignTags trata isso corretamente.

async function preloadExistingTags(svc, companyId, leads) {
  const hasAnyTag = leads.some(l => l.tags);
  if (!hasAnyTag) return [];

  const { data } = await svc
    .from('lead_tags')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('is_active', true);

  return data ?? [];
}

// ── Pré-carregamento da etapa-alvo do funil ───────────────────────────────────
//
// Carregada uma única vez antes do loop; a mesma etapa é usada para todos
// os leads — elimina N queries à tabela funnel_stages.

async function resolveTargetStage(svc, funnelId, stageId) {
  if (!funnelId) return null;
  if (stageId) return stageId;

  const { data: first } = await svc
    .from('funnel_stages')
    .select('id')
    .eq('funnel_id', funnelId)
    .eq('stage_type', 'active')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  return first?.id ?? null;
}

// ── Atribuição de tags (usa lista pré-carregada para evitar query por lead) ───

async function assignTags(svc, companyId, leadId, rawTags, existingTags) {
  const names = typeof rawTags === 'string'
    ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
    : [];
  if (names.length === 0) return;

  const ids = [];
  for (const name of names) {
    const found = existingTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (found) {
      ids.push(found.id);
    } else {
      // Tag nova: tenta criar (23505 = já criada em paralelo por outro lead → ignora)
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

// ── Pré-carregamento do mapa funil/etapa por nome ────────────────────────────
//
// Lê os valores únicos de funnel_name e stage_name presentes no CSV e constrói
// um mapa "funnel_name_lower|stage_name_lower" → { funnel_id, stage_id }.
// Permite que cada lead especifique sua própria etapa sem queries por lead.

async function preloadFunnelStageMap(svc, companyId, leads) {
  const funnelNames = new Set(
    leads
      .map(l => l.funnel_name?.toString().trim())
      .filter(Boolean)
  );
  if (funnelNames.size === 0) return new Map();

  const { data: funnels } = await svc
    .from('sales_funnels')
    .select('id, name')
    .eq('company_id', companyId)
    .in('name', [...funnelNames]);

  if (!funnels?.length) return new Map();

  const funnelIds = funnels.map(f => f.id);
  const { data: stages } = await svc
    .from('funnel_stages')
    .select('id, name, funnel_id')
    .in('funnel_id', funnelIds);

  const map = new Map();
  for (const funnel of funnels) {
    const funnelKey = funnel.name.toLowerCase();
    for (const stage of (stages ?? [])) {
      if (stage.funnel_id === funnel.id) {
        const key = `${funnelKey}|${stage.name.toLowerCase()}`;
        map.set(key, { funnel_id: funnel.id, stage_id: stage.id });
      }
    }
  }
  return map;
}

// ── Resolver funil/etapa para um lead individual ──────────────────────────────
//
// Se o lead tiver funnel_name + stage_name, usa o mapa pré-carregado.
// Se não encontrar no mapa (nome inválido), cai no global como fallback seguro.

function resolveFunnelStageForLead(rawLead, funnelStageMap, globalFunnelId, globalTargetStageId) {
  const fn = rawLead.funnel_name?.toString().trim();
  const sn = rawLead.stage_name?.toString().trim();
  if (fn && sn) {
    const key = `${fn.toLowerCase()}|${sn.toLowerCase()}`;
    const found = funnelStageMap.get(key);
    if (found) return { funnelId: found.funnel_id, stageId: found.stage_id };
  }
  return { funnelId: globalFunnelId, stageId: globalTargetStageId };
}

// ── Posicionamento no funil (etapa já resolvida pelo pré-carregamento) ─────────

async function positionInFunnel(svc, leadId, funnelId, targetStageId) {
  if (!funnelId || !targetStageId) return;
  try {
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
          stage_id:         targetStageId,
          entered_stage_at: new Date().toISOString(),
          updated_at:       new Date().toISOString(),
        })
        .eq('opportunity_id', opp.id);
    }
  } catch (err) {
    console.error('[import-file] funnel positioning error:', err?.message);
  }
}

// ── Processar um único lead (usado em paralelo via Promise.allSettled) ────────
//
// Retorna um objeto de contadores para agregação pelo caller.
// Nunca lança exceção — falhas são capturadas e refletidas em { error: 1 }.
// planLimitHit é passado por valor (imutável dentro do lote); o caller decide
// se interrompe os lotes seguintes com base no retorno.

async function processOneLead(rawLead, { svc, companyId, funnelId, targetStageId, funnelStageMap, validUuidFields, numericFieldMap, responsibleUserMap, existingTags }) {
  const zero = { success: 0, duplicate: 0, duplicateReentry: 0, error: 0, planLimitHit: false, responsibleAssigned: 0, responsibleNotFound: 0, responsibleUpdateError: 0 };

  try {
    const leadPayload = buildLeadPayload(rawLead);

    // Resolver funil/etapa: por lead (funnel_name + stage_name no CSV) ou global
    const { funnelId: leadFunnelId, stageId: leadStageId } =
      resolveFunnelStageForLead(rawLead, funnelStageMap, funnelId, targetStageId);

    const { data: result, error: rpcErr } = await svc
      .rpc('create_lead_from_company', { p_company_id: companyId, lead_data: leadPayload });

    if (rpcErr) {
      console.error('[import-file] create_lead_from_company rpc error:', rpcErr.message);
      return { ...zero, error: 1 };
    }

    if (!result?.success) {
      if (result?.error === 'plan_limit_exceeded') return { ...zero, error: 1, planLimitHit: true };
      return { ...zero, error: 1 };
    }

    const leadId      = result.lead_id;
    const isDuplicate = result.is_duplicate === true;

    // Helper de atribuição de responsável (compartilhado entre novo e duplicado)
    const assignResponsible = async () => {
      const email = rawLead.responsible_user_email?.toString().trim().toLowerCase();
      if (!email) return { responsibleAssigned: 0, responsibleNotFound: 0, responsibleUpdateError: 0 };
      const userId = responsibleUserMap.get(email);
      if (!userId) return { responsibleAssigned: 0, responsibleNotFound: 1, responsibleUpdateError: 0 };
      const { error: respErr } = await svc
        .from('leads')
        .update({ responsible_user_id: userId })
        .eq('id', leadId)
        .eq('company_id', companyId);
      if (respErr) {
        console.error('[import-file] responsible_user update error:', respErr.message);
        return { responsibleAssigned: 0, responsibleNotFound: 0, responsibleUpdateError: 1 };
      }
      return { responsibleAssigned: 1, responsibleNotFound: 0, responsibleUpdateError: 0 };
    };

    if (isDuplicate) {
      const existingLeadId = result.duplicate_of_lead_id || leadId;
      let duplicateReentry = 0;
      try {
        await handleLeadReentry({
          newLeadId:       leadId,
          existingLeadId,
          companyId,
          source:          'file_import',
          externalEventId: null,
          originChannel:   rawLead.utm_source || rawLead.origin || null,
          metadata:        { payload_hash: hashPayload({ name: rawLead.name || null, email: rawLead.email || null, phone: rawLead.phone || null }) },
          supabase:        svc,
        });
        duplicateReentry = 1;
      } catch (err) {
        console.error('[import-file] lead reentry error:', { message: err?.message, leadId: existingLeadId });
      }

      if (leadFunnelId) await positionInFunnel(svc, leadId, leadFunnelId, leadStageId);
      const resp = await assignResponsible().catch(() => ({ responsibleAssigned: 0, responsibleNotFound: 0, responsibleUpdateError: 1 }));

      return { ...zero, duplicate: 1, duplicateReentry, ...resp };
    }

    // Lead novo
    try { await insertCustomFields(svc, companyId, leadId, rawLead, validUuidFields, numericFieldMap); }
    catch (cfErr) { console.error('[import-file] custom fields error:', cfErr?.message); }

    try { if (rawLead.tags) await assignTags(svc, companyId, leadId, rawLead.tags, existingTags); }
    catch (tagErr) { console.error('[import-file] tags error:', tagErr?.message); }

    if (leadFunnelId) await positionInFunnel(svc, leadId, leadFunnelId, leadStageId);
    const resp = await assignResponsible().catch(() => ({ responsibleAssigned: 0, responsibleNotFound: 0, responsibleUpdateError: 1 }));

    dispatchLeadCreatedTrigger({ companyId, leadId, source: 'file_import' })
      .catch(err => console.error('[import-file] automation dispatch error:', err?.message));

    return { ...zero, success: 1, ...resp };

  } catch (err) {
    console.error('[import-file] lead processing error:', err?.message);
    return { ...zero, error: 1 };
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

  // ── 9. Pré-carregar todos os mapas antes do loop ─────────────────────────
  //
  // Todas as pré-cargas rodam em paralelo para reduzir latência total.
  // - validUuidFields: campos custom_<uuid> válidos para a empresa
  // - numericFieldMap: campos numéricos legados (eliminam query por lead×campo)
  // - responsibleUserMap: email→user_id (sem query por lead)
  // - existingTags: tags ativas da empresa (sem query por lead)
  // - targetStageId: etapa-alvo do funil (sem query por lead)
  const [validUuidFields, numericFieldMap, responsibleUserMap, existingTags, targetStageId, funnelStageMap] = await Promise.all([
    loadValidUuidFields(svc, companyId, leads),
    loadNumericFieldMap(svc, companyId, leads),
    buildResponsibleUserMap(svc, companyId, leads),
    preloadExistingTags(svc, companyId, leads),
    resolveTargetStage(svc, funnelId, stageId),
    preloadFunnelStageMap(svc, companyId, leads),
  ]);

  // ── 10. Processar leads em lotes paralelos ────────────────────────────────
  //
  // BATCH_SIZE=50: empiricamente validado para 798 leads dentro do maxDuration
  // de 60s. Batches maiores podem saturar o pool de conexões do Supabase e
  // causar FUNCTION_INVOCATION_TIMEOUT.
  // 1000 leads → 20 lotes × ~1.5s ≈ 30s (com margem de 2× sobre o limite).
  const BATCH_SIZE = 50;

  let successCount               = 0;
  let duplicateCount             = 0;
  let duplicateReentryCount      = 0;
  let errorCount                 = 0;
  let planLimitHit               = false;
  let responsibleAssignedCount   = 0;
  let responsibleNotFoundCount   = 0;
  let responsibleUpdateErrorCount = 0;

  const ctx = { svc, companyId, funnelId, targetStageId, funnelStageMap, validUuidFields, numericFieldMap, responsibleUserMap, existingTags };

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    if (planLimitHit) {
      errorCount += leads.length - i;
      break;
    }

    const batch = leads.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(rawLead => processOneLead(rawLead, ctx)));

    for (const r of settled) {
      if (r.status === 'rejected') { errorCount++; continue; }
      const v = r.value;
      successCount               += v.success;
      duplicateCount             += v.duplicate;
      duplicateReentryCount      += v.duplicateReentry;
      errorCount                 += v.error;
      responsibleAssignedCount   += v.responsibleAssigned;
      responsibleNotFoundCount   += v.responsibleNotFound;
      responsibleUpdateErrorCount += v.responsibleUpdateError;
      if (v.planLimitHit) planLimitHit = true;
    }
  }

  // ── 11. Log agregado em lead_import_events ────────────────────────────────
  const logStatus = (successCount === 0 && duplicateCount === 0) ? 'error' : 'success';
  try {
    await svc.rpc('log_lead_import_event', {
      p_company_id:      companyId,
      p_status:          logStatus,
      p_payload_summary: {
        source:                  'file_import',
        total:                   leads.length,
        success:                 successCount,
        duplicate:               duplicateCount,
        duplicate_reentries:     duplicateReentryCount,
        error:                   errorCount,
        responsible_assigned:    responsibleAssignedCount,
        responsible_not_found:   responsibleNotFoundCount,
        responsible_update_error: responsibleUpdateErrorCount,
      },
    });
  } catch (logErr) {
    console.error('[import-file] log_lead_import_event failed:', logErr?.message);
  }

  // ── 12. Resposta ──────────────────────────────────────────────────────────
  return res.status(200).json({
    summary: {
      total_submitted:          leads.length,
      success:                  successCount,
      duplicate:                duplicateCount,
      error:                    errorCount,
      responsible_assigned:     responsibleAssignedCount,
      responsible_not_found:    responsibleNotFoundCount,
      responsible_update_error: responsibleUpdateErrorCount,
    },
  });
}

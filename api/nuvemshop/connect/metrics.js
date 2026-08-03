// =============================================================================
// GET /api/nuvemshop/connect/metrics?company_id={uuid}
//
// Dashboard operacional da integração Nuvemshop.
// Retorna três seções: Conexão, Saúde e Métricas de Eventos + Recursos.
//
// RBAC: ALLOWED_ROLES (manager+). Dados nunca incluem tokens ou credenciais.
//
// Segurança:
//   - company_id validado contra sessão autenticada
//   - RLS garantida via service_role com validação explícita de company_id
//   - Nunca retorna: access_token, client_secret, encryption_version, payloads
//
// Critérios de health_score:
//   healthy     → ativo + sem erros nas últimas 24h + webhook nas últimas 6h
//   warning     → ativo mas último webhook > 6h atrás OU metadata_status != success
//   critical    → ativo mas eventos dead > 0 OU erro recente (< 1h) OU sem webhook em 24h
//   disconnected → status != 'active'
// =============================================================================

import { getSupabaseAdmin }      from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller,
         ALLOWED_ROLES,
         CONNECT_ROLES }         from '../../lib/nuvemshop/validateNuvemshopCaller.js';

const ADMIN_ROLES = ['super_admin', 'system_admin'];

// ── Cálculo do health_score ────────────────────────────────────────────────────

function calcHealth(conn, eventCounts) {
  if (conn.status !== 'active') return 'disconnected';

  const now          = Date.now();
  const sixHoursMs   = 6  * 60 * 60 * 1000;
  const twentyFourHMs= 24 * 60 * 60 * 1000;
  const oneHourMs    = 1  * 60 * 60 * 1000;

  const lastWebhookMs  = conn.last_webhook_at  ? now - new Date(conn.last_webhook_at).getTime()  : Infinity;
  const lastErrorMs    = conn.last_error_at     ? now - new Date(conn.last_error_at).getTime()    : Infinity;
  const deadCount      = eventCounts.dead ?? 0;

  // critical: dead letters, erro na última hora, ou sem webhook em 24h
  if (deadCount > 0)            return 'critical';
  if (lastErrorMs < oneHourMs)  return 'critical';
  if (lastWebhookMs > twentyFourHMs && conn.last_webhook_at != null) return 'critical';

  // warning: metadados não confirmados ou webhook > 6h atrás
  if (conn.metadata_status !== 'success') return 'warning';
  if (lastWebhookMs > sixHoursMs)         return 'warning';

  return 'healthy';
}

// ── Query auxiliar: contagens de eventos por status ──────────────────────────

async function getEventCounts(svc, companyId) {
  const { data, error } = await svc
    .from('nuvemshop_webhook_events')
    .select('status')
    .eq('company_id', companyId);

  if (error || !data) return { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0, skipped: 0 };

  return data.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0, skipped: 0 });
}

// ── Query auxiliar: tempo médio de processamento (últimos 7 dias) ─────────────

async function getAvgProcessingMs(svc, companyId) {
  const { data, error } = await svc.rpc('get_nuvemshop_avg_processing_ms', {
    p_company_id: companyId,
  });
  // RPC pode não existir ainda → fallback com query direta
  if (error || data == null) {
    const { data: rows } = await svc
      .from('nuvemshop_webhook_events')
      .select('created_at, processed_at')
      .eq('company_id', companyId)
      .eq('status', 'processed')
      .gte('processed_at', new Date(Date.now() - 7 * 86400_000).toISOString())
      .limit(500);

    if (!rows?.length) return null;
    const total = rows.reduce((sum, r) => {
      return sum + (new Date(r.processed_at) - new Date(r.created_at));
    }, 0);
    return Math.round(total / rows.length);
  }
  return data;
}

// ── Query auxiliar: replay count ─────────────────────────────────────────────

async function getReplayCount(svc, companyId) {
  const { count } = await svc
    .from('nuvemshop_webhook_events')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('replayed_from', 'is', null);
  return count ?? 0;
}

// ── Query auxiliar: recursos sincronizados ────────────────────────────────────

async function getResourceCounts(svc, companyId) {
  const [leadsRes, oppsRes, productsRes, catsRes, checkoutsRes] = await Promise.all([
    svc.from('leads')
       .select('*', { count: 'exact', head: true })
       .eq('company_id', companyId)
       .not('nuvemshop_customer_id', 'is', null),

    svc.from('opportunities')
       .select('*', { count: 'exact', head: true })
       .eq('company_id', companyId)
       .not('nuvemshop_order_id', 'is', null),

    svc.from('products')
       .select('*', { count: 'exact', head: true })
       .eq('company_id', companyId)
       .eq('external_source', 'nuvemshop')
       .eq('is_active', true),

    svc.from('catalog_categories')
       .select('*', { count: 'exact', head: true })
       .eq('company_id', companyId)
       .not('nuvemshop_category_id', 'is', null)
       .is('deleted_at', null),

    svc.from('leads')
       .select('*', { count: 'exact', head: true })
       .eq('company_id', companyId)
       .not('nuvemshop_checkout_id', 'is', null),
  ]);

  return {
    leads:     leadsRes.count     ?? 0,
    orders:    oppsRes.count      ?? 0,
    products:  productsRes.count  ?? 0,
    categories:catsRes.count      ?? 0,
    checkouts: checkoutsRes.count ?? 0,
  };
}

// ── Query auxiliar: status dos checkpoints ────────────────────────────────────

async function getCheckpoints(svc, companyId, storeId) {
  const { data } = await svc
    .from('nuvemshop_sync_checkpoints')
    .select('sync_type, status, total_processed, total_errors, last_activity_at, schema_version')
    .eq('company_id', companyId)
    .eq('store_id', storeId);
  return data ?? [];
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const requestId  = `req_${Date.now()}`;
  const companyId  = req.query.company_id;

  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const svc  = getSupabaseAdmin();
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  console.log(JSON.stringify({
    event: 'metrics_request', company_id: companyId,
    user_id: auth.userId, role: auth.role, request_id: requestId,
  }));

  // ── Buscar conexão ────────────────────────────────────────────────────────
  const { data: conn, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select([
      'id', 'status', 'metadata_status', 'store_name', 'store_domain',
      'plan_name', 'currency', 'country', 'script_id', 'script_status',
      'connected_at', 'disconnected_at', 'last_sync_at', 'last_webhook_at',
      'last_success_at', 'last_error_at', 'last_error_message',
      'nuvemshop_store_id',
    ].join(', '))
    .eq('company_id', companyId)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connErr) {
    console.error(JSON.stringify({ event: 'metrics_fetch_error', company_id: companyId, error: connErr.message }));
    return res.status(500).json({ error: 'Falha ao buscar dados da integração' });
  }

  if (!conn) {
    return res.status(200).json({
      connected: false,
      connection: null,
      health: { status: 'disconnected', health_score: 0 },
      events: null,
      resources: null,
      checkpoints: [],
      actions: { can_connect: CONNECT_ROLES.includes(auth.role) },
    });
  }

  // ── Buscar métricas em paralelo ───────────────────────────────────────────
  const [eventCounts, avgMs, replayCount, resources, checkpoints] = await Promise.all([
    getEventCounts(svc, companyId),
    getAvgProcessingMs(svc, companyId),
    getReplayCount(svc, companyId),
    getResourceCounts(svc, companyId),
    getCheckpoints(svc, companyId, conn.nuvemshop_store_id),
  ]);

  const healthStatus = calcHealth(conn, eventCounts);
  const isActive     = conn.status === 'active';
  const isAdmin      = ADMIN_ROLES.includes(auth.role);

  return res.status(200).json({
    connected: isActive,

    // ── Seção Conexão ─────────────────────────────────────────────────
    connection: {
      store_name:       conn.store_name      ?? null,
      store_domain:     conn.store_domain    ?? null,
      plan_name:        conn.plan_name       ?? null,
      status:           conn.status,
      script_status:    conn.script_status   ?? null,
      script_active:    !!conn.script_id && conn.script_status === 'active',
      connected_at:     conn.connected_at    ?? null,
      disconnected_at:  conn.disconnected_at ?? null,
      last_sync_at:     conn.last_sync_at    ?? null,
    },

    // ── Seção Saúde ───────────────────────────────────────────────────
    health: {
      status:              healthStatus,
      last_webhook_at:     conn.last_webhook_at  ?? null,
      last_success_at:     conn.last_success_at  ?? null,
      last_error_at:       conn.last_error_at    ?? null,
      // Exibir mensagem de erro apenas para admins (pode conter info interna)
      last_error_message:  isAdmin ? (conn.last_error_message ?? null) : null,
      metadata_status:     conn.metadata_status  ?? null,
    },

    // ── Seção Métricas de Eventos ─────────────────────────────────────
    events: {
      pending:            eventCounts.pending    ?? 0,
      processing:         eventCounts.processing ?? 0,
      processed:          eventCounts.processed  ?? 0,
      failed:             eventCounts.failed     ?? 0,
      dead:               eventCounts.dead       ?? 0,
      skipped:            eventCounts.skipped    ?? 0,
      replayed:           replayCount,
      avg_processing_ms:  avgMs,
    },

    // ── Seção Recursos Sincronizados ──────────────────────────────────
    resources,

    // ── Checkpoints de Reconciliação ──────────────────────────────────
    checkpoints: checkpoints.map(cp => ({
      sync_type:       cp.sync_type,
      status:          cp.status,
      total_processed: cp.total_processed,
      total_errors:    cp.total_errors,
      last_activity_at:cp.last_activity_at,
    })),

    // ── Ações disponíveis para o usuário ─────────────────────────────
    actions: {
      can_connect:          !isActive && CONNECT_ROLES.includes(auth.role),
      can_disconnect:       isActive  && CONNECT_ROLES.includes(auth.role),
      can_replay:           isAdmin,
      can_force_resync:     isAdmin,
      can_reset_checkpoint: isAdmin || auth.role === 'admin',
      can_validate:         ALLOWED_ROLES.includes(auth.role),
    },
  });
}

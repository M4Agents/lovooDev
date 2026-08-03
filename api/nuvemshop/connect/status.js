// =============================================================================
// GET /api/nuvemshop/connect/status?company_id={uuid}
//
// Retorna o estado público e seguro da integração Nuvemshop.
//
// Dados retornados (seguros para o frontend):
//   connected, status, store_name, store_domain, currency, country,
//   plan_name, connected_at, last_sync_at, last_webhook_at,
//   last_success_at, last_error_at, health_status, actions
//
// NUNCA retornado:
//   access_token, access_token_enc, client_secret, encryption_version,
//   webhook_ids (interno), mensagens de erro internas
//
// Health Status:
//   healthy     → ativo + sem erros recentes + sincronização em dia
//   warning     → ativo mas com sinais de degradação
//   critical    → ativo mas com erros, dead letters ou ausência prolongada
//   disconnected → status != 'active'
//
// Segurança:
//   - company_id validado contra sessão autenticada (nunca apenas do query)
//   - RBAC aplicado: ALLOWED_ROLES (manager+)
//   - Dados de outras empresas nunca retornados
// =============================================================================

import { getSupabaseAdmin }          from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller,
         ALLOWED_ROLES,
         CONNECT_ROLES }             from '../../lib/nuvemshop/validateNuvemshopCaller.js';

/**
 * Calcula o health_status da conexão com base nos sinais disponíveis.
 *
 * Fase atual (sem webhooks ativos): usa apenas connection status + metadata_status.
 * Após Fase 4 (webhooks), expandir para incluir last_webhook_at, last_sync_at.
 *
 * @param {{ status, metadata_status, last_error_at }} conn
 * @returns {'healthy'|'warning'|'critical'|'disconnected'}
 */
function calcHealthStatus(conn) {
  if (conn.status !== 'active') return 'disconnected';

  // metadata_status: resultado do GET /store no momento da conexão
  if (conn.metadata_status === 'failed') return 'critical';
  if (conn.metadata_status === 'pending' || conn.metadata_status == null) return 'warning';
  if (conn.metadata_status === 'success') return 'healthy';

  return 'healthy';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.company_id;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── Validar JWT + RBAC ─────────────────────────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Buscar conexão (apenas campos públicos — sem token) ───────────────────
         const { data: connection, error: fetchErr } = await svc
           .from('nuvemshop_connections')
           .select([
             'id',
             'status',
             'metadata_status',
             'store_name',
             'store_domain',
             'currency',
             'country',
             'plan_name',
             'connected_at',
             'disconnected_at',
             'last_sync_at',
             'last_webhook_at',
             'last_success_at',
             'last_error_at',
             // NUNCA selecionar: access_token_enc, encryption_version, oauth_nonce, webhook_ids
           ].join(', '))
    .eq('company_id', companyId)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    console.error('[nuvemshop/status] fetch_failed companyId=%s err=%s',
      companyId, fetchErr.message);
    return res.status(500).json({ error: 'Falha ao buscar status da integração' });
  }

  // ── Empresa nunca conectou ────────────────────────────────────────────────
  if (!connection) {
    return res.status(200).json({
      connected:     false,
      status:        null,
      health_status: 'disconnected',
      actions: {
        can_connect:    CONNECT_ROLES.includes(auth.role),
        can_disconnect: false,
        can_sync:       false,
        can_replay:     false,
      },
    });
  }

  const healthStatus = calcHealthStatus(connection);
  const isActive     = connection.status === 'active';

         return res.status(200).json({
           connected:       isActive,
           status:          connection.status,
           metadata_status: connection.metadata_status ?? null,
           store_name:      connection.store_name     ?? null,
           store_domain:    connection.store_domain   ?? null,
           currency:        connection.currency       ?? null,
           country:         connection.country        ?? null,
           plan_name:       connection.plan_name      ?? null,
           connected_at:    connection.connected_at   ?? null,
           disconnected_at: connection.disconnected_at ?? null,
           last_sync_at:    connection.last_sync_at   ?? null,
           last_webhook_at: connection.last_webhook_at ?? null,
           last_success_at: connection.last_success_at ?? null,
           last_error_at:   connection.last_error_at  ?? null,
           health_status:   healthStatus,
    actions: {
      can_connect:    !isActive && CONNECT_ROLES.includes(auth.role),
      can_disconnect: isActive  && CONNECT_ROLES.includes(auth.role),
      can_sync:       isActive,
      can_replay:     ['super_admin', 'system_admin'].includes(auth.role),
    },
  });
}

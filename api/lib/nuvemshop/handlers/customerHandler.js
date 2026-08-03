// =============================================================================
// customerHandler — Handler de eventos customer/* da Nuvemshop
//
// Responsabilidades (Plano v5.1):
//   1. Validar parâmetros do contexto
//   2. Obter conexão ativa e descriptografar token
//   3. Buscar dados completos do cliente via API Nuvemshop
//   4. Delegar toda a lógica de escrita ao customerSync (Sync Service)
//   5. Retornar { ok: true } ou lançar Error (worker trata retry/dead)
//
// O handler NÃO:
//   - controla lock ou heartbeat
//   - faz claim de eventos
//   - acessa diretamente a tabela leads
//   - implementa retry próprio
//   - cria pedidos, oportunidades ou carrinhos
//
// Topics suportados:
//   customer/created, customer/updated
//
// Não suportado nesta fase: customer/deleted
//   → Clientes deletados na Nuvemshop NÃO resultam em exclusão de leads no CRM.
//   → Leads possuem histórico comercial que deve ser preservado.
//   → Caso necessário no futuro: marcar nuvemshop_sync_status = 'deleted'
//     sem alterar o status comercial do lead.
// =============================================================================

import { getSupabaseAdmin }     from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken } from '../tokenCrypto.js';
import { createNuvemshopClient } from '../nuvemshopClient.js';
import { upsertCustomer }       from '../sync/customerSync.js';

/**
 * @param {{
 *   companyId:     string,
 *   storeId:       string,
 *   topic:         string,
 *   payload:       object,
 *   correlationId: string,
 *   workerId:      string,
 * }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function customerHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // ── Validação de parâmetros ─────────────────────────────────────────────────
  const nuvemshopCustomerId = String(payload?.id ?? '');
  if (!nuvemshopCustomerId || nuvemshopCustomerId === 'undefined') {
    throw new Error('[customerHandler] customer ID ausente no payload');
  }

  if (!companyId || !storeId) {
    throw new Error('[customerHandler] companyId e storeId são obrigatórios');
  }

  const svc = getSupabaseAdmin();

  // ── Obter conexão ativa ─────────────────────────────────────────────────────
  const { data: connection, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select('id, access_token_enc, encryption_version')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr) {
    throw new Error(`[customerHandler] Erro ao buscar conexão: ${connErr.message}`);
  }

  if (!connection) {
    // Conexão desconectada após o enqueue — skip silencioso e idempotente
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'customer_connection_not_active',
      company_id:     companyId,
      store_id:       storeId,
      topic,
      customer_id:    nuvemshopCustomerId,
      correlation_id: correlationId,
    }));
    return { ok: true };
  }

  // ── Descriptografar token ───────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptNuvemshopToken(connection.access_token_enc);
  } catch (err) {
    throw new Error(`[customerHandler] Falha ao descriptografar token: ${err.message}`);
  }

  // ── Buscar dados completos do cliente via API Nuvemshop ─────────────────────
  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  let customerData;
  try {
    customerData = await client.get(`customers/${nuvemshopCustomerId}`);
  } catch (err) {
    // 404: cliente pode ter sido deletado entre o enqueue e o processamento
    if (err?.status === 404) {
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'customer_not_found_in_api',
        company_id:     companyId,
        store_id:       storeId,
        customer_id:    nuvemshopCustomerId,
        topic,
        correlation_id: correlationId,
        resolution:     'skip_no_delete_leads_preserve_history',
      }));
      // Clientes deletados não resultam em deleção de leads
      return { ok: true };
    }
    throw new Error(`[customerHandler] Falha ao buscar cliente ${nuvemshopCustomerId}: ${err.message}`);
  }

  if (!customerData) {
    throw new Error(`[customerHandler] Resposta vazia para cliente ${nuvemshopCustomerId}`);
  }

  // ── Upsert via Sync Service ─────────────────────────────────────────────────
  const syncResult = await upsertCustomer({
    companyId,
    storeId,
    customerData,
    svc,
  });

  console.log(JSON.stringify({
    level:          'info',
    event:          'customer_synced',
    topic,
    company_id:     companyId,
    store_id:       storeId,
    nuvemshop_customer_id: nuvemshopCustomerId,
    lead_id:        syncResult.leadId,
    action:         syncResult.action,
    matched_by:     syncResult.matchedBy,
    correlation_id: correlationId,
  }));

  return { ok: true };
}

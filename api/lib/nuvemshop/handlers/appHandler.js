// =============================================================================
// appHandler — Eventos de ciclo de vida do App Nuvemshop
//
//   app/uninstalled → desinstalar app = desconectar integração automaticamente
//
// Fluxo (Fase 12):
//   1. Buscar connection ativa para recuperar access_token
//   2. Tentar remover script de rastreamento via Scripts API (best-effort)
//   3. Marcar conexão como 'disconnected'
//
// A desconexão ocorre INDEPENDENTE do resultado da remoção do script.
// Dados sincronizados (leads, produtos, oportunidades) são preservados.
// Apenas o status da conexão é alterado — nenhum dado de negócio é removido.
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import { decryptToken }     from '../tokenCrypto.js';
import { deleteScript }     from '../scriptSync.js';

/**
 * @param {{ companyId: string, storeId: string, topic: string, payload: object, correlationId: string, workerId: string }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function appHandler(ctx) {
  const { companyId, storeId, topic, correlationId } = ctx;

  if (topic !== 'app/uninstalled') {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'app_handler_unsupported_topic',
      topic,
      company_id:     companyId,
      correlation_id: correlationId,
    }));
    return { ok: true, skipped: true };
  }

  const svc = getSupabaseAdmin();

  // ── 1. Buscar conexão ativa para recuperar access_token ───────────────────
  const { data: conn } = await svc
    .from('nuvemshop_connections')
    .select('id, encrypted_access_token, script_id')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  // ── 2. Remover script de rastreamento (best-effort) ───────────────────────
  // A desconexão prossegue independente do resultado.
  if (conn?.encrypted_access_token && conn?.script_id) {
    try {
      const accessToken = decryptToken(conn.encrypted_access_token);
      await deleteScript({ companyId, storeId, accessToken, correlationId, svc });
    } catch (err) {
      // Erros inesperados de deleteScript não bloqueam a desconexão
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'app_uninstalled_script_delete_unexpected_error',
        company_id:     companyId,
        store_id:       storeId,
        error:          err.message,
        resolution:     'proceed_with_disconnect',
        correlation_id: correlationId,
      }));
    }
  }

  // ── 3. Marcar conexão como desconectada ───────────────────────────────────
  const now = new Date().toISOString();
  const { error: disconnectErr } = await svc
    .from('nuvemshop_connections')
    .update({
      status:          'disconnected',
      status_reason:   'app_uninstalled',
      disconnected_at: now,
      updated_at:      now,
    })
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active');

  if (disconnectErr) {
    console.error(JSON.stringify({
      level:          'error',
      event:          'app_uninstalled_disconnect_failed',
      company_id:     companyId,
      store_id:       storeId,
      error:          disconnectErr.message,
      correlation_id: correlationId,
    }));
    throw new Error(`[appHandler] Falha ao processar app/uninstalled: ${disconnectErr.message}`);
  }

  console.info(JSON.stringify({
    level:          'info',
    event:          'app_uninstalled',
    company_id:     companyId,
    store_id:       storeId,
    correlation_id: correlationId,
  }));

  return { ok: true };
}

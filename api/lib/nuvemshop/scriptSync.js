// =============================================================================
// scriptSync — Gerenciamento do Script de Rastreamento Nuvemshop
//
// Responsabilidade: criar e remover o script de rastreamento via Scripts API.
//
// ── Scripts API da Nuvemshop ─────────────────────────────────────────────────
// GET    /{store_id}/scripts/{id}  → verificar se script ainda existe
// POST   /{store_id}/scripts       → registra um script no storefront
// DELETE /{store_id}/scripts/{id}  → remove o script do storefront
//
// O script é injetado em todas as páginas da loja (where: 'all', event: 'onload').
// A URL do script é configurada via variável de ambiente NUVEMSHOP_TRACKING_SCRIPT_URL.
//
// ── Ciclo de vida (desacoplado do callback OAuth) ────────────────────────────
//   Conexão (callback OAuth):
//     → script_status = 'pending' (apenas marcação, sem chamada de API)
//
//   Instalação (cron nuvemshop-install-scripts):
//     createScript → verifica orphan → POST /scripts → script_status = 'active'
//
//   Desconexão (app/uninstalled ou manual):
//     deleteScript → DELETE /scripts/{id} → limpa script_id, script_status = 'deleted'
//     A desconexão ocorre INDEPENDENTE do resultado da remoção do script.
//
// ── Prevenção de scripts órfãos ───────────────────────────────────────────────
// Antes de criar um novo script, createScript verifica se já existe um script_id
// na conexão. Se existir:
//   - GET /scripts/{id} → 200: script ainda ativo → atualizar status, skip criação
//   - GET /scripts/{id} → 404: script não existe mais → prosseguir com criação
// Isso evita scripts duplicados em reconexões.
//
// ── Tratamento de falhas ──────────────────────────────────────────────────────
// createScript:
//   - Falha NÃO cancela a conexão OAuth (integração mantida, script_status = 'failed')
//   - Configuração ausente → script_status = 'config_error'
//
// deleteScript:
//   - Falha NÃO bloqueia a desconexão (script_status = 'delete_failed')
//   - Script já inexistente (404) → tratado como deleção bem-sucedida
//
// ── Segurança ────────────────────────────────────────────────────────────────
// - company_id obrigatório em toda operação de banco
// - store_id obrigatório para escopo da Scripts API
// - Backend é o único responsável pelas chamadas à Scripts API
// - Nenhuma chamada direta do frontend é permitida
// =============================================================================

import { getSupabaseAdmin }       from '../automation/supabaseAdmin.js';
import { createNuvemshopClient }  from './nuvemshopClient.js';

const SCRIPT_EVENT = 'onload';
const SCRIPT_WHERE = 'all';     // Injetar em todas as páginas da loja

// ── Helpers de banco ──────────────────────────────────────────────────────────

async function updateScriptFields({ svc, companyId, storeId, scriptId, scriptStatus }) {
  const row = { script_status: scriptStatus, updated_at: new Date().toISOString() };
  if (scriptId !== undefined) row.script_id = scriptId;  // null para limpar

  const { error } = await svc
    .from('nuvemshop_connections')
    .update(row)
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId);

  if (error) {
    console.warn(JSON.stringify({
      level:         'warn',
      event:         'script_status_update_failed',
      company_id:    companyId,
      store_id:      storeId,
      script_status: scriptStatus,
      error:         error.message,
    }));
  }
}

async function getScriptId({ svc, companyId, storeId }) {
  const { data, error } = await svc
    .from('nuvemshop_connections')
    .select('script_id')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .maybeSingle();

  if (error) throw new Error(`[scriptSync] script_id_lookup_failed: ${error.message}`);
  return data?.script_id ?? null;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Registra o script de rastreamento na loja via Scripts API.
 *
 * Nunca lança exceção — falhas são registradas em script_status.
 * A conexão OAuth permanece ativa independente do resultado.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   accessToken:  string,
 *   correlationId?: string,
 *   svc?:         object
 * }} params
 */
export async function createScript({ companyId, storeId, accessToken, correlationId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();

  const scriptSrc = process.env.NUVEMSHOP_TRACKING_SCRIPT_URL;
  if (!scriptSrc) {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'script_create_skipped_no_url',
      company_id:     companyId,
      store_id:       storeId,
      resolution:     'configure_NUVEMSHOP_TRACKING_SCRIPT_URL',
      correlation_id: correlationId,
    }));
    await updateScriptFields({ svc, companyId, storeId, scriptStatus: 'config_error' });
    return { ok: false, reason: 'config_error' };
  }

  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  // ── Prevenção de scripts órfãos ─────────────────────────────────────────────
  // Verifica se já existe um script_id na conexão antes de criar um novo.
  // Em reconexões, o script anterior pode ainda estar ativo na loja.
  const existingScriptId = await getScriptId({ svc, companyId, storeId });

  if (existingScriptId) {
    try {
      await client.get(`scripts/${existingScriptId}`);

      // Script ainda existe na loja — reutilizar, sem criar um novo
      await updateScriptFields({ svc, companyId, storeId, scriptStatus: 'active' });
      console.info(JSON.stringify({
        level:          'info',
        event:          'script_already_active_reused',
        company_id:     companyId,
        store_id:       storeId,
        script_id:      existingScriptId,
        correlation_id: correlationId,
      }));
      return { ok: true, scriptId: existingScriptId, reused: true };

    } catch (err) {
      if (err?.status === 404) {
        // Script não existe mais na loja → limpar e criar novo
        console.info(JSON.stringify({
          level:          'info',
          event:          'script_orphan_detected_creating_new',
          company_id:     companyId,
          store_id:       storeId,
          old_script_id:  existingScriptId,
          correlation_id: correlationId,
        }));
        // Limpa o orphan antes de criar novo
        await updateScriptFields({ svc, companyId, storeId, scriptId: null, scriptStatus: null });
      } else {
        // Erro de rede ao verificar → não criar para evitar duplicata
        console.warn(JSON.stringify({
          level:          'warn',
          event:          'script_verify_failed_skipping_creation',
          company_id:     companyId,
          store_id:       storeId,
          error:          err.message,
          resolution:     'retry_on_next_cron_run',
          correlation_id: correlationId,
        }));
        await updateScriptFields({ svc, companyId, storeId, scriptStatus: 'failed' });
        return { ok: false, reason: 'verify_error' };
      }
    }
  }

  // ── Criar novo script ────────────────────────────────────────────────────────
  try {
    const response = await client.post('scripts', {
      src:   scriptSrc,
      event: SCRIPT_EVENT,
      where: SCRIPT_WHERE,
    });

    const scriptId = String(response?.id ?? '');
    if (!scriptId) throw new Error('Scripts API retornou resposta sem id');

    await updateScriptFields({ svc, companyId, storeId, scriptId, scriptStatus: 'active' });

    console.info(JSON.stringify({
      level:          'info',
      event:          'script_created',
      company_id:     companyId,
      store_id:       storeId,
      script_id:      scriptId,
      correlation_id: correlationId,
    }));

    return { ok: true, scriptId };

  } catch (err) {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'script_create_failed',
      company_id:     companyId,
      store_id:       storeId,
      error:          err.message,
      resolution:     'script_status_set_to_failed_connection_kept',
      correlation_id: correlationId,
    }));
    await updateScriptFields({ svc, companyId, storeId, scriptStatus: 'failed' });
    return { ok: false, reason: 'api_error', error: err.message };
  }
}

/**
 * Remove o script de rastreamento da loja via Scripts API.
 *
 * Nunca lança exceção — falhas são registradas em script_status.
 * A desconexão da integração ocorre independente do resultado.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   accessToken:  string,
 *   correlationId?: string,
 *   svc?:         object
 * }} params
 */
export async function deleteScript({ companyId, storeId, accessToken, correlationId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();

  // Buscar script_id atual
  let scriptId;
  try {
    scriptId = await getScriptId({ svc, companyId, storeId });
  } catch (err) {
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'script_delete_id_lookup_failed',
      company_id:     companyId,
      store_id:       storeId,
      error:          err.message,
      resolution:     'skip_delete_proceed_with_disconnect',
      correlation_id: correlationId,
    }));
    return { ok: false, reason: 'lookup_error' };
  }

  if (!scriptId) {
    console.info(JSON.stringify({
      level:          'info',
      event:          'script_delete_skipped_no_script_id',
      company_id:     companyId,
      store_id:       storeId,
      correlation_id: correlationId,
    }));
    return { ok: true, reason: 'no_script_registered' };
  }

  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  try {
    await client.delete(`scripts/${scriptId}`);

    // Limpa script_id e atualiza status
    await updateScriptFields({ svc, companyId, storeId, scriptId: null, scriptStatus: 'deleted' });

    console.info(JSON.stringify({
      level:          'info',
      event:          'script_deleted',
      company_id:     companyId,
      store_id:       storeId,
      script_id:      scriptId,
      correlation_id: correlationId,
    }));

    return { ok: true };

  } catch (err) {
    // 404: script já não existe na loja (removido manualmente ou expirado)
    if (err?.status === 404) {
      console.info(JSON.stringify({
        level:          'info',
        event:          'script_delete_not_found',
        company_id:     companyId,
        store_id:       storeId,
        script_id:      scriptId,
        resolution:     'treated_as_success_script_already_gone',
        correlation_id: correlationId,
      }));
      await updateScriptFields({ svc, companyId, storeId, scriptId: null, scriptStatus: 'deleted' });
      return { ok: true, reason: 'already_deleted' };
    }

    // Outras falhas: logar, marcar delete_failed, mas NÃO bloquear desconexão
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'script_delete_failed',
      company_id:     companyId,
      store_id:       storeId,
      script_id:      scriptId,
      error:          err.message,
      resolution:     'script_status_set_to_delete_failed_disconnect_proceeds',
      correlation_id: correlationId,
    }));
    await updateScriptFields({ svc, companyId, storeId, scriptStatus: 'delete_failed' });
    return { ok: false, reason: 'api_error', error: err.message };
  }
}

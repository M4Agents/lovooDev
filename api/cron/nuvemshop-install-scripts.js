// =============================================================================
// Cron: nuvemshop-install-scripts
//
// Instala o script de rastreamento em conexões com script_status = 'pending'
// ou = 'failed' (retry automático de falhas anteriores com backoff exponencial).
//
// Desacoplado do callback OAuth: o callback apenas marca script_status = 'pending'.
// Este worker processa de forma assíncrona, sem impactar o fluxo de conexão.
//
// ── Atomicidade ──────────────────────────────────────────────────────────────
// O claim é feito via RPC claim_nuvemshop_pending_scripts (FOR UPDATE SKIP LOCKED).
// Isso garante que dois workers paralelos jamais processem a mesma conexão.
// O RPC define script_next_retry_at = now()+10min como claim lock imediato.
//
// ── Retry controlado com backoff exponencial ─────────────────────────────────
// Tentativa 1 → espera  2 min antes do retry
// Tentativa 2 → espera  5 min
// Tentativa 3 → espera 15 min
// Tentativa 4 → espera 60 min
// Tentativa 5 → limite atingido: script_status permanece 'failed' indefinidamente
//               (requer intervenção manual ou reconexão OAuth)
//
// ── Processo por conexão ─────────────────────────────────────────────────────
//   1. Claim atômico via RPC (inclui descriptografia de token)
//   2. Descriptografar access_token
//   3. Chamar scriptSync.createScript (prevenção de orphan integrada)
//   4. Atualizar script_status + retry fields no banco
//
// Execução: a cada 10 minutos via Vercel Cron (vercel.json)
// Máximo por run: MAX_BATCH para limitar consumo de API
// =============================================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';
import { decryptNuvemshopToken }     from '../lib/nuvemshop/tokenCrypto.js';
import { createScript }     from '../lib/nuvemshop/scriptSync.js';

const MAX_BATCH       = 10;  // Máx. scripts instalados por execução
const MAX_RETRIES     = 5;   // Tentativas máximas antes de desistir

// Delays de backoff em minutos para cada tentativa (índice = retry_count após falha)
const BACKOFF_MINUTES = [2, 5, 15, 60, 0];  // índice 4 = limite atingido (não recalcula)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula next_retry_at com base na contagem de retries.
 * Retorna null quando o limite foi atingido (indicando que o script não será retentado).
 */
function calcNextRetryAt(retryCount) {
  const delayMinutes = BACKOFF_MINUTES[retryCount] ?? 0;
  if (delayMinutes === 0) return null;
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

/**
 * Atualiza o script_status de uma conexão após processamento.
 * Em sucesso: reseta retry_count e limpa next_retry_at.
 * Em falha:   incrementa retry_count e aplica backoff.
 */
async function updateScriptStatus({
  svc, connectionId, outcome, currentRetryCount,
}) {
  const now = new Date().toISOString();

  if (outcome === 'success') {
    await svc
      .from('nuvemshop_connections')
      .update({
        script_status:       'active',
        script_retry_count:  0,
        script_next_retry_at: null,
        updated_at:          now,
      })
      .eq('id', connectionId);
    return;
  }

  if (outcome === 'config_error') {
    // config_error: não adianta tentar — aguarda intervenção manual
    await svc
      .from('nuvemshop_connections')
      .update({
        script_status:       'config_error',
        script_retry_count:  currentRetryCount + 1,
        script_next_retry_at: null,
        updated_at:          now,
      })
      .eq('id', connectionId);
    return;
  }

  // Falha genérica: aplicar backoff ou desistir
  const newRetryCount = currentRetryCount + 1;
  const hasExhausted  = newRetryCount >= MAX_RETRIES;
  const nextRetryAt   = hasExhausted ? null : calcNextRetryAt(newRetryCount);

  await svc
    .from('nuvemshop_connections')
    .update({
      script_status:        hasExhausted ? 'failed' : 'failed',
      script_retry_count:   newRetryCount,
      script_next_retry_at: nextRetryAt,
      updated_at:           now,
    })
    .eq('id', connectionId);
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workerId = `install-scripts-${Date.now()}`;
  const svc      = getSupabaseAdmin();

  // ── 1. Claim atômico via RPC (FOR UPDATE SKIP LOCKED) ────────────────────
  const { data: claimed, error: claimErr } = await svc.rpc(
    'claim_nuvemshop_pending_scripts',
    { p_batch_size: MAX_BATCH },
  );

  if (claimErr) {
    console.error(JSON.stringify({
      level:     'error',
      event:     'install_scripts_claim_failed',
      worker_id: workerId,
      error:     claimErr.message,
    }));
    return res.status(500).json({ error: 'Falha ao reivindicar conexões pendentes' });
  }

  if (!claimed?.length) {
    console.info(JSON.stringify({
      level:     'info',
      event:     'install_scripts_no_pending',
      worker_id: workerId,
    }));
    return res.status(200).json({ processed: 0 });
  }

  const results = { success: 0, failed: 0, config_error: 0, skipped: 0, exhausted: 0 };

  // ── 2. Processar cada conexão reivindicada ────────────────────────────────
  for (const conn of claimed) {
    const {
      connection_id: connectionId,
      company_id:    companyId,
      nuvemshop_store_id: storeId,
      access_token_enc,
      script_retry_count: retryCount,
    } = conn;

    const correlationId = `${workerId}-${companyId}`;

    // ── 2a. Verificar se já atingiu o limite máximo de retries ────────────
    if (retryCount >= MAX_RETRIES) {
      console.warn(JSON.stringify({
        level:           'warn',
        event:           'install_scripts_exhausted',
        worker_id:       workerId,
        company_id:      companyId,
        store_id:        storeId,
        script_retry_count: retryCount,
        correlation_id:  correlationId,
      }));
      // Limpar o claim lock sem incrementar retry (já exausto)
      await svc
        .from('nuvemshop_connections')
        .update({ script_next_retry_at: null, updated_at: new Date().toISOString() })
        .eq('id', connectionId);
      results.exhausted++;
      continue;
    }

    // ── 2b. Descriptografar token ─────────────────────────────────────────
    let accessToken;
    try {
      accessToken = decryptNuvemshopToken(access_token_enc);
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c830cd'},body:JSON.stringify({sessionId:'c830cd',runId:'script-debug',hypothesisId:'H1',location:'nuvemshop-install-scripts.js:decrypt',message:'token decrypt SUCCESS',data:{company_id:companyId,store_id:storeId,tokenLength:accessToken?.length??0,enc_defined:!!access_token_enc},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c830cd'},body:JSON.stringify({sessionId:'c830cd',runId:'script-debug',hypothesisId:'H1',location:'nuvemshop-install-scripts.js:decrypt-fail',message:'token decrypt FAILED -> config_error',data:{company_id:companyId,store_id:storeId,error:err?.message,enc_defined:!!access_token_enc},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'install_scripts_token_decrypt_failed',
        worker_id:      workerId,
        company_id:     companyId,
        store_id:       storeId,
        error:          err.message,
        correlation_id: correlationId,
      }));
      // Token corrompido = erro de configuração, não deve tentar
      await updateScriptStatus({ svc, connectionId, outcome: 'config_error', currentRetryCount: retryCount });
      results.config_error++;
      continue;
    }

    // ── 2c. Instalar script (scriptSync gerencia orphan check internamente) ──
    let result;
    try {
      result = await createScript({
        companyId,
        storeId,
        accessToken,
        correlationId,
        svc,
      });
    } catch (err) {
      // Erro inesperado no próprio createScript (não deveria acontecer — já trata internamente)
      console.error(JSON.stringify({
        level:          'error',
        event:          'install_scripts_unexpected_error',
        worker_id:      workerId,
        company_id:     companyId,
        store_id:       storeId,
        error:          err?.message ?? String(err),
        correlation_id: correlationId,
      }));
      await updateScriptStatus({ svc, connectionId, outcome: 'failed', currentRetryCount: retryCount });
      results.failed++;
      continue;
    }

    // ── 2d. Atualizar status com base no resultado ────────────────────────
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c830cd'},body:JSON.stringify({sessionId:'c830cd',runId:'script-debug',hypothesisId:'H2',location:'nuvemshop-install-scripts.js:result',message:'createScript result',data:{company_id:companyId,store_id:storeId,ok:result?.ok,reason:result?.reason,error:result?.error},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (result.ok) {
      await updateScriptStatus({ svc, connectionId, outcome: 'success', currentRetryCount: retryCount });
      results.success++;
    } else if (result.reason === 'config_error') {
      await updateScriptStatus({ svc, connectionId, outcome: 'config_error', currentRetryCount: retryCount });
      results.config_error++;
    } else {
      await updateScriptStatus({ svc, connectionId, outcome: 'failed', currentRetryCount: retryCount });
      results.failed++;
    }

    console.info(JSON.stringify({
      level:             'info',
      event:             'install_scripts_item_processed',
      worker_id:         workerId,
      company_id:        companyId,
      store_id:          storeId,
      outcome:           result.ok ? 'success' : (result.reason ?? 'failed'),
      script_retry_count: retryCount,
      reused:            result.reused ?? false,
      correlation_id:    correlationId,
    }));
  }

  console.info(JSON.stringify({
    level:     'info',
    event:     'install_scripts_run_complete',
    worker_id: workerId,
    processed: claimed.length,
    ...results,
  }));

  return res.status(200).json({ processed: claimed.length, ...results });
}

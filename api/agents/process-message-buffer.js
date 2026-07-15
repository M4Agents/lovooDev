// =============================================================================
// api/agents/process-message-buffer.js
//
// GET /api/agents/process-message-buffer
//
// Endpoint interno de processamento do buffer de mensagens agrupadas.
// Método GET adotado para compatibilidade com Vercel Cron Jobs, que invocam
// o path configurado via GET e enviam Authorization: Bearer <CRON_SECRET>.
//
// RESPONSABILIDADE:
//   Coordenar recovery de execuções/lotes presos, claim atômico de lotes
//   elegíveis e execução do pipeline agrupado com concorrência limitada.
//
// FLUXO:
//   1. Validar método HTTP (GET only → 405 com Allow: GET)
//   2. Autenticar via CRON_SECRET (env ausente → 500, header inválido → 401)
//   3. Criar cliente service_role (ausente → 500)
//   4. Recovery 1: recoverStaleBatchExecutions (falha → 500, abort)
//   5. Recovery 2: recoverStaleBatches          (falha → 500, abort)
//   6. Claim: claimDueBatches(limit)            (falha → 500, abort)
//   7. Processar com concorrência limitada (mapWithConcurrency)
//   8. Agregar resultados e retornar resumo seguro
//
// MÉTODO HTTP:
//   GET — compatível com Vercel Cron Jobs.
//   Qualquer outro método → 405 + header Allow: GET.
//   Não aceitar query string ou body para controlar limit, segredo ou empresa.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <CRON_SECRET>
//   Padrão idêntico ao de api/cron/refresh-instagram-tokens.js.
//   Segredo ausente no ambiente → 500 (fail-closed, não 401).
//   Header ausente ou inválido → 401.
//   Comparação por igualdade de string (mesma convenção do projeto).
//   NUNCA aceitar segredo em query string ou body.
//
// HEADER VERCEL (x-vercel-cron-schedule):
//   Enviado automaticamente pelo Vercel Cron.
//   Usado APENAS para observabilidade — nunca como autenticação ou controle.
//   Registrado em log somente se presente, sanitizado e limitado a 50 chars.
//   Chamadas manuais autenticadas (sem esse header) continuam funcionando.
//
// SOBREPOSIÇÃO (INVOCAÇÕES SIMULTÂNEAS):
//   A Vercel pode invocar uma nova execução enquanto a anterior ainda está ativa.
//   Segurança garantida por camadas já existentes:
//     - claimDueBatches usa FOR UPDATE SKIP LOCKED → lotes distintos por invocação
//     - processClaimedBatch é idempotente por batch_id (agent_batch_executions)
//     - conversation lock impede execução paralela na mesma conversa
//     - claim token + reconciliação outbound evitam re-envio
//   Não existe lock global deste endpoint — não é necessário.
//   Não existe estado global mutável compartilhado entre invocações.
//
// SUPABASE:
//   service_role exclusivo. Nunca aceitar cliente vindo da request.
//   Reutiliza getServiceSupabase() — VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// RECOVERY E CLAIM — ORDEM EXPLÍCITA:
//   1. recoverStaleBatchExecutions — invalida execuções em processing expiradas
//   2. recoverStaleBatches          — devolve lotes presos para retry/failed
//   3. claimDueBatches              — reivindica lotes elegíveis para esta execução
//   Não assumir que um nível corrige o outro automaticamente.
//   Falha em qualquer recovery ou claim → abort com 500.
//
// LIMITES (V1):
//   Claim default: 20, máximo: 100
//   Concorrência default: 3, máximo: 5
//   MESSAGE_BUFFER_CLAIM_LIMIT: validação estrita; fallback=20 se inválido.
//   Concorrência fixa em 3 para V1 (sem variável de ambiente).
//
// TIMEOUT E FALHA DO CRON:
//   Com claim=20 e concorrência=3, estimativa: ~7 rodadas × ~5s = ~35s.
//   Cabe dentro do budget Vercel de 60s (quando vercel.json for configurado).
//   Lotes claimed mas não iniciados por timeout permanecem em processing
//   e são recuperados na próxima invocação por recoverStaleBatches.
//   A Vercel NÃO faz retry automático de invocação cron que falha.
//   Uma chamada perdida é compensada pela próxima (reconciliation-based).
//   Nenhuma lógica pode depender de "exatamente uma vez por minuto".
//
// PIPELINE:
//   processClaimedBatch({ svc, batch, dependencies: { executeAgent } })
//   executeAgent = executeGroupedAgentInternal — nunca chama fetch, LLM ou gateway.
//
// FALHA INDIVIDUAL:
//   Capturada no handler do lote; outros lotes continuam.
//   Lote com falha antes de qualquer transição permanece em processing
//   e será recuperado por recoverStaleBatches na próxima chamada.
//
// IDEMPOTÊNCIA:
//   Segurança depende de: claim com FOR UPDATE SKIP LOCKED, execução com
//   unicidade por batch (agent_batch_executions), lock por conversa, claim token
//   e reconciliação outbound. Sem lock global deste endpoint.
//
// LOGS PERMITIDOS:
//   operation, batch_id, company_id, conversation_id, status, attempts,
//   claimed, processed, failed, duration_ms, error_code, recovered_executions,
//   recovered_batches, claim_limit, cron_schedule (sanitizado, max 50 chars).
//   PROIBIDO: mensagens, payload, prompt, resposta LLM, claimToken,
//   lockedAt, Authorization, CRON_SECRET, dados pessoais.
//
// TESTABILIDADE:
//   processMessageBuffer(req, res, _deps) — todas as dependências são injetáveis.
//   export default handler(req, res) — usa dependências reais.
//
// ROLLBACK:
//   Remover este arquivo e o arquivo de testes.
//   Nenhuma alteração de banco, configuração ou vercel.json.
// =============================================================================

import { createClient }                  from '@supabase/supabase-js';
import { recoverStaleBatchExecutions }   from '../lib/agents/batchExecutionService.js';
import {
  recoverStaleBatches,
  claimDueBatches,
}                                        from '../lib/agents/messageBufferService.js';
import { processClaimedBatch }           from '../lib/agents/batchExecutionPipeline.js';
import { executeGroupedAgentInternal }   from '../lib/agents/groupedAgentAdapter.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_CLAIM_LIMIT = 20;
const MAX_CLAIM_LIMIT     = 100;
const DEFAULT_CONCURRENCY = 3;   // fixo em V1
const MAX_CONCURRENCY     = 5;

// ── Helpers de autenticação ───────────────────────────────────────────────────

/**
 * Valida autenticação via CRON_SECRET.
 *
 * @param {object} req
 * @returns {{ ok: boolean, reason: 'env_missing'|'unauthorized'|null }}
 */
function validateAuth(req) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return { ok: false, reason: 'env_missing' };

  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${secret}`) return { ok: false, reason: 'unauthorized' };

  return { ok: true, reason: null };
}

// ── Helper do cliente Supabase ────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url.trim() || !key.trim()) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Helper de limite de claim ─────────────────────────────────────────────────

/**
 * Resolve o limite de claim a partir da variável de ambiente.
 * Validação estrita: inteiro entre 1 e MAX_CLAIM_LIMIT.
 * Fallback=DEFAULT_CLAIM_LIMIT para valores ausentes ou inválidos.
 *
 * @returns {number}
 */
function resolveClaimLimit() {
  const raw = process.env.MESSAGE_BUFFER_CLAIM_LIMIT;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_CLAIM_LIMIT;

  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CLAIM_LIMIT) {
    console.warn('🤖 [BUFFER-PROC] ⚠️  MESSAGE_BUFFER_CLAIM_LIMIT inválido — usando fallback:', {
      configured: typeof raw,  // não logar o valor (pode ser sensível)
      fallback:   DEFAULT_CLAIM_LIMIT,
    });
    return DEFAULT_CLAIM_LIMIT;
  }

  return n;
}

// ── Helper de concorrência limitada ──────────────────────────────────────────

/**
 * Processa um array de itens com no máximo `concurrency` execuções simultâneas.
 *
 * Garante:
 *   - Falha em um item não impede os demais.
 *   - Nunca excede a concorrência configurada.
 *   - Sem Promise.all irrestrito.
 *   - Sem estado global.
 *
 * @template T, R
 * @param {T[]}                    items
 * @param {number}                 concurrency
 * @param {(item: T, i: number) => Promise<R>} handler
 * @returns {Promise<(R|{ __handlerError: Error })[]>}
 */
async function mapWithConcurrency(items, concurrency, handler) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  // `next` é lido e incrementado atomicamente (JS é single-threaded).
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = await handler(items[i], i);
      } catch (err) {
        // Falha individual não propagada para os outros workers.
        // classifyResult trata __handlerError como 'failed'.
        results[i] = { __handlerError: err };
      }
    }
  }

  const slots = Math.min(concurrency, items.length, MAX_CONCURRENCY);
  await Promise.all(Array.from({ length: slots }, worker));
  return results;
}

// ── Classificação de resultado do pipeline ───────────────────────────────────

/**
 * Classifica o resultado de processClaimedBatch na categoria do resumo HTTP.
 *
 * Estados válidos do pipeline (não inventar strings):
 *   processed            → 'processed'
 *   retry_pending        → 'retried'
 *   rescheduled          → 'rescheduled'
 *   cancelled            → 'cancelled'
 *   failed               → 'failed'
 *   skipped              → 'skipped'
 *   reconciliation_error → 'reconciliation_errors'
 *   __handlerError       → 'failed'  (segurança)
 *   desconhecido         → 'failed'  (fallback seguro)
 *
 * @param {object} result
 * @returns {string}
 */
function classifyResult(result) {
  if (!result || result.__handlerError !== undefined) return 'failed';

  switch (result.status) {
    case 'processed':            return 'processed';
    case 'retry_pending':        return 'retried';
    case 'rescheduled':          return 'rescheduled';
    case 'cancelled':            return 'cancelled';
    case 'failed':               return 'failed';
    case 'skipped':              return 'skipped';
    case 'reconciliation_error': return 'reconciliation_errors';
    default:
      // Resultado desconhecido: não inventar categoria — cair em 'failed' com segurança.
      console.warn('🤖 [BUFFER-PROC] ⚠️  Status desconhecido do pipeline — classificado como failed:', {
        batch_id:        result.batchId   ?? null,
        company_id:      result.companyId ?? null,
        unknown_status:  result.status    ?? null,
      });
      return 'failed';
  }
}

/**
 * Agrega resultados individuais em contagens por categoria para o resumo HTTP.
 *
 * @param {object[]} batchResults
 * @returns {{
 *   processed: number,
 *   retried: number,
 *   rescheduled: number,
 *   cancelled: number,
 *   failed: number,
 *   skipped: number,
 *   reconciliation_errors: number,
 * }}
 */
function buildSummary(batchResults) {
  const summary = {
    processed:             0,
    retried:               0,
    rescheduled:           0,
    cancelled:             0,
    failed:                0,
    skipped:               0,
    reconciliation_errors: 0,
  };

  for (const r of batchResults) {
    const cat = classifyResult(r);
    summary[cat] = (summary[cat] ?? 0) + 1;
  }

  return summary;
}

// ── Handler de lote individual ────────────────────────────────────────────────

/**
 * Processa um único lote claimed, com validação e tratamento de erro individual.
 * Falhas não lançam para o caller — retornam objeto estruturado.
 *
 * IMPORTANTE: Lote com falha antes de qualquer transição permanece em processing.
 * Será recuperado por recoverStaleBatches na próxima invocação.
 *
 * @param {object} batch          - Lote normalizado por claimDueBatches
 * @param {object} svc            - Cliente service_role
 * @param {Function} executePipeline - processClaimedBatch injetado
 * @param {Function} executeAgent    - executeGroupedAgentInternal injetado
 * @returns {Promise<object>}
 */
async function processBatch(batch, svc, executePipeline, executeAgent) {
  // Validação de segurança — não processar lote sem identificadores obrigatórios.
  // Não deve acontecer (claimDueBatches mapeia esses campos), mas é fail-safe.
  if (!batch.companyId || !batch.id || !batch.lockedAt) {
    console.error('🤖 [BUFFER-PROC] ❌ Lote inválido — campos obrigatórios ausentes:', {
      batch_id:       batch.id        ?? 'MISSING',
      company_id:     batch.companyId ?? 'MISSING',
      has_locked_at:  !!batch.lockedAt,
    });
    return {
      success:    false,
      batch_id:   batch.id        ?? null,
      company_id: batch.companyId ?? null,
      error_code: 'INVALID_BATCH',
      status:     'failed',
    };
  }

  try {
    const result = await executePipeline({
      svc,
      batch,
      dependencies: {
        executeAgent,
      },
    });

    return {
      ...result,
      success: result.ok ?? false,
    };

  } catch (err) {
    // Falha capturada no nível do lote — não aborta os demais.
    // errorMessage não logado (pode conter conteúdo do usuário).
    console.error('🤖 [BUFFER-PROC] ❌ Falha ao processar lote:', {
      operation:  'processClaimedBatch',
      batch_id:   batch.id,
      company_id: batch.companyId,
      error_code: err.code ?? 'UNKNOWN',
      // err.message NÃO logado
    });

    return {
      success:    false,
      batch_id:   batch.id,
      company_id: batch.companyId,
      error_code: err.code ?? 'UNKNOWN',
      status:     'failed',
    };
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * Processa o buffer de mensagens agrupadas.
 *
 * @param {object}   req
 * @param {object}   res
 * @param {object}   [_deps]  - Dependências injetáveis (para testes com mocks)
 */
export async function processMessageBuffer(req, res, _deps = {}) {
  const _recoverStaleBatchExecutions = _deps.recoverStaleBatchExecutions ?? recoverStaleBatchExecutions;
  const _recoverStaleBatches         = _deps.recoverStaleBatches         ?? recoverStaleBatches;
  const _claimDueBatches             = _deps.claimDueBatches             ?? claimDueBatches;
  const _processClaimedBatch         = _deps.processClaimedBatch         ?? processClaimedBatch;
  const _executeAgent                = _deps.executeGroupedAgentInternal ?? executeGroupedAgentInternal;
  const svc                          = _deps.svc                         ?? getServiceSupabase();
  const claimLimit                   = _deps.claimLimit                  ?? resolveClaimLimit();
  const concurrency                  = Math.min(
    _deps.concurrency ?? DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
  );

  // ── 1. Validação de método ────────────────────────────────────────────────
  // GET é o método oficial do Vercel Cron. Qualquer outro retorna 405.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET.' });
  }

  // ── 2. Autenticação ───────────────────────────────────────────────────────
  // Segredo ausente no ambiente = fail-closed com 500 (não 401).
  // Header ausente ou inválido = 401.
  // O segredo NUNCA aparece em logs ou resposta.
  const authResult = validateAuth(req);

  if (!authResult.ok) {
    if (authResult.reason === 'env_missing') {
      console.error('🤖 [BUFFER-PROC] ❌ CRON_SECRET não configurado — endpoint inacessível');
      return res.status(500).json({
        success:    false,
        error:      'buffer_processing_failed',
        error_code: 'ENV_NOT_CONFIGURED',
      });
    }
    // header_missing ou inválido → 401 sem detalhe
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // ── 2b. Header Vercel (observabilidade apenas) ────────────────────────────
  // x-vercel-cron-schedule é enviado automaticamente pelo Vercel Cron.
  // Usado SOMENTE para observabilidade — nunca como autenticação ou controle.
  // Sanitizado para evitar refletir valor arbitrário de terceiro em logs.
  // Chamadas manuais autenticadas (sem esse header) continuam funcionando.
  const cronScheduleRaw = req.headers['x-vercel-cron-schedule'];
  if (cronScheduleRaw) {
    const cronScheduleSafe = String(cronScheduleRaw).slice(0, 50);
    console.log('🤖 [BUFFER-PROC] 📅 Invocação via Vercel Cron:', { cron_schedule: cronScheduleSafe });
  }

  // ── 3. Cliente Supabase ───────────────────────────────────────────────────
  if (!svc) {
    console.error('🤖 [BUFFER-PROC] ❌ service_role client indisponível');
    return res.status(500).json({
      success:    false,
      error:      'buffer_processing_failed',
      error_code: 'SVC_NOT_CONFIGURED',
    });
  }

  const startMs = Date.now();

  // ── 4. Recovery 1: execuções presas ──────────────────────────────────────
  // Invalida execuções em processing cujo timeout expirou.
  // Falha aqui impede claim — estado potencialmente inconsistente.
  let recoveredExecutions = 0;
  try {
    const recovered = await _recoverStaleBatchExecutions({ svc });
    recoveredExecutions = recovered.length;

    if (recoveredExecutions > 0) {
      console.log('🤖 [BUFFER-PROC] ♻️  Execuções recuperadas:', {
        operation:            'recoverStaleBatchExecutions',
        recovered_executions: recoveredExecutions,
      });
    }
  } catch (err) {
    console.error('🤖 [BUFFER-PROC] ❌ Falha no recovery de execuções — abortando:', {
      operation:  'recoverStaleBatchExecutions',
      error_code: err.code ?? 'UNKNOWN',
    });
    return res.status(500).json({
      success:    false,
      error:      'buffer_processing_failed',
      error_code: 'RECOVERY_EXECUTION_FAILED',
    });
  }

  // ── 5. Recovery 2: lotes presos ──────────────────────────────────────────
  // Devolve lotes em processing expirado para retry_pending ou failed.
  // Falha aqui impede claim — estado potencialmente inconsistente.
  let recoveredBatches = 0;
  try {
    const recovered = await _recoverStaleBatches({ svc });
    recoveredBatches = recovered.length;

    if (recoveredBatches > 0) {
      console.log('🤖 [BUFFER-PROC] ♻️  Lotes recuperados:', {
        operation:         'recoverStaleBatches',
        recovered_batches: recoveredBatches,
      });
    }
  } catch (err) {
    console.error('🤖 [BUFFER-PROC] ❌ Falha no recovery de lotes — abortando:', {
      operation:  'recoverStaleBatches',
      error_code: err.code ?? 'UNKNOWN',
    });
    return res.status(500).json({
      success:    false,
      error:      'buffer_processing_failed',
      error_code: 'RECOVERY_BATCH_FAILED',
    });
  }

  // ── 6. Claim ──────────────────────────────────────────────────────────────
  // Claim atômico de lotes elegíveis (deadline <= now, status=retry_pending|open).
  // Falha aqui impede pipeline — não processar em estado inconsistente.
  let claimed = [];
  try {
    claimed = await _claimDueBatches({ svc, limit: claimLimit });
  } catch (err) {
    console.error('🤖 [BUFFER-PROC] ❌ Falha no claim — abortando:', {
      operation:   'claimDueBatches',
      error_code:  err.code ?? 'UNKNOWN',
      claim_limit: claimLimit,
    });
    return res.status(500).json({
      success:    false,
      error:      'buffer_processing_failed',
      error_code: 'CLAIM_FAILED',
    });
  }

  console.log('🤖 [BUFFER-PROC] 📋 Ciclo iniciado:', {
    operation:            'processMessageBuffer',
    claimed:              claimed.length,
    recovered_executions: recoveredExecutions,
    recovered_batches:    recoveredBatches,
    claim_limit:          claimLimit,
    concurrency,
  });

  // ── Sem lotes: retornar cedo ──────────────────────────────────────────────
  if (claimed.length === 0) {
    return res.status(200).json({
      success:   true,
      claimed:   0,
      processed: 0,
      failed:    0,
      summary: {
        recovered_executions:  recoveredExecutions,
        recovered_batches:     recoveredBatches,
        retried:               0,
        rescheduled:           0,
        cancelled:             0,
        skipped:               0,
        reconciliation_errors: 0,
      },
    });
  }

  // ── 7. Processamento com concorrência limitada ────────────────────────────
  const batchResults = await mapWithConcurrency(
    claimed,
    concurrency,
    (batch) => processBatch(batch, svc, _processClaimedBatch, _executeAgent),
  );

  // ── 8. Agregar resultados ─────────────────────────────────────────────────
  const summary    = buildSummary(batchResults);
  const durationMs = Date.now() - startMs;

  console.log('🤖 [BUFFER-PROC] ✅ Ciclo concluído:', {
    operation:            'processMessageBuffer',
    claimed:              claimed.length,
    processed:            summary.processed,
    retried:              summary.retried,
    rescheduled:          summary.rescheduled,
    cancelled:            summary.cancelled,
    failed:               summary.failed,
    skipped:              summary.skipped,
    reconciliation_errors: summary.reconciliation_errors,
    recovered_executions: recoveredExecutions,
    recovered_batches:    recoveredBatches,
    duration_ms:          durationMs,
  });

  // Resposta não contém: mensagens, payload, claimToken, lockedAt, secrets.
  // `failed` sempre presente (incluindo zero) para consistência de contrato.
  return res.status(200).json({
    success:   true,
    claimed:   claimed.length,
    processed: summary.processed,
    failed:    summary.failed,
    summary: {
      recovered_executions:  recoveredExecutions,
      recovered_batches:     recoveredBatches,
      retried:               summary.retried,
      rescheduled:           summary.rescheduled,
      cancelled:             summary.cancelled,
      skipped:               summary.skipped,
      reconciliation_errors: summary.reconciliation_errors,
    },
  });
}

// ── Vercel Function handler ───────────────────────────────────────────────────

export default async function handler(req, res) {
  return processMessageBuffer(req, res);
}

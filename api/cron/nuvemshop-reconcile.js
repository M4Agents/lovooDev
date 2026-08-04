// =============================================================================
// GET /api/cron/nuvemshop-reconcile
//
// Worker de reconciliação da integração Nuvemshop — executado pelo Vercel Cron.
//
// ── Responsabilidades (Plano v5.1) ───────────────────────────────────────────
//   1. Para cada empresa com conexão Nuvemshop ativa:
//      a. Para cada tipo de recurso (categories, products, customers, orders):
//         i.  Ler checkpoint (último since_id e timestamp de sync)
//         ii. Verificar compatibilidade de versão (CURRENT_SYNC_VERSION)
//         iii.Buscar recursos alterados desde last_sync_at via API Nuvemshop
//         iv. Criar eventos sintéticos na fila (nuvemshop_webhook_events)
//         v.  Atualizar checkpoint APÓS sucesso
//   2. Nunca atualizar Leads, Produtos ou Oportunidades diretamente.
//      Toda a lógica de negócio fica nos handlers e sync services existentes.
//   3. O pipeline normal (nuvemshop-process-events) processa os eventos gerados.
//
// ── Versionamento ────────────────────────────────────────────────────────────
//   CURRENT_SYNC_VERSION: versão do schema de reconciliação.
//   Se checkpoint.checkpoint_data.sync_version !== CURRENT_SYNC_VERSION:
//     - Marcar para re-sync completo (resetar cursor)
//     - NÃO executar automaticamente — aguardar próxima execução
//
// ── Idempotência ─────────────────────────────────────────────────────────────
//   Chave de eventos sintéticos: rec:{YYYY-MM-DD}:{store_id}:{topic}:{resource_id}
//   - Garante que o mesmo recurso não seja re-enfileirado mais de uma vez por dia
//   - Separado do namespace de eventos de webhook reais ({store_id}:{topic}:{resource_id})
//   - ON CONFLICT DO NOTHING: se evento já existe (pending), mantém o original
//
// ── Checkpoints ──────────────────────────────────────────────────────────────
//   Atualização SOMENTE após sucesso do lote inteiro para cada sync_type.
//   Suporte a retomada: cursor (last_external_id) preservado entre execuções.
//
// ── Segurança ────────────────────────────────────────────────────────────────
//   - Apenas conexões com status = 'active'
//   - company_id e store_id obrigatórios em todos os eventos gerados
//   - Nunca expor access_token em logs
//   - Usar service_role apenas no backend
//
// ── Observabilidade ──────────────────────────────────────────────────────────
//   - Início, fim, duração
//   - Quantidade de recursos encontrados por tipo
//   - Quantidade de eventos gerados por tipo
//   - Quantidade de erros por empresa/tipo
//   - correlation_id por execução
// =============================================================================

import { randomBytes }              from 'crypto';
import { getSupabaseAdmin }         from '../lib/automation/supabaseAdmin.js';
import { createNuvemshopClient }    from '../lib/nuvemshop/nuvemshopClient.js';
import { decryptNuvemshopToken }    from '../lib/nuvemshop/tokenCrypto.js';
// Versões centralizadas — única fonte de verdade para controle de schema
import { CURRENT_SYNC_VERSION,
         SCHEMA_VERSION }           from '../lib/nuvemshop/syncVersion.js';

// ── Configurações operacionais ─────────────────────────────────────────────
const MAX_COMPANIES_PER_RUN = 3;    // Empresas por execução (respeita limite 60s Vercel)
const MAX_ITEMS_PER_TYPE    = 500;  // Limite por tipo de recurso por empresa por run
const PAGE_SIZE             = 100;  // Itens por página na API Nuvemshop
const LOCK_TTL_SECONDS      = 90;   // TTL do lock de reconciliação por sync_type
const WORKER_PREFIX         = 'nv-rec';

/**
 * Mapeamento: sync_type → endpoint NS + topic para evento sintético.
 * Chave matches exatas de nuvemshop_sync_checkpoints.sync_type CHECK constraint.
 */
const RESOURCE_CONFIG = {
  categories: {
    endpoint:      'categories',
    createdTopic:  'category/created',
    updatedTopic:  'category/updated',
    idField:       'id',
    // LIMITAÇÃO DA API NUVEMSHOP (não da arquitetura LoovooCRM):
    // O endpoint GET /categories não suporta filtro por updated_at_min.
    // Por isso, a reconciliação de categorias é sempre completa (full scan via since_id).
    // Como lojas tipicamente têm poucas categorias (<200), o impacto é aceitável.
    // Ref: https://tiendanube.github.io/api-documentation/resources/category
    supportsDateFilter: false,
  },
  products: {
    endpoint:      'products',
    createdTopic:  'product/created',
    updatedTopic:  'product/updated',
    idField:       'id',
    supportsDateFilter: true,
    dateFilterParam:   'updated_at_min',
  },
  customers: {
    endpoint:      'customers',
    createdTopic:  'customer/created',
    updatedTopic:  'customer/updated',
    idField:       'id',
    supportsDateFilter: true,
    dateFilterParam:   'updated_at_min',
  },
  orders: {
    endpoint:      'orders',
    createdTopic:  'order/created',
    updatedTopic:  'order/updated',
    idField:       'id',
    supportsDateFilter: true,
    dateFilterParam:   'updated_at_min',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWorkerId() {
  return `${WORKER_PREFIX}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function makeCorrelationId() {
  return `rec-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

/**
 * Chave de idempotência para eventos sintéticos de reconciliação.
 * Inclui a data para permitir re-enfileiramento diário do mesmo recurso.
 * Separado do namespace de webhooks reais para evitar colisões.
 *
 * Formato: rec:{YYYY-MM-DD}:{store_id}:{topic}:{resource_id}
 */
function makeReconcileIdempotencyKey(storeId, topic, resourceId) {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `rec:${date}:${storeId}:${topic}:${resourceId}`;
}

/**
 * Determina o tópico correto com base no estado do recurso no banco.
 * Como a reconciliação é incremental (filtra por updated_at_min),
 * todos os recursos retornados são tratados como 'updated' — o sync service
 * fará o UPSERT correto independente de ser novo ou existente.
 */
function getTopicForResource(config) {
  return config.updatedTopic;
}

function log(level, event, data = {}) {
  console[level === 'error' ? 'error' : 'info'](JSON.stringify({
    level,
    event:   `reconcile.${event}`,
    service: 'nuvemshop-reconcile',
    ...data,
  }));
}

// ── Enfileiramento de evento sintético ────────────────────────────────────

/**
 * Cria um evento sintético na fila nuvemshop_webhook_events.
 * O payload mínimo contém apenas o `id` do recurso — o handler fará
 * o GET /resource/{id} para buscar dados atuais, garantindo que a
 * reconciliação nunca duplique lógica de negócio.
 *
 * @returns {{ enqueued: boolean, skipped: boolean }}
 */
async function enqueueReconcileEvent(svc, {
  companyId, storeId, topic, resourceId, correlationId,
}) {
  const idempotencyKey = makeReconcileIdempotencyKey(storeId, topic, resourceId);

  // Usa o mesmo RPC que o webhook receiver — reutiliza infraestrutura existente.
  // ON CONFLICT DO NOTHING: evento já pendente → manter original sem duplicar.
  const { data, error } = await svc.rpc('enqueue_nuvemshop_event', {
    p_company_id:      companyId,
    p_store_id:        storeId,
    p_event_id:        null,          // event_id é nullable (apenas webhooks reais têm)
    p_topic:           topic,
    p_payload:         {
      id:              resourceId,
      _reconcile:      true,          // Flag de rastreabilidade — não muda processamento
      _reconcile_at:   new Date().toISOString(),
    },
    p_correlation_id:  correlationId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(`Falha ao enfileirar evento sintético: ${error.message}`);
  }

  return {
    enqueued: data?.ok === true,
    skipped:  data?.ok !== true,   // ON CONFLICT DO NOTHING → ok=false, already_exists=true
  };
}

// ── Checkpoint: leitura e escrita ─────────────────────────────────────────

async function getCheckpoint(svc, companyId, storeId, syncType) {
  const { data } = await svc
    .from('nuvemshop_sync_checkpoints')
    .select('*')
    .eq('company_id', companyId)
    .eq('store_id',   storeId)
    .eq('sync_type',  syncType)
    .maybeSingle();

  return data ?? null;
}

async function upsertCheckpoint(svc, companyId, storeId, syncType, patch) {
  await svc
    .from('nuvemshop_sync_checkpoints')
    .upsert({
      company_id:   companyId,
      store_id:     storeId,
      sync_type:    syncType,
      ...patch,
      updated_at:   new Date().toISOString(),
    }, {
      onConflict:      'company_id,store_id,sync_type',
      ignoreDuplicates: false,
    });
}

// ── Verificação de versão ─────────────────────────────────────────────────

/**
 * Verifica se o checkpoint é compatível com a versão atual.
 * Se incompatível:
 *   - Reseta o cursor (força re-sync completo)
 *   - Registra nova versão no checkpoint_data
 *   - Retorna false para pular a execução atual (re-sync começa na próxima)
 *
 * Nunca executa re-sync completo durante a requisição em andamento
 * — protege contra operações pesadas não planejadas.
 */
async function checkVersion(svc, companyId, storeId, syncType, checkpoint) {
  // Sem checkpoint (primeira execução): nenhuma versão para validar — prosseguir.
  if (!checkpoint) return true;

  const storedVersion = checkpoint.checkpoint_data?.sync_version;
  const storedSchema  = checkpoint.checkpoint_data?.schema_version;

  const versionOk = storedVersion === CURRENT_SYNC_VERSION;
  const schemaOk  = storedSchema  === SCHEMA_VERSION;

  if (!versionOk || !schemaOk) {
    log('warn', 'version_mismatch', {
      company_id:       companyId,
      store_id:         storeId,
      sync_type:        syncType,
      stored_version:   storedVersion ?? 'none',
      expected_version: CURRENT_SYNC_VERSION,
      stored_schema:    storedSchema  ?? 'none',
      expected_schema:  SCHEMA_VERSION,
      action:           'resetting_checkpoint_for_next_run',
    });

    // Resetar cursor para forçar re-sync completo na próxima execução
    await upsertCheckpoint(svc, companyId, storeId, syncType, {
      status:           'idle',
      current_page:     1,
      cursor_since_id:  null,
      last_external_id: null,
      total_processed:  0,
      total_errors:     0,
      started_at:       null,
      completed_at:     null,
      checkpoint_data:  {
        sync_version:   CURRENT_SYNC_VERSION,
        schema_version: SCHEMA_VERSION,
        reset_reason:   `version_mismatch:stored=${storedVersion},expected=${CURRENT_SYNC_VERSION}`,
        reset_at:       new Date().toISOString(),
      },
    });

    return false; // Pular esta execução; re-sync acontece na próxima
  }

  return true;
}

// ── Reconciliação de um tipo de recurso ──────────────────────────────────

/**
 * Reconcilia um tipo de recurso para uma empresa.
 * Busca recursos alterados via API, cria eventos sintéticos, atualiza checkpoint.
 *
 * @returns {{ found: number, enqueued: number, skipped: number, errors: number }}
 */
async function reconcileResourceType(conn, syncType, svc, workerId, correlationId) {
  const { id: connectionId, company_id: companyId, store_id: storeId } = conn;
  const config = RESOURCE_CONFIG[syncType];

  log('info', 'resource_start', { company_id: companyId, store_id: storeId, sync_type: syncType });

  let found    = 0;
  let enqueued = 0;
  let skipped  = 0;
  let errors   = 0;

  // ── 1. Adquirir lock para evitar reconciliação paralela do mesmo tipo ──
  // Reutiliza a infraestrutura de lock existente com resource_type='reconcile'
  const { data: lockResult, error: lockErr } = await svc.rpc('acquire_nuvemshop_lock', {
    p_company_id:    companyId,
    p_store_id:      storeId,
    p_resource_type: 'reconcile',
    p_resource_id:   syncType,
    p_worker_id:     workerId,
    p_ttl_seconds:   LOCK_TTL_SECONDS,
  });

  if (lockErr) {
    log('error', 'lock_acquire_rpc_error', {
      company_id: companyId, store_id: storeId, sync_type: syncType,
      error: lockErr.message,
    });
    return { found: 0, enqueued: 0, skipped: 0, errors: 1, lockBusy: false };
  }

  if (!lockResult?.ok) {
    // Registrar evento estruturado de skip por lock ativo — permite diagnóstico de contention
    log('info', 'reconcile_skipped_lock_active', {
      company_id: companyId,
      store_id:   storeId,
      sync_type:  syncType,
      worker_id:  workerId,
    });
    return { found: 0, enqueued: 0, skipped: 0, errors: 0, lockBusy: true };
  }

  try {
    // ── 2. Ler checkpoint ──────────────────────────────────────────────
    const checkpoint = await getCheckpoint(svc, companyId, storeId, syncType);

    // ── 3. Verificar versão ────────────────────────────────────────────
    const versionOk = await checkVersion(svc, companyId, storeId, syncType, checkpoint);
    if (!versionOk) {
      log('info', 'version_reset_skip', { company_id: companyId, sync_type: syncType });
      return { found: 0, enqueued: 0, skipped: 0, errors: 0 };
    }

    // ── 4. Marcar checkpoint como running ──────────────────────────────
    const syncStartedAt = new Date().toISOString();
    await upsertCheckpoint(svc, companyId, storeId, syncType, {
      status:          'running',
      started_at:      syncStartedAt,
      last_activity_at: syncStartedAt,
      checkpoint_data: {
        sync_version:   CURRENT_SYNC_VERSION,
        schema_version: SCHEMA_VERSION,
        last_run_started: syncStartedAt,
      },
    });

    // ── 5. Determinar filtro temporal ──────────────────────────────────
    // Usa last_activity_at como ponto de corte para busca incremental.
    // Primeira execução (sem checkpoint): data antiga = full scan de toda a loja.
    // Garante que produtos criados antes da conexão também sejam importados.
    // 2010-01-01 cobre todo o histórico possível de uma loja Nuvemshop.
    const lastSyncAt = checkpoint?.last_activity_at ?? '2010-01-01T00:00:00.000Z';

    // ── 6. Decriptar token e criar cliente NS ──────────────────────────
    const plainToken = decryptNuvemshopToken(conn.access_token_enc);
    const client     = createNuvemshopClient({
      storeId:       storeId,
      accessToken:   plainToken,
      correlationId: correlationId,
    });

    // ── 7. Buscar recursos alterados via API Nuvemshop ─────────────────
    const queryParams = { per_page: PAGE_SIZE };

    if (config.supportsDateFilter) {
      // Recursos com suporte a filtro temporal (products, customers, orders)
      queryParams[config.dateFilterParam] = lastSyncAt;
    }
    // Categorias: sem filtro temporal — paginação via since_id

    const resources = await client.getAllPages(
      config.endpoint,
      queryParams,
      { maxItems: MAX_ITEMS_PER_TYPE, perPage: PAGE_SIZE },
    );

    found = resources.length;
    log('info', 'resources_found', {
      company_id: companyId, store_id: storeId, sync_type: syncType,
      found, last_sync_at: lastSyncAt,
    });

    if (found === 0) {
      // Nenhum recurso alterado — atualizar apenas o timestamp
      await upsertCheckpoint(svc, companyId, storeId, syncType, {
        status:          'completed',
        completed_at:    new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        checkpoint_data: {
          sync_version:   CURRENT_SYNC_VERSION,
          schema_version: SCHEMA_VERSION,
          last_run_started:   syncStartedAt,
          last_run_completed: new Date().toISOString(),
          resources_found:    0,
        },
      });
      return { found: 0, enqueued: 0, skipped: 0, errors: 0 };
    }

    // ── 8. Criar eventos sintéticos na fila ───────────────────────────
    // Nunca atualiza Leads/Produtos/Oportunidades diretamente.
    // O pipeline normal (nuvemshop-process-events) processa via handlers existentes.
    const topic = getTopicForResource(config);

    for (const resource of resources) {
      const resourceId = resource[config.idField];
      if (!resourceId) continue;

      try {
        const result = await enqueueReconcileEvent(svc, {
          companyId, storeId, topic,
          resourceId:    String(resourceId),
          correlationId: correlationId,
        });

        if (result.enqueued) enqueued++;
        else                  skipped++;
      } catch (err) {
        errors++;
        log('error', 'enqueue_error', {
          company_id: companyId, store_id: storeId, sync_type: syncType,
          resource_id: resourceId, topic,
          error: err.message,
        });
      }
    }

    // ── 9. Atualizar checkpoint SOMENTE após sucesso ───────────────────
    const lastId = resources.length > 0
      ? String(resources[resources.length - 1][config.idField])
      : checkpoint?.last_external_id;

    await upsertCheckpoint(svc, companyId, storeId, syncType, {
      status:           errors > 0 ? 'failed' : 'completed',
      completed_at:     new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      last_external_id: lastId,
      total_processed:  (checkpoint?.total_processed ?? 0) + enqueued,
      total_errors:     (checkpoint?.total_errors    ?? 0) + errors,
      checkpoint_data:  {
        sync_version:         CURRENT_SYNC_VERSION,
        schema_version:       SCHEMA_VERSION,
        last_run_started:     syncStartedAt,
        last_run_completed:   new Date().toISOString(),
        resources_found:      found,
        events_enqueued:      enqueued,
        events_skipped:       skipped,
        events_errors:        errors,
        last_since_id:        lastId,
      },
    });

    log('info', 'resource_done', {
      company_id: companyId, store_id: storeId, sync_type: syncType,
      found, enqueued, skipped, errors,
    });

    return { found, enqueued, skipped, errors };

  } catch (err) {
    errors++;
    log('error', 'resource_error', {
      company_id: companyId, store_id: storeId, sync_type: syncType,
      error: err.message,
    });

    await upsertCheckpoint(svc, companyId, storeId, syncType, {
      status:          'failed',
      last_activity_at: new Date().toISOString(),
      total_errors:    (await getCheckpoint(svc, companyId, storeId, syncType))?.total_errors ?? 0 + 1,
    }).catch(() => {}); // Ignorar falha na atualização do checkpoint de erro

    return { found, enqueued, skipped, errors };

  } finally {
    // ── 10. Liberar lock SEMPRE (finally) ─────────────────────────────
    await svc.rpc('release_nuvemshop_lock', {
      p_company_id:    companyId,
      p_resource_type: 'reconcile',
      p_resource_id:   syncType,
      p_worker_id:     workerId,
    }).catch((e) => {
      log('error', 'lock_release_error', {
        company_id: companyId, sync_type: syncType, error: e.message,
      });
    });
  }
}

// ── Reconciliação de uma empresa ─────────────────────────────────────────

async function reconcileCompany(conn, svc, workerId, correlationId) {
  const { company_id: companyId, store_id: storeId } = conn;

  log('info', 'company_start', { company_id: companyId, store_id: storeId });

  const companyStartAt = Date.now();
  const totals = { found: 0, enqueued: 0, skipped: 0, errors: 0 };

  for (const syncType of Object.keys(RESOURCE_CONFIG)) {
    try {
      const result = await reconcileResourceType(conn, syncType, svc, workerId, correlationId);

      // Se o lock estiver ativo, encerrar imediatamente a reconciliação desta empresa.
      // O log 'reconcile_skipped_lock_active' já foi registrado dentro de reconcileResourceType.
      if (result.lockBusy) {
        log('info', 'company_reconcile_aborted_lock_active', {
          company_id: companyId, store_id: storeId, sync_type: syncType,
        });
        break;
      }

      totals.found    += result.found;
      totals.enqueued += result.enqueued;
      totals.skipped  += result.skipped;
      totals.errors   += result.errors;
    } catch (err) {
      totals.errors++;
      log('error', 'sync_type_fatal', {
        company_id: companyId, store_id: storeId, sync_type: syncType,
        error: err.message,
      });
    }
  }

  const durationMs = Date.now() - companyStartAt;
  log('info', 'company_done', {
    company_id: companyId, store_id: storeId,
    duration_ms: durationMs, ...totals,
  });

  return totals;
}

// ── Handler principal ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const runStartAt    = Date.now();
  const workerId      = makeWorkerId();
  const correlationId = makeCorrelationId();

  log('info', 'run_start', {
    worker_id: workerId, correlation_id: correlationId,
    max_companies: MAX_COMPANIES_PER_RUN,
  });

  const svc = getSupabaseAdmin();

  try {
    // ── Prioridade 1: conexões com initial_sync_needed = true ──────────
    // Novas conexões OAuth aguardam sincronização imediata (a cada 5 min).
    const { data: priorityConns, error: priorityErr } = await svc
      .from('nuvemshop_connections')
      .select('id, company_id, store_id: nuvemshop_store_id, access_token_enc, initial_sync_needed')
      .eq('status', 'active')
      .eq('initial_sync_needed', true)
      .limit(MAX_COMPANIES_PER_RUN);

    if (priorityErr) {
      log('error', 'fetch_priority_connections_error', { error: priorityErr.message });
    }

    // ── Prioridade 2: reconciliação horária normal ────────────────────
    // Executa apenas quando o minuto é 0 (topo da hora), mesmo o cron rodando a cada 5 min.
    const isHourlyRun    = new Date().getMinutes() === 0;
    const priorityIds    = (priorityConns ?? []).map(c => c.company_id);

    let regularConns = [];
    if (isHourlyRun) {
      const regularQuery = svc
        .from('nuvemshop_connections')
        .select('id, company_id, store_id: nuvemshop_store_id, access_token_enc, initial_sync_needed')
        .eq('status', 'active')
        .eq('initial_sync_needed', false)
        .order('updated_at', { ascending: true })
        .limit(MAX_COMPANIES_PER_RUN);

      // Excluir empresas já cobertas na prioridade 1 para evitar duplicidade
      if (priorityIds.length > 0) regularQuery.not('company_id', 'in', `(${priorityIds.join(',')})`);

      const { data: reg, error: regErr } = await regularQuery;
      if (regErr) log('error', 'fetch_regular_connections_error', { error: regErr.message });
      regularConns = reg ?? [];
    }

    const connections = [...(priorityConns ?? []), ...regularConns];

    if (!connections.length) {
      log('info', 'no_connections_to_reconcile', {
        worker_id: workerId,
        is_hourly_run: isHourlyRun,
        priority_count: (priorityConns ?? []).length,
      });
      return res.status(200).json({ ok: true, message: 'Nenhuma conexão para reconciliar neste ciclo' });
    }

    log('info', 'connections_selected', {
      worker_id: workerId,
      priority: (priorityConns ?? []).length,
      regular:  regularConns.length,
      is_hourly_run: isHourlyRun,
    });

    // ── Processar cada empresa ─────────────────────────────────────────
    const results = [];
    const runTotals = { companies: 0, found: 0, enqueued: 0, skipped: 0, errors: 0 };

    for (const conn of connections) {
      try {
        const result = await reconcileCompany(conn, svc, workerId, correlationId);
        runTotals.companies++;
        runTotals.found    += result.found;
        runTotals.enqueued += result.enqueued;
        runTotals.skipped  += result.skipped;
        runTotals.errors   += result.errors;
        results.push({ company_id: conn.company_id, initial_sync: conn.initial_sync_needed, ...result });

        // Resetar flag após sincronização inicial completa
        if (conn.initial_sync_needed) {
          await svc
            .from('nuvemshop_connections')
            .update({ initial_sync_needed: false, updated_at: new Date().toISOString() })
            .eq('id', conn.id)
            .catch(e => log('error', 'reset_initial_sync_failed', {
              company_id: conn.company_id, error: e.message,
            }));

          log('info', 'initial_sync_completed', {
            company_id: conn.company_id,
            store_id:   conn.store_id,
            worker_id:  workerId,
          });
        }
      } catch (err) {
        runTotals.errors++;
        log('error', 'company_fatal', {
          company_id: conn.company_id, error: err.message, worker_id: workerId,
        });
        results.push({ company_id: conn.company_id, error: err.message });
      }
    }

    const durationMs = Date.now() - runStartAt;

    log('info', 'run_done', {
      worker_id: workerId, correlation_id: correlationId,
      duration_ms: durationMs, ...runTotals,
    });

    return res.status(200).json({
      ok:            true,
      worker_id:     workerId,
      duration_ms:   durationMs,
      totals:        runTotals,
      companies:     results,
    });

  } catch (err) {
    const durationMs = Date.now() - runStartAt;
    log('error', 'run_fatal', {
      worker_id: workerId, error: err.message, duration_ms: durationMs,
    });
    return res.status(500).json({ error: 'Erro interno na reconciliação' });
  }
}

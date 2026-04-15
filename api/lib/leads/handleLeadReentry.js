/**
 * handleLeadReentry
 * Responsabilidade única: registrar uma reentrada de lead e aplicar a regra de negócio
 * configurada por empresa sobre a opportunity correspondente.
 *
 * NÃO faz: merge, disparo de automação, decisão de UI, alteração de leads.
 * Chamado em fire-and-forget pelos endpoints de webhook/whatsapp.
 *
 * PROTEÇÃO PRINCIPAL: UNIQUE(company_id, idempotency_key) em lead_entries.
 * Garante que a mesma entrada nunca seja processada duas vezes, independente de concorrência.
 * Advisory lock foi removido — em serverless (Vercel/PostgREST), cada RPC usa uma conexão
 * diferente do pool, tornando session-level locks ineficazes.
 */

import crypto from 'crypto';

/**
 * Gera idempotency_key hierárquica.
 * P1: external_event_id disponível → SHA256(company_id::external_event_id)
 * P2: payload hash disponível      → SHA256(company_id::lead_id::source::hash_payload[:16])
 * P3: fallback mínimo seguro       → SHA256(company_id::lead_id::source::epoch_seconds)
 *
 * P1 é preferido quando há identificador externo real (message_id, webhook_id).
 * P2 cobre casos com payload estável mas sem ID externo.
 * P3 é fallback — pode gerar duplicatas se chamado duas vezes no mesmo segundo para o mesmo lead;
 *    aceitável porque o cenário real de duplicata dentro de 1s é de concorrência, não de reprocessamento.
 */
function buildIdempotencyKey({ companyId, leadId, source, externalEventId, payloadHash }) {
  if (externalEventId) {
    return crypto.createHash('sha256')
      .update(`${companyId}::${externalEventId}`)
      .digest('hex');
  }
  if (payloadHash) {
    return crypto.createHash('sha256')
      .update(`${companyId}::${leadId}::${source}::${payloadHash.slice(0, 16)}`)
      .digest('hex');
  }
  const epochSeconds = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha256')
    .update(`${companyId}::${leadId}::${source}::${epochSeconds}`)
    .digest('hex');
}

/**
 * Gera hash SHA256 de um objeto (usado para idempotência P2).
 */
export function hashPayload(obj) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');
}

/**
 * Parâmetros:
 *   newLeadId        {number}  - id do lead recém-inserido (pode ser igual a existingLeadId em reentrada direta WhatsApp)
 *   existingLeadId   {number}  - id do lead original (onde registrar e atuar)
 *   companyId        {string}  - UUID da empresa (obrigatório — isolamento multi-tenant)
 *   source           {string}  - 'webhook' | 'whatsapp' | 'import' | 'manual'
 *   externalEventId  {string?} - identificador externo bruto (message_id, webhook_id) — prioridade P1
 *   originChannel    {string?} - canal de negócio em snake_case (ex: 'facebook_ads', 'whatsapp')
 *   metadata         {object}  - contexto adicional para rastreabilidade
 *   supabase         {object}  - SupabaseClient com service_role
 *
 * Retorna: { action, leadEntryId?, opportunityId?, skipped, reason? }
 */
export async function handleLeadReentry({
  newLeadId,
  existingLeadId,
  companyId,
  source,
  externalEventId = null,
  originChannel = null,
  metadata = {},
  supabase,
}) {
  try {
    const payloadHash = hashPayload({ newLeadId, existingLeadId, source, ...metadata });
    const idempotencyKey = buildIdempotencyKey({
      companyId,
      leadId: existingLeadId,
      source,
      externalEventId,
      payloadHash,
    });

    // Construir metadata da entrada — omitir new_lead_id quando é reentrada direta (newLeadId === existingLeadId)
    const entryMetadata = newLeadId !== existingLeadId
      ? { new_lead_id: newLeadId, ...metadata }
      : { ...metadata };

    // PASSO 1: Inserir lead_entry.
    // UNIQUE(company_id, idempotency_key) garante idempotência real.
    // ignoreDuplicates=true: se a entrada já existia, retorna [] sem erro — processing já foi feito.
    const { data: entryRows, error: entryError } = await supabase
      .from('lead_entries')
      .upsert(
        {
          company_id: companyId,
          lead_id: existingLeadId,
          source,
          origin_channel: originChannel,
          external_event_id: externalEventId,
          idempotency_key: idempotencyKey,
          metadata: entryMetadata,
        },
        { onConflict: 'company_id,idempotency_key', ignoreDuplicates: true }
      )
      .select('id');

    if (entryError) {
      console.error('[handleLeadReentry] Erro ao inserir lead_entry:', entryError.message);
      return { action: 'error', skipped: false, reason: entryError.message };
    }

    const leadEntryId = entryRows?.[0]?.id;
    if (!leadEntryId) {
      // Entrada já existia → evento já foi processado anteriormente
      return { action: 'already_processed', skipped: true, reason: 'idempotency_conflict' };
    }

    // PASSO 2: Ler configuração da empresa
    const { data: config } = await supabase
      .from('company_lead_config')
      .select('enabled, duplicate_lead_config')
      .eq('company_id', companyId)
      .single();

    if (!config || !config.enabled) {
      return { action: 'skipped', leadEntryId, skipped: true, reason: 'feature_disabled' };
    }

    const rules = config.duplicate_lead_config || {};

    // PASSO 3: Selecionar opportunity alvo no lead original.
    // Prioridade: OPEN mais recente → LOST mais recente → WON separado.
    // Nota: tabela opportunities não tem deleted_at.
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, status, created_at, closed_at')
      .eq('lead_id', existingLeadId)
      .eq('company_id', companyId)
      .limit(20);

    // Ordenar: open(0) > lost(1) > won(2), desempate por mais recente
    const sorted = (opps || []).sort((a, b) => {
      const priority = { open: 0, lost: 1, won: 2 };
      const pa = priority[a.status] ?? 3;
      const pb = priority[b.status] ?? 3;
      if (pa !== pb) return pa - pb;
      const da = new Date(a.closed_at || a.created_at).getTime();
      const db = new Date(b.closed_at || b.created_at).getTime();
      return db - da;
    });

    const targetOpp = sorted[0] ?? null;

    if (!targetOpp) {
      return { action: 'entry_only', leadEntryId, skipped: false, reason: 'no_opportunity' };
    }

    // PASSO 4: Aplicar regra por status × config
    const action = await applyReentryRule({
      targetOpp,
      rules,
      companyId,
      existingLeadId,
      leadEntryId,
      source,
      originChannel,
      supabase,
    });

    return { ...action, leadEntryId };

  } catch (err) {
    console.error('[handleLeadReentry] Exceção:', err.message);
    return { action: 'error', skipped: false, reason: err.message };
  }
}

/**
 * Aplica a regra configurada sobre a opportunity alvo.
 *
 * Semântica de eventos:
 *   'reopened'    = ação executada (pela RPC reopen_opportunity)
 *   'lead_reentry' = causa da ação (inserido logo após)
 * Ambos podem coexistir no history — não é duplicidade, são eventos distintos.
 */
async function applyReentryRule({ targetOpp, rules, companyId, existingLeadId, leadEntryId, source, originChannel, supabase }) {
  const { id: oppId, status } = targetOpp;
  const eventMetadata = { source, lead_entry_id: leadEntryId, origin_channel: originChannel };

  if (status === 'won') {
    const rule = rules.won || 'NEW_OPPORTUNITY';
    if (rule === 'NEW_OPPORTUNITY') {
      const newOppId = await createNewOpportunity({ companyId, existingLeadId, source, supabase });
      if (newOppId) await insertReentryEvent({ supabase, companyId, opportunityId: newOppId, metadata: eventMetadata });
      return { action: 'new_opportunity', opportunityId: newOppId };
    }
    await insertReentryEvent({ supabase, companyId, opportunityId: oppId, metadata: eventMetadata });
    return { action: 'event_only', opportunityId: oppId };
  }

  if (status === 'lost') {
    const rule = rules.lost || 'REOPEN';
    if (rule === 'REOPEN') {
      await reopenOpportunity({ supabase, companyId, oppId });
      // 'reopened' já foi inserido pela RPC; 'lead_reentry' é a causa, inserido aqui
      await insertReentryEvent({ supabase, companyId, opportunityId: oppId, metadata: eventMetadata });
      return { action: 'reopened', opportunityId: oppId };
    }
    if (rule === 'NEW_OPPORTUNITY') {
      const newOppId = await createNewOpportunity({ companyId, existingLeadId, source, supabase });
      if (newOppId) await insertReentryEvent({ supabase, companyId, opportunityId: newOppId, metadata: eventMetadata });
      return { action: 'new_opportunity', opportunityId: newOppId };
    }
    await insertReentryEvent({ supabase, companyId, opportunityId: oppId, metadata: eventMetadata });
    return { action: 'event_only', opportunityId: oppId };
  }

  if (status === 'open') {
    const rule = rules.open || 'EVENT_ONLY';
    if (rule === 'RESET_PIPELINE') {
      await resetPipeline({ supabase, companyId, oppId });
      await insertReentryEvent({ supabase, companyId, opportunityId: oppId, metadata: eventMetadata });
      return { action: 'reset_pipeline', opportunityId: oppId };
    }
    if (rule === 'NEW_OPPORTUNITY') {
      const newOppId = await createNewOpportunity({ companyId, existingLeadId, source, supabase });
      if (newOppId) await insertReentryEvent({ supabase, companyId, opportunityId: newOppId, metadata: eventMetadata });
      return { action: 'new_opportunity', opportunityId: newOppId };
    }
    if (rule === 'IGNORE') {
      return { action: 'ignored', opportunityId: oppId };
    }
    await insertReentryEvent({ supabase, companyId, opportunityId: oppId, metadata: eventMetadata });
    return { action: 'event_only', opportunityId: oppId };
  }

  return { action: 'unknown_status', opportunityId: oppId };
}

/** Insere evento lead_reentry na opportunity_stage_history */
async function insertReentryEvent({ supabase, companyId, opportunityId, metadata }) {
  const { data: pos } = await supabase
    .from('opportunity_funnel_positions')
    .select('funnel_id, stage_id')
    .eq('opportunity_id', opportunityId)
    .single();

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('opportunity_stage_history')
    .insert({
      company_id: companyId,
      opportunity_id: opportunityId,
      funnel_id: pos?.funnel_id ?? null,
      from_stage_id: pos?.stage_id ?? null,
      to_stage_id: pos?.stage_id ?? null,
      stage_entered_at: now,
      stage_left_at: now,
      moved_by: null,
      move_type: 'lead_reentry',
      metadata,
    });

  if (error) {
    console.error('[handleLeadReentry] Erro ao inserir lead_reentry:', error.message);
  }
}

/** Reabre opportunity via RPC reopen_opportunity (move_type 'reopened' inserido pela RPC) */
async function reopenOpportunity({ supabase, companyId, oppId }) {
  const { data: pos } = await supabase
    .from('opportunity_funnel_positions')
    .select('funnel_id')
    .eq('opportunity_id', oppId)
    .single();

  if (!pos?.funnel_id) {
    console.warn('[handleLeadReentry] Sem funnel_id para reopen:', oppId);
    return;
  }

  const { data: firstStage } = await supabase
    .from('funnel_stages')
    .select('id')
    .eq('funnel_id', pos.funnel_id)
    .order('position', { ascending: true })
    .limit(1)
    .single();

  if (!firstStage?.id) {
    console.warn('[handleLeadReentry] Sem stage para reopen:', oppId);
    return;
  }

  const { error } = await supabase.rpc('reopen_opportunity', {
    p_opportunity_id: oppId,
    p_company_id: companyId,
    p_funnel_id: pos.funnel_id,
    p_to_stage_id: firstStage.id,
    p_position_in_stage: 0,
  });

  if (error) {
    console.error('[handleLeadReentry] Erro ao reopen_opportunity:', error.message);
  }
}

/** Move opportunity para a primeira etapa ativa do funil (RESET_PIPELINE, status open) */
async function resetPipeline({ supabase, companyId: _companyId, oppId }) {
  const { data: pos } = await supabase
    .from('opportunity_funnel_positions')
    .select('funnel_id, stage_id')
    .eq('opportunity_id', oppId)
    .single();

  if (!pos?.funnel_id) return;

  const { data: firstStage } = await supabase
    .from('funnel_stages')
    .select('id')
    .eq('funnel_id', pos.funnel_id)
    .order('position', { ascending: true })
    .limit(1)
    .single();

  if (!firstStage?.id) return;

  // move_opportunity: p_opportunity_id, p_funnel_id, p_from_stage_id, p_to_stage_id, p_position_in_stage
  const { error } = await supabase.rpc('move_opportunity', {
    p_opportunity_id: oppId,
    p_funnel_id: pos.funnel_id,
    p_from_stage_id: pos.stage_id,
    p_to_stage_id: firstStage.id,
    p_position_in_stage: 0,
  });

  if (error) {
    console.error('[handleLeadReentry] Erro ao move_opportunity (reset):', error.message);
  }
}

/** Cria nova opportunity para o lead original e a posiciona no funil padrão */
async function createNewOpportunity({ companyId, existingLeadId, source, supabase }) {
  let { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!funnel) {
    const { data: fallback } = await supabase
      .from('sales_funnels')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    funnel = fallback;
  }

  const now = new Date().toISOString();
  const { data: newOpp, error: oppError } = await supabase
    .from('opportunities')
    .insert({
      lead_id: existingLeadId,
      company_id: companyId,
      title: 'Nova Oportunidade',
      status: 'open',
      source: source || 'webhook',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (oppError || !newOpp) {
    console.error('[handleLeadReentry] Erro ao criar nova opportunity:', oppError?.message);
    return null;
  }

  if (funnel?.id) {
    const { data: firstStage } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', funnel.id)
      .order('position', { ascending: true })
      .limit(1)
      .single();

    if (firstStage?.id) {
      await supabase.from('opportunity_funnel_positions').insert({
        lead_id: existingLeadId,
        opportunity_id: newOpp.id,
        funnel_id: funnel.id,
        stage_id: firstStage.id,
        position_in_stage: 0,
        entered_stage_at: now,
        updated_at: now,
      });
    }
  }

  return newOpp.id;
}

// =============================================================================
// api/lib/agents/agentExecutor.js
//
// AgentExecutor — Etapa 7 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Transformar o ContextBuilderOutput em AgentRunContext, executar o LLM via
//   runner.ts e registrar a execução em ai_agent_execution_logs.
//   Não envia mensagens. Não quebra resposta em blocos. Não acessa WhatsApp.
//
// FLUXO:
//   1. Validar campos essenciais do ContextBuilderOutput
//   2. Validar que user_message não está vazio (evita LLM com mensagem vazia)
//   3. Montar extra_context (histórico + memória + contato + catálogo)
//   4. Chamar runner.runAgentWithConfig() — LLM executa aqui
//   5. Extrair bloco <!-- mem --> da resposta (extractMemoryBlock)
//   6. Persistir memória atualizada (writeMemory — fire-and-forget)
//   7. Registrar execução em ai_agent_execution_logs (fire-and-forget)
//   8. Retornar AgentExecutorOutput com resposta limpa (sem bloco de memória)
//
// MEMÓRIA CONVERSACIONAL:
//   Armazenada em chat_conversations.memory (JSONB).
//   Escrita EXCLUSIVAMENTE por este módulo — nunca por webhooks ou APIs externas.
//   source='llm_extraction' é validado em writeMemory como barreira runtime.
//
// INTEGRAÇÃO COM runner.ts:
//   Usa runAgentWithConfig() — nova exportação que bypassa resolveAgent().
//   O agente já vem resolvido no ContextBuilderOutput (buscado pelo ContextBuilder).
//   O use_id 'chat:conversational_agent:whatsapp' é usado apenas para rastreabilidade.
//
// LOGGING:
//   Insere diretamente em ai_agent_execution_logs com os campos conversacionais
//   (conversation_id, session_id, assignment_id, rule_id) que writeExecutionLog()
//   do logger.ts não suporta. Fire-and-forget — nunca bloqueia o fluxo.
//
// RETORNO:
//   { success: true, output: AgentExecutorOutput }   → ResponseComposer (Etapa 8)
//   { success: false, skip_reason: string }           → abort silencioso
//   { success: false, skip_reason: 'error', error }   → falha inesperada
//
// MULTI-TENANT:
//   company_id revalidado internamente. Nunca confia apenas no ContextBuilderOutput.
// =============================================================================

import { createClient }         from '@supabase/supabase-js';
import { runAgentWithConfig }   from './runner.js';
import { evaluateTransition }   from './flowOrchestrator.js';
import { buildPromptFromConfig } from './promptTemplate.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const USE_ID = 'chat:conversational_agent:whatsapp';

/** Limites de truncamento para economia de tokens no extra_context */
const MAX_DESCRIPTION_CHARS  = 300;
const MAX_AI_NOTES_CHARS     = 200;

/** Máximo de itens na lista compacta (sem item em foco) */
const MAX_COMPACT_LIST_ITEMS = 15;

// ── Billing de créditos de IA ─────────────────────────────────────────────────
// Helpers isolados. Nunca bloqueiam o fluxo de execução do agente.
// O débito é fire-and-forget — falhas são logadas e absorvidas silenciosamente.

/** 1.000 tokens = 100 créditos base, ajustados por multiplicador de feature */
const CREDIT_RATE = 100;

/**
 * Multiplicadores por feature. DO NOT CHANGE: alinhado com debit_credits_atomic.
 * whatsapp = 1x  (canal principal)
 * insights = 6x  (operação intensiva de processamento)
 */
const FEATURE_MULTIPLIERS = { whatsapp: 1, insights: 6 };

/**
 * Resolve a feature de billing a partir do canal de execução.
 * Retorna null para canais sem billing (sandbox, test, etc.) — débito não ocorre.
 */
function resolveFeatureType(channel) {
  if (channel === 'whatsapp') return 'whatsapp';
  if (channel === 'insights')  return 'insights';
  return null;
}

/**
 * Calcula créditos a debitar.
 * Fórmula: ceil((totalTokens / 1000) * CREDIT_RATE * multiplier)
 * Retorna 0 para tokens inválidos ou feature sem multiplicador definido.
 */
function calculateCredits(totalTokens, featureType) {
  if (!totalTokens || totalTokens <= 0) return 0;
  const multiplier = FEATURE_MULTIPLIERS[featureType] ?? 0;
  if (multiplier === 0) return 0;
  return Math.ceil((totalTokens / 1000) * CREDIT_RATE * multiplier);
}

/**
 * Chama debit_credits_atomic via RPC.
 * Fire-and-forget — nunca propaga exceção para o caller.
 *
 * Tratamento de retorno:
 *   ok: true             → débito registrado com sucesso
 *   ok: true, idempotent → retry detectado — ignorar silenciosamente
 *   ok: false            → saldo insuficiente — logar aviso
 *   error Supabase       → falha de RPC — logar e absorver
 */
async function debitCredits(svc, { companyId, credits, featureType, totalTokens, model, executionLogId }) {
  if (!svc || !companyId) return;
  try {
    const { data, error } = await svc.rpc('debit_credits_atomic', {
      p_company_id:       companyId,
      p_credits:          credits,
      p_feature_type:     featureType,
      p_total_tokens:     totalTokens ?? 0,
      p_model:            model       ?? null,
      p_execution_log_id: executionLogId ?? null,
    });

    if (error) {
      console.error('[BILLING] Falha ao chamar debit_credits_atomic:', { company_id: companyId, error: error.message });
      return;
    }

    if (data?.idempotent) return; // retry detectado — comportamento correto, ignorar

    if (data?.ok === false) {
      console.warn('[BILLING] Saldo de créditos insuficiente:', {
        company_id:   companyId,
        feature_type: featureType,
        credits,
        balance:      data.balance,
      });
      return;
    }

    console.log('[BILLING] Débito registrado:', {
      company_id:    companyId,
      credits,
      feature_type:  featureType,
      balance_after: data?.balance_after,
    });
  } catch (err) {
    // Nunca deixar falha de billing quebrar o fluxo de execução
    console.error('[BILLING] Exceção ao debitar créditos (silencioso):', err.message);
  }
}

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url.trim() || !key.trim()) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Executa o agente de conversação para um ContextBuilderOutput.
 *
 * @param {object} output - ContextBuilderOutput do ContextBuilder (Etapa 6)
 * @returns {{ success: boolean, output?: AgentExecutorOutput, skip_reason?: string, error?: string }}
 */
export async function executeAgent(output) {
  const startMs = Date.now();

  // ── Validação de campos essenciais ───────────────────────────────────────────
  // Revalidar company_id — não confiar cegamente no ContextBuilderOutput
  const companyId = output?.metadata?.company_id;
  if (!companyId) {
    console.error('🤖 [EXEC] ❌ company_id ausente no ContextBuilderOutput');
    return { success: false, skip_reason: 'error', error: 'missing_company_id' };
  }

  if (!output?.agent?.id || !output?.agent?.prompt === undefined) {
    console.error('🤖 [EXEC] ❌ Configuração do agente ausente no ContextBuilderOutput');
    return { success: false, skip_reason: 'error', error: 'missing_agent_config' };
  }

  // Validar user_message — LLM não deve receber mensagem vazia
  const userMessage = output.user_message?.trim();
  if (!userMessage) {
    console.warn('🤖 [EXEC] ⏭️  user_message vazio — abortando execução');
    return { success: false, skip_reason: 'empty_user_message' };
  }

  // ── Montar extra_context ─────────────────────────────────────────────────────
  const extraContext = buildExtraContext(output);

  // ── Montar AgentRunContext ───────────────────────────────────────────────────
  const agentRunCtx = {
    userMessage,
    extra_context: extraContext,
    // Diretriz global de governança — injetada no topo do system prompt pelo runner
    // NUNCA logada, NUNCA exposta em responses ou debug
    system_policy: output.system_policy ?? undefined,
    company_id:    companyId,
    channel:       'whatsapp',
    user_id:       undefined, // sem sessão de usuário humano neste fluxo
    entity_type:   output.contact?.lead_id ? 'lead' : undefined,
    entity_id:     output.contact?.lead_id ? String(output.contact.lead_id) : undefined,
    // Contexto para toolExecutor — IDs de recursos validados pelo backend
    lead_id:              output.contact?.lead_id ? String(output.contact.lead_id) : null,
    conversation_id:      output.conversation?.id ?? null,
    locked_opportunity_id: output.locked_opportunity_id ?? null, // Phase 3: vem do flow state
    item_of_interest:      output.item_of_interest ?? null,
    model_config:          output.agent?.model_config ?? {},
  };

  console.log('🤖 [EXEC] 🚀 Chamando runner.runAgentWithConfig:', {
    run_id:          output.run_id,
    agent_id:        output.agent.id,
    model:           output.agent.model,
    knowledge_mode:  output.agent.knowledge_mode,
    extra_ctx_length: extraContext.length,
    user_msg_length:  userMessage.length,
    company_id:      companyId
  });

  // ── Resolver prompt via prompt_config (se disponível) ────────────────────────
  // Se o agente tem prompt_config JSONB, monta o prompt a partir do template
  // estruturado + dados live da empresa. Caso contrário, usa agent.prompt raw.
  // Fallback garantido: buildPromptFromConfig retorna null em caso de falha.
  let agentForRunner = output.agent;

  if (output.agent.prompt_config) {
    const builtPrompt = buildPromptFromConfig(
      output.agent.prompt_config,
      output.company_data ?? null
    );

    if (builtPrompt) {
      agentForRunner = { ...output.agent, prompt: builtPrompt };
    } else {
      console.warn('[PROMPT:config-invalid-fallback]', {
        agent_id:   output.agent.id,
        company_id: companyId,
        fallback:   'using agent.prompt raw',
      });
    }
  }

  // ── Executar LLM ─────────────────────────────────────────────────────────────
  let runResult;
  try {
    runResult = await runAgentWithConfig(agentForRunner, USE_ID, agentRunCtx);
  } catch (runError) {
    console.error('🤖 [EXEC] ❌ Exceção propagada do runner:', runError.message);
    // Log de falha (fire-and-forget)
    void writeConversationalLog(getServiceSupabase(), {
      output,
      status:       'error_openai',
      error_code:   'openai_execution_failed',
      duration_ms:  Date.now() - startMs
    });
    return { success: false, skip_reason: 'error', error: runError.message };
  }

  const duration_ms = Date.now() - startMs;

  // ── Tratar resultado ─────────────────────────────────────────────────────────
  if (!runResult.ok) {
    const errorCode = runResult.errorCode ?? 'openai_execution_failed';

    console.error('🤖 [EXEC] ❌ runner retornou ok=false:', {
      errorCode,
      run_id:      output.run_id,
      agent_id:    output.agent.id,
      company_id:  companyId
    });

    void writeConversationalLog(getServiceSupabase(), {
      output,
      runResult,
      status:      'error_openai',
      error_code:  errorCode,
      duration_ms
    });

    return { success: false, skip_reason: errorCode };
  }

  // ── Extrair bloco de memória da resposta bruta ───────────────────────────────
  // extractMemoryBlock remove o <!-- mem --> do texto antes de enviar ao lead.
  // A resposta limpa vai para executorOutput.raw_response → responseComposer.
  const { cleanResponse, memoryPayload, extractionResult, validationError } =
    extractMemoryBlock(runResult.result ?? '');

  console.log('[MEM] extraction:', {
    run_id:           output.run_id,
    conversation_id:  output.conversation?.id,
    company_id:       companyId,
    result:           extractionResult,
    validation_error: validationError ?? null,
    had_existing:     Boolean(output.conversation_memory?.summary),
  });

  // ── Log de sucesso (fire-and-forget) ─────────────────────────────────────────
  void writeConversationalLog(getServiceSupabase(), {
    output,
    runResult,
    status:     'success',
    duration_ms
  });

  console.log('🤖 [EXEC] ✅ LLM executado com sucesso:', {
    run_id:          output.run_id,
    agent_id:        output.agent.id,
    response_length: cleanResponse.length,
    input_tokens:    runResult.input_tokens,
    output_tokens:   runResult.output_tokens,
    duration_ms,
    company_id:      companyId
  });

  // ── Persistir memória (fire-and-forget) ──────────────────────────────────────
  // Só executa se extraction foi bem-sucedida.
  // source='llm_extraction' é validado dentro de writeMemory como barreira runtime.
  if (memoryPayload && output.conversation?.id) {
    const svcForMemory = getServiceSupabase();
    const conversationId = output.conversation.id;
    const existingMemory = output.conversation_memory ?? null;
    const recentMessages = output.conversation?.recent_messages ?? [];

    void writeMemory(svcForMemory, conversationId, companyId, memoryPayload, existingMemory, recentMessages, 'llm_extraction')
      .then(result => {
        console.log('[MEM] write:', {
          run_id:            output.run_id,
          conversation_id:   conversationId,
          company_id:        companyId,
          result:            result.ok ? 'saved' : result.reason,
          interaction_count: result.interaction_count ?? null,
        });
      })
      .catch(err => {
        console.error('[MEM] write error (silencioso):', err.message);
      });
  }

  // ── Avaliar transição de fluxo (Phase 3 — fire-and-forget) ──────────────────
  // Executado após o LLM responder. Não bloqueia o retorno ao lead.
  if (output.conversation?.id && companyId) {
    const toolResults = runResult.tool_results ?? []
    void evaluateTransition(
      output.conversation.id,
      companyId,
      toolResults,
      { lead_id: output.contact?.lead_id ? String(output.contact.lead_id) : null }
    ).catch(err => {
      console.error('[EXEC] Erro ao avaliar transição de fluxo:', err.message)
    })
  }

  // ── Montar AgentExecutorOutput ───────────────────────────────────────────────
  const executorOutput = {
    run_id:       output.run_id,
    session_id:   output.session_id,
    raw_response: cleanResponse,  // resposta limpa — bloco <!-- mem --> já removido
    agent_id:     output.agent.id,
    ok:           true,
    fallback:     false,
    metadata: {
      company_id:      companyId,
      assignment_id:   output.metadata.assignment_id,
      conversation_id: output.conversation.id,
      flow_state_id:   output.metadata.flow_state_id ?? null
    }
  };

  return { success: true, output: executorOutput };
}

// ── Montagem do extra_context ─────────────────────────────────────────────────

/**
 * Monta o extra_context como string formatada para o LLM.
 *
 * Seções incluídas apenas quando não vazias:
 *   1. Histórico da conversa (últimas N mensagens)
 *   2. Informações do contato
 *   3. Produtos disponíveis
 *   4. Serviços disponíveis
 *
 * Regras:
 *   - direction='inbound'  → prefixo [CONTATO]
 *   - direction='outbound' → prefixo [AGENTE]
 *   - default_price=null   → preço omitido (ContextBuilder removeu quando proibido)
 *   - ai_notes/description truncados para economia de tokens
 */
function buildExtraContext(output) {
  const sections = [];

  // ── 0. Memória conversacional — sempre antes do histórico ────────────────
  // Injetada apenas quando summary existe. Conversas novas (sem memória) não
  // recebem a seção, preservando comportamento original.
  const memorySection = buildMemorySection(output.conversation_memory);
  if (memorySection) {
    sections.push(memorySection);
  }


  // ── 1. Histórico da conversa ─────────────────────────────────────────────
  const messages = output.conversation?.recent_messages ?? [];
  if (messages.length > 0) {
    const lines = messages.map(m => {
      const prefix = m.direction === 'inbound' ? '[CONTATO]' : '[AGENTE]';
      return `${prefix}: ${m.content}`;
    });
    sections.push(`Histórico da conversa (últimas ${messages.length} mensagens):\n${lines.join('\n')}`);
  }

  // ── 2. Informações do contato ────────────────────────────────────────────
  const contact = output.contact;
  if (contact) {
    const contactLines = [
      `Nome: ${contact.name ?? '(não identificado)'}`,
      contact.phone ? `Telefone: ${contact.phone}` : null,
    ].filter(Boolean);
    sections.push(`Informações do contato:\n${contactLines.join('\n')}`);
  }

  // ── 3–5. Comportamento exclusivo — hierarquia: COMPARAÇÃO > RECOMENDAÇÃO > FALLBACK
  //
  // Apenas UM comportamento é ativado por turno.
  // A decisão é tomada em cascata: o primeiro ramo que atende aos critérios
  // é executado e os demais são ignorados.
  //
  // Mapa de decisão:
  //   COMPARAÇÃO   → isComparison + 2 candidatos
  //   RECOMENDAÇÃO → candidatos ≥ 2 (sem intenção de comparação) + memória
  //   DESAMBIGUAÇÃO→ candidatos ≥ 2 (sem intenção de comparação) + sem memória
  //   ITEM EM FOCO → item único identificado
  //   FALLBACK     → nenhum item + sem candidatos + sem memória
  //   LISTA COMPACTA→ nenhum item + sem candidatos + com memória (agente guia naturalmente)

  const itemOfInterest      = output.item_of_interest ?? null;
  const ambiguousCandidates = output.ambiguous_candidates ?? [];
  const isComparison        = output.is_comparison === true;
  const hasMemory           = hasUsableMemory(output.conversation_memory);

  if (isComparison && ambiguousCandidates.length === 2) {
    // ── COMPARAÇÃO ───────────────────────────────────────────────────────────
    // Lead indicou intenção de comparar dois itens.
    // O agente explica cada item, destaca diferenças e conduz à escolha.
    // Recomendação NÃO é adicionada — comparação é o comportamento exclusivo.
    sections.push(formatComparisonContext(ambiguousCandidates));
    console.log('[CTX:behavior]', { mode: 'comparison', candidates: ambiguousCandidates.map(i => i.name) });

  } else if (ambiguousCandidates.length > 1 && hasStrongContext(output.conversation_memory)) {
    // ── RECOMENDAÇÃO ─────────────────────────────────────────────────────────
    // Há múltiplos candidatos E contexto FORTE na memória (objetivo/perfil/experiência).
    // O agente usa o perfil do lead para sugerir o item mais adequado.
    // Lista de candidatos é exibida como âncora + instrução de recomendação.
    sections.push(formatAmbiguousCandidates(ambiguousCandidates));
    sections.push(formatRecommendationInstruction(ambiguousCandidates));
    console.log('[CTX:behavior]', {
      mode:        'recommendation',
      candidates:  ambiguousCandidates.map(i => i.name),
      has_summary: Boolean(output.conversation_memory?.summary),
      facts_count: Object.keys(output.conversation_memory?.facts ?? {}).length,
    });

  } else if (ambiguousCandidates.length > 1) {
    // ── DESAMBIGUAÇÃO ────────────────────────────────────────────────────────
    // Há múltiplos candidatos mas sem memória suficiente para recomendar.
    // O agente pergunta qual item o lead quer conhecer melhor.
    sections.push(formatAmbiguousCandidates(ambiguousCandidates));
    console.log('[CTX:behavior]', { mode: 'disambiguation', candidates: ambiguousCandidates.map(i => i.name) });

  } else if (itemOfInterest) {
    // ── ITEM EM FOCO ─────────────────────────────────────────────────────────
    // Um único item foi identificado — exibe seção detalhada com ai_notes.
    sections.push(formatItemInFocus(itemOfInterest));
    console.log('[CTX:behavior]', { mode: 'item_focus', item: itemOfInterest.name });

  } else if (!hasMemory) {
    // ── FALLBACK ─────────────────────────────────────────────────────────────
    // Sem item, sem candidatos e sem memória. O agente não tem base suficiente.
    // Exibe lista compacta como referência + instrução para fazer 1 pergunta estratégica.
    const compactItems = [...(output.catalog?.products ?? []), ...(output.catalog?.services ?? [])]
      .slice(0, MAX_COMPACT_LIST_ITEMS);
    if (compactItems.length > 0) {
      sections.push(`Produtos e serviços disponíveis:\n${compactItems.map(i => formatCatalogItemCompact(i)).join('\n')}`);
    }
    sections.push(formatFallbackInstruction());
    console.log('[CTX:behavior]', { mode: 'fallback' });

  } else {
    // ── LISTA COMPACTA (com memória) ─────────────────────────────────────────
    // Sem item específico, mas com memória disponível.
    // O agente conduz naturalmente usando o contexto da conversa.
    const compactItems = [...(output.catalog?.products ?? []), ...(output.catalog?.services ?? [])]
      .slice(0, MAX_COMPACT_LIST_ITEMS);
    if (compactItems.length > 0) {
      sections.push(`Produtos e serviços disponíveis:\n${compactItems.map(i => formatCatalogItemCompact(i)).join('\n')}`);
    }
    console.log('[CTX:behavior]', { mode: 'catalog_list_with_memory' });
  }

  return sections.join('\n\n');
}

// =============================================================================
// MEMÓRIA CONVERSACIONAL
// =============================================================================
//
// Único ponto de escrita: writeMemory(source='llm_extraction')
// Nunca chamado por webhooks, APIs externas ou integrações.
//
// Pipeline: extractMemoryBlock → validateMemoryPayload → sanitizeFacts
//           → writeMemory (merge inteligente) → UPDATE chat_conversations.memory
//
// Leitura: buildMemorySection formata o bloco [MEMÓRIA] para o extra_context.
//          safeMemoryForPrompt sanitiza antes de injetar no prompt.
// =============================================================================

// ── Constantes de memória ─────────────────────────────────────────────────────

const MEM_SUMMARY_MAX_CHARS    = 300;
const MEM_FACTS_MAX_KEYS       = 10;
const MEM_FACTS_KEY_MAX_CHARS  = 60;
const MEM_FACTS_VAL_MAX_CHARS  = 200;
const MEM_LIST_MAX_ITEMS       = 3;
const MEM_LIST_ITEM_MAX_CHARS  = 80;
const MEM_STAGE_MAX_CHARS      = 40;
const MEM_TOTAL_MAX_BYTES      = 8192;
const MEM_PROMPT_MAX_CHARS     = 1200;  // limite total do bloco [MEMÓRIA] no prompt

const STALE_DAYS_WARN    = 7;   // a partir de X dias: mostrar "Última interação: N dias"
const STALE_DAYS_SOFT    = 30;  // a partir de X dias: avisar que contexto pode estar desatualizado
const STALE_DAYS_HARD    = 90;  // a partir de X dias: suprimir listas semânticas do prompt

// ── safeMemoryForPrompt ───────────────────────────────────────────────────────

/**
 * Sanitiza e limita a memória antes de injetar no prompt.
 * Remove campos desconhecidos, estruturas profundas, dados inválidos.
 * Garante formato consistente e limite total de caracteres.
 *
 * Retorna null se memória não tiver summary válido.
 */
function safeMemoryForPrompt(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return null;
  if (!memory.summary || typeof memory.summary !== 'string' || !memory.summary.trim()) return null;

  const ageDays = computeAgeDays(memory.last_interaction_at);
  const isVeryStale = ageDays !== null && ageDays > STALE_DAYS_HARD;

  // Campos permitidos — estrutura explícita, sem campos desconhecidos
  return {
    summary:           String(memory.summary).slice(0, MEM_SUMMARY_MAX_CHARS),
    facts:             safeFacts(memory.facts),
    intents:           isVeryStale ? [] : safeList(memory.intents),
    objections:        isVeryStale ? [] : safeList(memory.objections),
    open_loops:        isVeryStale ? [] : safeList(memory.open_loops),
    conversation_stage: typeof memory.conversation_stage === 'string'
      ? memory.conversation_stage.slice(0, MEM_STAGE_MAX_CHARS)
      : 'prospecto',
    last_interaction_at: memory.last_interaction_at ?? null,
    interaction_count:   typeof memory.interaction_count === 'number' ? memory.interaction_count : 0,
  };
}

function safeFacts(facts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return {};
  const safe = {};
  let count = 0;
  for (const [k, v] of Object.entries(facts)) {
    if (count >= MEM_FACTS_MAX_KEYS) break;
    if (typeof k !== 'string' || k.length === 0 || k.length > MEM_FACTS_KEY_MAX_CHARS) continue;
    if (typeof v !== 'string' || v.length === 0 || v.length > MEM_FACTS_VAL_MAX_CHARS) continue;
    safe[k] = v;
    count++;
  }
  return safe;
}

function safeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(i => typeof i === 'string' && i.length > 0 && i.length <= MEM_LIST_ITEM_MAX_CHARS)
    .slice(0, MEM_LIST_MAX_ITEMS);
}

function computeAgeDays(lastInteractionAt) {
  if (!lastInteractionAt) return null;
  try {
    const diff = Date.now() - new Date(lastInteractionAt).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

// ── buildMemorySection ────────────────────────────────────────────────────────

/**
 * Formata a memória como bloco [MEMÓRIA] para o extra_context.
 * Retorna null quando não há summary (conversas novas não recebem o bloco).
 */
function buildMemorySection(rawMemory) {
  const memory = safeMemoryForPrompt(rawMemory);
  if (!memory) return null;

  const ageDays = computeAgeDays(memory.last_interaction_at);
  const lines   = [];

  // Linha principal: summary
  lines.push(memory.summary);

  // Linha de open_loops (se houver e não muito velhos)
  if (memory.open_loops.length > 0) {
    lines.push(`Aguardando resposta: ${memory.open_loops.join(', ')}`);
  }

  // Linha de metadados
  const meta = [];
  if (memory.conversation_stage) meta.push(`Estágio: ${memory.conversation_stage}`);
  if (memory.interaction_count)  meta.push(`Interações: ${memory.interaction_count}`);

  if (ageDays !== null) {
    if (ageDays >= STALE_DAYS_HARD)    meta.push(`${ageDays} dias atrás — confirme informações relevantes`);
    else if (ageDays >= STALE_DAYS_SOFT) meta.push(`${ageDays} dias atrás — contexto pode estar desatualizado`);
    else if (ageDays >= STALE_DAYS_WARN) meta.push(`${ageDays} dia(s) atrás`);
  }

  if (meta.length > 0) lines.push(meta.join(' | '));

  const section = `[MEMÓRIA]\n${lines.join('\n')}`;

  // Hard cap de caracteres no prompt
  return section.slice(0, MEM_PROMPT_MAX_CHARS);
}

// ── extractMemoryBlock ────────────────────────────────────────────────────────

/**
 * Extrai e valida o bloco <!-- mem: {...} --> da resposta bruta do LLM.
 *
 * 3 camadas de validação:
 *   1. Presença do bloco (regex)
 *   2. Parse do JSON
 *   3. Validação estrutural mínima (validateMemoryPayload)
 *
 * Sempre retorna cleanResponse (resposta sem o bloco) mesmo em caso de falha.
 * memoryPayload é null quando qualquer camada falha.
 */
function extractMemoryBlock(rawResponse) {
  const match = rawResponse.match(/<!--\s*mem:\s*(\{[\s\S]*?\})\s*-->/i);

  const cleanResponse = match
    ? rawResponse.replace(match[0], '').trim()
    : rawResponse.trim();

  if (!match) {
    return { cleanResponse, memoryPayload: null, extractionResult: 'absent' };
  }

  // Camada 2: parse do JSON
  let parsed = null;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { cleanResponse, memoryPayload: null, extractionResult: 'invalid_json' };
  }

  // Camada 3: validação estrutural
  const validationError = validateMemoryPayload(parsed);
  if (validationError) {
    return { cleanResponse, memoryPayload: null, extractionResult: 'validation_failed', validationError };
  }

  return { cleanResponse, memoryPayload: parsed, extractionResult: 'success' };
}

// ── validateMemoryPayload ─────────────────────────────────────────────────────

/**
 * Valida a estrutura mínima do payload extraído do bloco <!-- mem -->.
 * Retorna null se válido, string de erro se inválido.
 *
 * Regra adicional (Ajuste 3): rejeita se summary vazio E facts vazio.
 * Ao menos um dos dois deve ter conteúdo útil.
 */
function validateMemoryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'not_object';

  // summary: string (aceita vazio em conversas iniciais, mas não ausente)
  if (payload.summary !== undefined && typeof payload.summary !== 'string') return 'summary_not_string';
  if (typeof payload.summary === 'string' && payload.summary.length > 400) return 'summary_too_long';

  // Regra: pelo menos summary não-vazio OU facts não-vazio
  const hasSummary = typeof payload.summary === 'string' && payload.summary.trim().length > 0;
  const hasFacts   = payload.facts && typeof payload.facts === 'object' && !Array.isArray(payload.facts) && Object.keys(payload.facts).length > 0;
  if (!hasSummary && !hasFacts) return 'empty_payload';

  // facts: objeto plano (se presente)
  if (payload.facts !== undefined) {
    if (typeof payload.facts !== 'object' || Array.isArray(payload.facts)) return 'facts_not_object';
    const entries = Object.entries(payload.facts);
    if (entries.length > 20) return 'facts_too_many_keys';
    for (const [k, v] of entries) {
      if (typeof k !== 'string' || k.length > MEM_FACTS_KEY_MAX_CHARS) return 'facts_key_too_long';
      if (typeof v !== 'string' || v.length > MEM_FACTS_VAL_MAX_CHARS) return 'facts_value_too_long';
    }
  }

  // Listas: arrays de strings curtas
  for (const field of ['intents', 'objections', 'open_loops']) {
    if (payload[field] === undefined) continue;
    if (!Array.isArray(payload[field])) return `${field}_not_array`;
    if (payload[field].length > 5) return `${field}_too_many_items`; // validação permissiva; writeMemory trunca para 3
    for (const item of payload[field]) {
      if (typeof item !== 'string' || item.length > MEM_LIST_ITEM_MAX_CHARS * 2) return `${field}_item_invalid`;
    }
  }

  // conversation_stage: string curta
  if (payload.conversation_stage !== undefined) {
    if (typeof payload.conversation_stage !== 'string' || payload.conversation_stage.length > MEM_STAGE_MAX_CHARS * 2) {
      return 'conversation_stage_invalid';
    }
  }

  return null; // válido
}

// ── sanitizeFacts ─────────────────────────────────────────────────────────────

/**
 * Anti-injection: filtra facts gerados pelo LLM.
 *
 * Aceita um fact novo se:
 *   a) o valor aparece nas mensagens recentes (grounded in conversation), OU
 *   b) a chave já existe na memória anterior (LLM carregou adiante dado válido)
 *
 * Rejeita:
 *   - chaves inválidas (não snake_case, muito longas)
 *   - valores não-string ou muito longos
 *   - dados que não aparecem na conversa nem na memória existente
 *
 * Facts existentes na memória anterior são preservados via merge em writeMemory.
 */
function sanitizeFacts(facts, recentMessages, existingFacts) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return {};

  const safeExisting = existingFacts && typeof existingFacts === 'object' ? existingFacts : {};

  // Texto completo das mensagens recentes para verificação de presença
  const messageText = (recentMessages ?? [])
    .map(m => (m.content ?? '').toLowerCase())
    .join(' ');

  const sanitized = {};
  let count = 0;

  for (const [key, value] of Object.entries(facts)) {
    if (count >= MEM_FACTS_MAX_KEYS) break;

    // Validação da chave: apenas caracteres alfanuméricos e underscore
    if (typeof key !== 'string' || key.length === 0 || key.length > MEM_FACTS_KEY_MAX_CHARS) continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;

    // Validação do valor
    if (typeof value !== 'string' || value.length === 0 || value.length > MEM_FACTS_VAL_MAX_CHARS) continue;

    // Anti-injection: aceitar se chave já existe na memória anterior
    const keyAlreadyExists = Object.prototype.hasOwnProperty.call(safeExisting, key);
    if (keyAlreadyExists) {
      sanitized[key] = value;
      count++;
      continue;
    }

    // Anti-injection: aceitar se parte do valor aparece nas mensagens recentes
    const valueSnippet = value.toLowerCase().slice(0, 8);
    const valueInMessages = messageText.length > 0 && valueSnippet.length >= 2 && messageText.includes(valueSnippet);
    if (valueInMessages) {
      sanitized[key] = value;
      count++;
      continue;
    }

    // Rejeitado: dado não encontrado na conversa nem na memória anterior
    if (messageText.length > 0) {
      console.warn('[MEM] sanitizeFacts: fact rejeitado (sem evidência):', {
        key,
        value_snippet: value.slice(0, 30),
      });
    }
  }

  return sanitized;
}

// ── writeMemory ───────────────────────────────────────────────────────────────

/**
 * Persiste a memória atualizada em chat_conversations.memory.
 *
 * ISOLAMENTO: source='llm_extraction' é o único valor aceito.
 * Qualquer outra origem é bloqueada em runtime com log de aviso.
 *
 * Estratégia de merge:
 *   - facts: merge aditivo (existingFacts + sanitizedNewFacts)
 *   - summary/intents/objections/open_loops/conversation_stage: overwrite (LLM tem visão atual)
 *   - interaction_count: sempre incrementado pelo código
 *   - last_interaction_at, updated_at: sempre sobrescritos pelo código
 *   - v: sempre 2
 *
 * Failsafe: se payload inválido, mantém existingMemory sem sobrescrever.
 */
async function writeMemory(svc, conversationId, companyId, memoryPayload, existingMemory, recentMessages, source) {
  // ── Barreira de origem — runtime guard ───────────────────────────────────────
  if (source !== 'llm_extraction') {
    console.warn('[MEM] write bloqueado — source inválido:', { source, conversation_id: conversationId, company_id: companyId });
    return { ok: false, reason: 'invalid_source' };
  }

  console.log('[MEM] write_source:', { source, conversation_id: conversationId });

  if (!memoryPayload || !conversationId || !companyId) {
    return { ok: false, reason: 'missing_args' };
  }

  if (!svc) {
    return { ok: false, reason: 'no_svc' };
  }

  const now         = new Date().toISOString();
  const safeExisting = existingMemory && typeof existingMemory === 'object' ? existingMemory : {};

  // ── Sanitizar facts antes do merge ───────────────────────────────────────────
  const rawFacts      = memoryPayload.facts && typeof memoryPayload.facts === 'object' ? memoryPayload.facts : {};
  const sanitizedFacts = sanitizeFacts(rawFacts, recentMessages, safeExisting.facts ?? {});

  // ── Merge inteligente ─────────────────────────────────────────────────────────
  // facts: preserva existentes, adiciona/atualiza novos sanitizados
  const mergedFacts = { ...(safeExisting.facts ?? {}), ...sanitizedFacts };

  const merged = {
    v:                   2,
    summary:             (memoryPayload.summary ?? safeExisting.summary ?? '').slice(0, MEM_SUMMARY_MAX_CHARS),
    facts:               mergedFacts,
    intents:             safeList(memoryPayload.intents    ?? safeExisting.intents    ?? []),
    objections:          safeList(memoryPayload.objections ?? safeExisting.objections ?? []),
    open_loops:          safeList(memoryPayload.open_loops ?? safeExisting.open_loops ?? []),
    conversation_stage:  (memoryPayload.conversation_stage ?? safeExisting.conversation_stage ?? 'prospecto').slice(0, MEM_STAGE_MAX_CHARS),
    interaction_count:   (typeof safeExisting.interaction_count === 'number' ? safeExisting.interaction_count : 0) + 1,
    last_interaction_at: now,
    updated_at:          now,
  };

  // ── Hard cap de tamanho (8 KB) ────────────────────────────────────────────────
  const serialized = JSON.stringify(merged);
  if (Buffer.byteLength(serialized, 'utf8') > MEM_TOTAL_MAX_BYTES) {
    // Estratégia de redução: manter apenas os 5 facts mais recentes
    const factEntries = Object.entries(mergedFacts).slice(-5);
    merged.facts = Object.fromEntries(factEntries);
    console.warn('[MEM] memory acima de 8KB — facts truncados para os 5 mais recentes:', {
      conversation_id: conversationId,
    });
  }

  // ── UPDATE — sempre filtra por id + company_id (multi-tenant) ────────────────
  const { error } = await svc
    .from('chat_conversations')
    .update({ memory: merged })
    .eq('id', conversationId)
    .eq('company_id', companyId);

  if (error) {
    console.error('[MEM] Falha ao persistir memória:', { conversationId, companyId, error: error.message });
    return { ok: false, reason: 'db_error', error: error.message };
  }

  return { ok: true, interaction_count: merged.interaction_count };
}

// ── Status helpers ────────────────────────────────────────────────────────────

const AVAILABILITY_LABELS = {
  available:    'disponível',
  unavailable:  'indisponível',
  on_demand:    'sob consulta',
  discontinued: 'descontinuado',
};

const STOCK_LABELS = {
  in_stock:     'em estoque',
  out_of_stock: 'sem estoque',
  low_stock:    'estoque baixo',
};

function formatPrice(price) {
  if (price == null) return null;
  try {
    return Number(price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch {
    return String(price);
  }
}

function categoryName(item) {
  // Supabase retorna catalog_categories como objeto { name: '...' } ou null
  return item.catalog_categories?.name ?? null;
}

/**
 * Formata o bloco de desambiguação quando múltiplos itens têm score similar.
 * O agente deve perguntar ao lead qual item deseja em vez de assumir.
 */
function formatAmbiguousCandidates(candidates) {
  const names = candidates.map(i => `- ${i.name}`).join('\n');
  return [
    `Possíveis itens de interesse:\n${names}`,
    `[Instrução] Há múltiplos itens que correspondem ao interesse do lead. Pergunte ao lead qual dos itens acima ele deseja saber mais. Não assuma automaticamente.`,
  ].join('\n\n');
}

// ── Recomendação baseada em perfil ────────────────────────────────────────────

/**
 * Retorna true quando a memória tem conteúdo mínimo utilizável:
 * summary não-vazio OU pelo menos 1 fact registrado.
 * Usado para distinguir fallback (sem memória) de lista compacta (com memória).
 */
function hasUsableMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return false;
  const hasSummary = typeof memory.summary === 'string' && memory.summary.trim().length > 0;
  const hasFacts   = memory.facts && typeof memory.facts === 'object'
    && !Array.isArray(memory.facts) && Object.keys(memory.facts).length > 0;
  return hasSummary || hasFacts;
}

// Chaves de facts que indicam contexto forte (objetivo, perfil, experiência do lead).
const STRONG_FACT_KEYS = ['objetivo', 'interesse_principal', 'experiencia'];

/**
 * Retorna true quando a memória tem contexto FORTE o suficiente para embasar
 * uma recomendação — não apenas contexto básico de presença.
 *
 * Critérios:
 *   a) facts contém ao menos uma das chaves fortes (objetivo, interesse_principal,
 *      experiencia) com valor não-vazio, OU
 *   b) summary tem ≥40 chars — indica intenção clara registrada pelo LLM
 *      (nome ou interação inicial geram summaries muito curtos)
 *
 * Exemplos que NÃO passam:
 *   - facts: { nome: "Márcio" }          → nenhuma chave forte
 *   - summary: "Primeira interação"       → < 40 chars
 *   - memory vazia                        → false
 *
 * Exemplos que PASSAM:
 *   - facts: { objetivo: "renda extra" }  → chave forte presente
 *   - summary: "Lead quer mudar de área e já tem experiência em elétrica"  → ≥40 chars
 */
function hasStrongContext(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return false;

  const facts = memory.facts;
  if (facts && typeof facts === 'object' && !Array.isArray(facts)) {
    const hasStrongFact = STRONG_FACT_KEYS.some(
      key => typeof facts[key] === 'string' && facts[key].trim().length > 0
    );
    if (hasStrongFact) return true;
  }

  // Summary com conteúdo suficiente → intenção clara registrada
  if (typeof memory.summary === 'string' && memory.summary.trim().length >= 40) {
    return true;
  }

  return false;
}

/**
 * Instrução de qualificação injetada quando não há contexto suficiente
 * para avançar: sem item identificado, sem candidatos e sem memória.
 * Orienta o agente a fazer UMA pergunta estratégica para coletar dados
 * que permitam comparação ou recomendação nos próximos turnos.
 */
function formatFallbackInstruction() {
  return [
    `[Instrução de Qualificação]\n` +
    `Não há informações suficientes sobre o objetivo do lead para avançar com segurança.`,

    `Em vez de responder genericamente:\n` +
    `- NÃO invente respostas\n` +
    `- NÃO faça recomendações sem base\n` +
    `- NÃO force decisão`,

    `Faça UMA pergunta estratégica para entender melhor o lead. A pergunta deve buscar identificar:\n` +
    `- objetivo principal\n` +
    `- nível de experiência na área\n` +
    `- motivação ou interesse específico`,

    `Regras:\n` +
    `- apenas 1 pergunta por vez\n` +
    `- pergunta simples e direta\n` +
    `- linguagem natural (estilo WhatsApp)\n` +
    `- evitar perguntas genéricas como "como posso ajudar?"\n` +
    `- não repetir pergunta já feita nesta conversa (verificar histórico acima)\n` +
    `- não mencionar que está coletando informações`,
  ].join('\n\n');
}

/**
 * Instrução dinâmica de recomendação injetada quando:
 *   - há 2 ou mais candidatos (comparação ou ambiguidade)
 *   - a memória tem contexto suficiente (summary ou facts)
 *
 * A recomendação é baseada no perfil do lead já presente em [MEMÓRIA].
 * Vem após o bloco de catálogo — complementa, não substitui, comparação/ambiguidade.
 */
function formatRecommendationInstruction(candidates) {
  const names = candidates.map(i => `- ${i.name}`).join('\n');

  return [
    `[Instrução de Recomendação]\nCom base no perfil e objetivos do lead já registrados em [MEMÓRIA], faça uma recomendação do item mais adequado entre:\n${names}`,

    `Regras:\n` +
    `- NÃO inventar informações — use apenas o que estiver na conversa ou na memória\n` +
    `- NÃO assumir com certeza absoluta — usar linguagem sugerida ("parece que", "faz mais sentido")\n` +
    `- Justificar brevemente o motivo da recomendação\n` +
    `- Conectar a recomendação ao objetivo já declarado pelo lead\n` +
    `- Manter tom consultivo, nunca agressivo`,

    `Estrutura da resposta:\n` +
    `1. Retomar brevemente o objetivo do lead (com base na memória)\n` +
    `2. Indicar o item mais adequado\n` +
    `3. Explicar o porquê (1–2 frases)\n` +
    `4. Finalizar com pergunta direcionada`,
  ].join('\n\n');
}

/**
 * Formata o bloco de comparação quando o lead está comparando dois itens.
 * Inclui dados básicos de cada item e instrução para conduzir a escolha.
 */
function formatComparisonContext(candidates) {
  const itemBlocks = candidates.map(item => {
    const lines = [`• ${item.name}`];

    if (item.description) {
      lines.push(`  ${truncate(item.description, MAX_DESCRIPTION_CHARS)}`);
    }

    if (item.ai_notes) {
      lines.push(`  [Orientação] ${truncate(item.ai_notes, MAX_AI_NOTES_CHARS)}`);
    }

    const availLabel = item.availability_status === 'available' ? null : item.availability_status;
    if (availLabel) lines.push(`  Disponibilidade: ${availLabel}`);

    return lines.join('\n');
  });

  return [
    `O lead está comparando os seguintes itens:\n\n${itemBlocks.join('\n\n')}`,
    `[Instrução] Responda comparando de forma simples:\n- o que cada um é\n- principais diferenças\n- para quem cada um é mais indicado\n\nFinalize ajudando o lead a escolher, com uma pergunta direcionada.`,
  ].join('\n\n');
}

/**
 * Formata um item em foco com seção detalhada:
 *   - Conteúdo público: nome, categoria, preço, status, estoque, descrição
 *   - Instruções internas: ai_notes (separadas, para o agente — não para o cliente)
 *   - Orientação de indisponibilidade: ai_unavailable_guidance (quando aplicável)
 */
function formatItemInFocus(item) {
  const publicLines = [`Produto em foco: ${item.name}`];

  const cat = categoryName(item);
  if (cat) publicLines.push(`Categoria: ${cat}`);

  const price = formatPrice(item.default_price);
  if (price) publicLines.push(`Preço: ${price}`);

  const availLabel = AVAILABILITY_LABELS[item.availability_status] ?? item.availability_status;
  if (availLabel) publicLines.push(`Disponibilidade: ${availLabel}`);

  const stockLabel = STOCK_LABELS[item.stock_status];
  if (stockLabel) publicLines.push(`Estoque: ${stockLabel}`);

  if (item.description) {
    publicLines.push(`Descrição: ${truncate(item.description, MAX_DESCRIPTION_CHARS)}`);
  }

  const result = [publicLines.join('\n')];

  // Instruções internas (ai_notes) — separadas do conteúdo público
  // O LLM usa para orientar a resposta, mas não reproduz literalmente ao cliente
  if (item.ai_notes) {
    result.push(`[Instrução interna — não compartilhar com o cliente]\n${truncate(item.ai_notes, MAX_AI_NOTES_CHARS)}`);
  }

  // Orientação de indisponibilidade
  if (item.availability_status !== 'available' && item.ai_unavailable_guidance) {
    result.push(`[Orientação de indisponibilidade]\n${truncate(item.ai_unavailable_guidance, MAX_AI_NOTES_CHARS)}`);
  }

  return result.join('\n\n');
}

/**
 * Formata um item na lista compacta (sem item em foco).
 * Apenas nome + categoria + status — sem descrição completa para economizar tokens.
 */
function formatCatalogItemCompact(item) {
  const parts = [`- ${item.name}`];

  const cat = categoryName(item);
  if (cat) parts.push(cat);

  const availLabel = AVAILABILITY_LABELS[item.availability_status];
  if (availLabel && item.availability_status !== 'available') parts.push(`(${availLabel})`);

  return parts.join(' · ');
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '…';
}

// ── Log conversacional direto em ai_agent_execution_logs ─────────────────────

/**
 * Insere log completo com campos conversacionais que writeExecutionLog() não suporta.
 * Fire-and-forget — nunca lança exceção para o caller.
 */
async function writeConversationalLog(svc, { output, runResult, status, error_code, duration_ms }) {
  if (!svc) return;

  try {
    // .select('id').single() captura o UUID gerado pelo banco para uso no billing.
    // Mudança mínima em relação ao insert original — sem impacto no restante do fluxo.
    const { data: logData, error: insertError } = await svc
      .from('ai_agent_execution_logs')
      .insert({
        use_id:              USE_ID,
        agent_id:            output.agent?.id   ?? null,
        consumer_company_id: output.metadata?.company_id ?? null,
        user_id:             null,                   // sem sessão de usuário humano
        channel:             'whatsapp',
        model:               output.agent?.model ?? null,
        knowledge_mode:      output.agent?.knowledge_mode ?? null,
        status,
        is_fallback:         false,                  // sem fallback no MVP conversacional
        duration_ms:         duration_ms ?? null,
        input_tokens:        runResult?.input_tokens  ?? null,
        output_tokens:       runResult?.output_tokens ?? null,
        total_tokens:        runResult?.total_tokens  ?? null,
        estimated_cost_usd:  runResult?.estimated_cost_usd ?? null,
        error_code:          error_code ?? null,
        // Campos conversacionais (migration 10 — Etapa 1):
        conversation_id:     output.conversation?.id ?? null,
        session_id:          output.session_id       ?? null,  // agent_conversation_sessions.id
        assignment_id:       output.metadata?.assignment_id ?? null,
        rule_id:             output.metadata?.rule_id ?? null,
      })
      .select('id')
      .single();

    if (insertError) {
      // Falha silenciosa — log nunca deve quebrar o executor
      console.error('🤖 [EXEC] ⚠️  Falha ao registrar log (silencioso):', insertError.message);
      return;
    }

    // ── Billing: debitar créditos após execução bem-sucedida ──────────────────
    // Fire-and-forget — nunca bloqueia o retorno ao lead.
    // Condições obrigatórias:
    //   1. status === 'success' — erros e fallbacks não geram débito
    //   2. logData?.id         — ID do log necessário para idempotência
    //   3. runResult?.total_tokens > 0 — débito zero não faz sentido
    if (status === 'success' && logData?.id && runResult?.total_tokens) {
      const featureType = resolveFeatureType('whatsapp'); // canal fixo neste executor
      if (featureType) {
        const credits = calculateCredits(runResult.total_tokens, featureType);
        if (credits > 0) {
          void debitCredits(svc, {
            companyId:      output.metadata?.company_id,
            credits,
            featureType,
            totalTokens:    runResult.total_tokens,
            model:          output.agent?.model ?? null,
            executionLogId: logData.id,
          });
        }
      }
    }
  } catch (logError) {
    // Falha silenciosa — log nunca deve quebrar o executor
    console.error('🤖 [EXEC] ⚠️  Falha ao registrar log (silencioso):', logError.message);
  }
}

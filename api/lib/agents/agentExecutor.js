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
//   3. Montar extra_context (histórico + contato + catálogo)
//   4. Chamar runner.runAgentWithConfig() — LLM executa aqui
//   5. Registrar execução em ai_agent_execution_logs (fire-and-forget)
//   6. Retornar AgentExecutorOutput
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

// ── Constantes ────────────────────────────────────────────────────────────────

const USE_ID = 'chat:conversational_agent:whatsapp';

/** Limites de truncamento para economia de tokens no extra_context */
const MAX_DESCRIPTION_CHARS = 300;
const MAX_AI_NOTES_CHARS    = 200;

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

  // ── Executar LLM ─────────────────────────────────────────────────────────────
  let runResult;
  try {
    runResult = await runAgentWithConfig(output.agent, USE_ID, agentRunCtx);
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
    response_length: runResult.result?.length ?? 0,
    input_tokens:    runResult.input_tokens,
    output_tokens:   runResult.output_tokens,
    duration_ms,
    company_id:      companyId
  });

  // ── Avaliar transição de fluxo (Phase 3 — fire-and-forget) ──────────────────
  // Executado após o LLM responder. Não bloqueia o retorno ao lead.
  // runResult.tool_results contém os resultados das tools executadas nesta rodada.
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
    raw_response: runResult.result,   // string única do LLM — ResponseComposer quebra em blocos
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

  // ── 3. Produtos disponíveis ──────────────────────────────────────────────
  const products = output.catalog?.products ?? [];
  if (products.length > 0) {
    const productLines = products.map(p => formatCatalogItem(p));
    sections.push(`Produtos disponíveis:\n${productLines.join('\n\n')}`);
  }

  // ── 4. Serviços disponíveis ──────────────────────────────────────────────
  const services = output.catalog?.services ?? [];
  if (services.length > 0) {
    const serviceLines = services.map(s => formatCatalogItem(s));
    sections.push(`Serviços disponíveis:\n${serviceLines.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Formata um item do catálogo (produto ou serviço) para o extra_context.
 * Campos opcionais incluídos apenas quando preenchidos.
 * description e ai_notes são truncados para economia de tokens.
 */
function formatCatalogItem(item) {
  const lines = [`- ${item.name}`];

  if (item.description) {
    const desc = truncate(item.description, MAX_DESCRIPTION_CHARS);
    lines.push(`  Descrição: ${desc}`);
  }

  // default_price é null quando can_inform_prices=false (ContextBuilder removeu)
  if (item.default_price != null) {
    const priceFormatted = Number(item.default_price).toLocaleString('pt-BR', {
      style:    'currency',
      currency: 'BRL'
    });
    lines.push(`  Preço: ${priceFormatted}`);
  }

  if (item.ai_notes) {
    const notes = truncate(item.ai_notes, MAX_AI_NOTES_CHARS);
    lines.push(`  Notas: ${notes}`);
  }

  if (item.availability_status && item.availability_status !== 'available') {
    const statusLabel = {
      unavailable:  'indisponível',
      on_demand:    'sob consulta',
      discontinued: 'descontinuado'
    }[item.availability_status] ?? item.availability_status;
    lines.push(`  Status: ${statusLabel}`);

    if (item.ai_unavailable_guidance) {
      const guidance = truncate(item.ai_unavailable_guidance, MAX_AI_NOTES_CHARS);
      lines.push(`  Instrução: ${guidance}`);
    }
  }

  return lines.join('\n');
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
    await svc.from('ai_agent_execution_logs').insert({
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
    });
  } catch (logError) {
    // Falha silenciosa — log nunca deve quebrar o executor
    console.error('🤖 [EXEC] ⚠️  Falha ao registrar log (silencioso):', logError.message);
  }
}

// =====================================================
// POST /api/agents/execute-agent
//
// Ponto de entrada do pipeline de execução do agente.
// Recebe RouterDecision e executa o pipeline completo:
//   Orchestrator → ContextBuilder → AgentExecutor → ResponseComposer → WhatsAppGateway
//
// ARQUITETURA (pós-correção Vercel):
//   Todas as etapas são executadas sequencialmente neste endpoint, sem HTTP
//   dispatch chain. Isso evita o problema de freeze do Vercel serverless onde
//   fetch() sem await é cancelado após res.end().
//
//   process-conversation-event → (await) → execute-agent [pipeline completo]
//
// FLUXO:
//   1. Validar RouterDecision recebida
//   2. Orchestrator: lock, revalidação de ai_state, sessão
//   3. ContextBuilder: histórico, contato, catálogo, capabilities
//   4. AgentExecutor: monta extra_context, chama runner.ts (LLM)
//   5. ResponseComposer: quebra raw_response em blocos
//   6. WhatsAppGateway: persiste + envia cada bloco via Uazapi
//   7. Responde 200 com status final
//
// ACESSO:
//   Chamado por process-conversation-event com await (não fire-and-forget).
//   Sem JWT de usuário — validar origin via secret header pós-MVP.
//
// TIMEOUT:
//   maxDuration: 60s configurado em vercel.json (pipeline pode levar ~30s com LLM)
//
// CORPO ESPERADO (RouterDecision):
//   {
//     should_process:       true,
//     skip_reason:          null,
//     rule_id:              UUID,
//     assignment_id:        UUID,
//     agent_id:             UUID,
//     capabilities:         { can_auto_reply, can_send_media, ... },
//     price_display_policy: 'disabled' | 'fixed_only' | ...,
//     conversation: {
//       id, ai_state, ai_assignment_id, contact_phone
//     },
//     event: {
//       event_type, channel, company_id, instance_id,
//       conversation_id, uazapi_message_id, source_type,
//       source_identifier, message_text, saved_message_id, timestamp
//     }
//   }
// =====================================================

import { createClient }          from '@supabase/supabase-js';
import { orchestrateExecution } from '../lib/agents/conversationOrchestrator.js';
import { buildContext }          from '../lib/agents/contextBuilder.js';
import { executeAgent }          from '../lib/agents/agentExecutor.js';
import { compose }               from '../lib/agents/responseComposer.js';
import { sendBlocks }            from '../lib/agents/whatsappGateway.js';
import { getPlanLimits }         from '../lib/plans/limitChecker.js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  // ── 1. Validação do RouterDecision ────────────────────────────────────────

  const decision = req.body;

  if (!decision || typeof decision !== 'object') {
    console.error('🤖 [EXECUTE] ❌ RouterDecision inválido ou ausente');
    return res.status(400).json({ success: false, error: 'RouterDecision inválido.' });
  }

  const requiredFields = ['assignment_id', 'agent_id', 'rule_id', 'conversation', 'event'];
  const missingFields  = requiredFields.filter(f => !decision[f]);

  if (missingFields.length > 0) {
    console.error('🤖 [EXECUTE] ❌ RouterDecision incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `RouterDecision incompleto: ${missingFields.join(', ')}`
    });
  }

  if (!decision.should_process) {
    console.warn('🤖 [EXECUTE] ⚠️  Recebeu RouterDecision com should_process = false — ignorando');
    return res.status(200).json({ success: true, status: 'skipped_by_router' });
  }

  const conversationId = decision.event?.conversation_id;
  const companyId      = decision.event?.company_id;

  // ── 1b. Validação de plano de IA (fail-closed) ────────────────────────────
  //
  // Verifica se a empresa possui plano de IA configurado (ai_plan_id) antes de
  // iniciar qualquer etapa do pipeline. Falha → bloqueia. Nunca fail-open.

  if (!companyId) {
    console.error('🤖 [EXECUTE] ❌ company_id ausente no evento — não é possível validar plano');
    return res.status(200).json({
      success: false,
      status:  'plan_validation_failed',
      error:   'company_id ausente — não foi possível validar o plano de IA',
      meta:    { conversation_id: conversationId }
    });
  }

  if (!SERVICE_ROLE_KEY) {
    console.error('🤖 [EXECUTE] ❌ SERVICE_ROLE_KEY ausente — não é possível validar plano');
    return res.status(200).json({
      success: false,
      status:  'plan_validation_failed',
      error:   'Configuração interna inválida — não foi possível validar o plano de IA',
      meta:    { conversation_id: conversationId }
    });
  }

  try {
    const limits = await getPlanLimits(supabaseAdmin, companyId);
    if (!limits.ai_plan_id) {
      console.warn('🤖 [EXECUTE] ⛔ Empresa sem plano de IA configurado — execução bloqueada:', { company_id: companyId });
      return res.status(200).json({
        success: false,
        status:  'no_ai_plan_configured',
        error:   'Empresa sem plano de IA configurado',
        meta:    { conversation_id: conversationId, company_id: companyId }
      });
    }
  } catch (planErr) {
    // Falha ao buscar plano → BLOQUEAR (fail-closed).
    console.error('🤖 [EXECUTE] ❌ Falha ao validar plano de IA — bloqueando execução:', planErr?.message);
    return res.status(200).json({
      success: false,
      status:  'plan_validation_failed',
      error:   'Não foi possível validar o plano de IA',
      meta:    { conversation_id: conversationId, company_id: companyId }
    });
  }

  // ── 2. Orchestrator ───────────────────────────────────────────────────────

  let orchestratorResult;

  try {
    orchestratorResult = await orchestrateExecution(decision);
  } catch (orchError) {
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do Orchestrator:', orchError.message);
    return res.status(200).json({
      success: false,
      status:  'orchestrator_exception',
      error:   orchError.message,
      meta:    { conversation_id: conversationId }
    });
  }

  if (!orchestratorResult.success) {
    const reason = orchestratorResult.skip_reason ?? 'unknown';
    const isExpectedSkip = ['skipped_lock_busy', 'ai_state_changed'].includes(reason);

    if (isExpectedSkip) {
      console.log(`🤖 [EXECUTE] ⏭️  Orchestrator skip (${reason}):`, { conversation_id: conversationId });
    } else {
      console.error(`🤖 [EXECUTE] ❌ Orchestrator falhou (${reason}):`, {
        error:           orchestratorResult.error,
        conversation_id: conversationId
      });
    }

    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { conversation_id: conversationId }
    });
  }

  const { context } = orchestratorResult;

  console.log('🤖 [EXECUTE] ✅ Orchestrator OK — iniciando ContextBuilder:', {
    run_id:          context.run_id,
    session_id:      context.session_id,
    conversation_id: conversationId
  });

  // ── 3. ContextBuilder ─────────────────────────────────────────────────────

  let buildResult;

  try {
    buildResult = await buildContext(context);
  } catch (buildError) {
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do ContextBuilder:', buildError.message);
    return res.status(200).json({
      success: false,
      status:  'context_builder_exception',
      error:   buildError.message,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  if (!buildResult.success) {
    const reason = buildResult.skip_reason ?? 'unknown';
    console.error(`🤖 [EXECUTE] ❌ ContextBuilder falhou (${reason}):`, {
      error:           buildResult.error,
      run_id:          context.run_id,
      conversation_id: conversationId
    });
    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  const contextOutput = buildResult.output;

  console.log('🤖 [EXECUTE] ✅ ContextBuilder OK — iniciando AgentExecutor:', {
    run_id:          contextOutput.run_id,
    messages_count:  contextOutput.conversation?.recent_messages?.length ?? 0,
    products_count:  contextOutput.catalog?.products?.length ?? 0,
    services_count:  contextOutput.catalog?.services?.length ?? 0,
    conversation_id: conversationId
  });

  // ── 4. AgentExecutor (LLM) ────────────────────────────────────────────────

  let execResult;

  try {
    execResult = await executeAgent(contextOutput);
  } catch (execError) {
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do AgentExecutor:', execError.message);
    return res.status(200).json({
      success: false,
      status:  'agent_executor_exception',
      error:   execError.message,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  if (!execResult.success) {
    const reason = execResult.skip_reason ?? 'unknown';
    console.error(`🤖 [EXECUTE] ❌ AgentExecutor falhou (${reason}):`, {
      error:           execResult.error,
      run_id:          context.run_id,
      conversation_id: conversationId
    });
    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  const executorOutput = execResult.output;

  console.log('🤖 [EXECUTE] ✅ AgentExecutor OK — iniciando ResponseComposer:', {
    run_id:               executorOutput.run_id,
    raw_response_length:  executorOutput.raw_response?.length ?? 0,
    conversation_id:      conversationId
  });

  // ── 5. ResponseComposer ───────────────────────────────────────────────────

  let composerResult;

  try {
    composerResult = compose(executorOutput);
  } catch (composeError) {
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do ResponseComposer:', composeError.message);
    return res.status(200).json({
      success: false,
      status:  'response_composer_exception',
      error:   composeError.message,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  if (!composerResult.success) {
    const reason = composerResult.skip_reason ?? 'unknown';
    console.error(`🤖 [EXECUTE] ❌ ResponseComposer falhou (${reason}):`, {
      error:           composerResult.error,
      run_id:          context.run_id,
      conversation_id: conversationId
    });
    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  // compose() retorna { success, output: ResponseComposerOutput }
  // sendBlocks() espera o output diretamente (com run_id, session_id, blocks, metadata)
  const composerOutput = composerResult.output;

  console.log('🤖 [EXECUTE] ✅ ResponseComposer OK — iniciando WhatsAppGateway:', {
    run_id:          composerOutput.run_id,
    blocks_count:    composerOutput.blocks?.length ?? 0,
    conversation_id: conversationId
  });

  // ── 6. WhatsAppGateway ────────────────────────────────────────────────────

  let gatewayResult;

  try {
    gatewayResult = await sendBlocks(composerOutput);
  } catch (gatewayError) {
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do WhatsAppGateway:', gatewayError.message);
    return res.status(200).json({
      success: false,
      status:  'whatsapp_gateway_exception',
      error:   gatewayError.message,
      meta:    { run_id: context.run_id, conversation_id: conversationId }
    });
  }

  // ── 7. Resposta final ─────────────────────────────────────────────────────

  const totalBlocks  = composerOutput.blocks?.length ?? 0;
  const sentCount    = gatewayResult.successCount ?? 0;
  const failedCount  = totalBlocks - sentCount;
  const abortReason  = gatewayResult.abortReason ?? null;
  const allSent      = sentCount === totalBlocks;
  const finalStatus  = allSent ? 'completed' : 'partial_send';

  console.log(`🤖 [EXECUTE] ${allSent ? '✅' : '⚠️ '} Pipeline concluído (${finalStatus}):`, {
    run_id:          context.run_id,
    session_id:      context.session_id,
    blocks_total:    totalBlocks,
    blocks_sent:     sentCount,
    blocks_failed:   failedCount,
    abort_reason:    abortReason,
    conversation_id: conversationId
  });

  return res.status(200).json({
    success: true,
    status:  finalStatus,
    meta: {
      run_id:          context.run_id,
      session_id:      context.session_id,
      blocks_total:    totalBlocks,
      blocks_sent:     sentCount,
      blocks_failed:   failedCount,
      abort_reason:    abortReason,
      conversation_id: conversationId
    }
  });
}

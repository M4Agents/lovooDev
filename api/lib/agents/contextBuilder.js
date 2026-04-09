// =============================================================================
// api/lib/agents/contextBuilder.js
//
// ContextBuilder — Etapa 6 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Buscar os dados necessários para o AgentExecutor (Etapa 7) e entregá-los
//   estruturados e filtrados. Não monta prompt. Não chama LLM.
//
// FLUXO:
//   1. Revalidar company_id (não confiar cegamente no OrchestratorContext)
//   2. Buscar em paralelo (Promise.allSettled):
//      a. Configuração do agente (lovoo_agents)
//      b. Mensagens recentes (RPC chat_get_messages)
//      c. Contato/Lead (chat_conversations → leads)
//      d. Catálogo (products + services)
//   3. Abortar apenas se o agente não for encontrado
//   4. Aplicar filtros de capabilities (preço, etc.)
//   5. Retornar ContextBuilderOutput estruturado
//
// MULTI-TENANT:
//   company_id obrigatório em TODAS as queries. Nunca assume contexto global.
//
// RETORNO:
//   { success: true, output: ContextBuilderOutput }
//   { success: false, skip_reason: string, error?: string }
//
// OBSERVAÇÕES DE SCHEMA:
//   - lovoo_agents.prompt    → texto do system prompt (coluna 'prompt', não 'system_prompt')
//   - lovoo_agents.knowledge_mode → 'none' | 'inline' | 'rag' | 'hybrid'
//   - chat_conversations.lead_id  → INTEGER, nullable (não UUID)
//   - chat_conversations.contact_name + contact_phone → sempre presentes
//   - chat_get_messages com p_reverse_order=true → DESC (mais recentes primeiro)
//     → reverter o array para ordem cronológica no output
//   - products/services: available_for_ai (boolean) + is_active (boolean)
// =============================================================================

import { createClient } from '@supabase/supabase-js';

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Limite de mensagens recentes a incluir no contexto.
 * Equilibra qualidade do contexto com custo de tokens.
 * MVP = 20. Pode ser ajustado por assignment futuramente.
 */
const MESSAGES_LIMIT = 20;

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
 * Monta o ContextBuilderOutput para o AgentExecutor.
 *
 * @param {object} orchestratorContext - OrchestratorContext do Orchestrator (Etapa 5)
 * @returns {{ success: boolean, output?: ContextBuilderOutput, skip_reason?: string, error?: string }}
 */
export async function buildContext(orchestratorContext) {
  const svc = getServiceSupabase();

  if (!svc) {
    console.error('🤖 [CTX] ❌ service_role client indisponível');
    return { success: false, skip_reason: 'error', error: 'service_role_unavailable' };
  }

  // Revalidar company_id — fonte de verdade é o evento original do webhook
  const companyId      = orchestratorContext.event?.company_id;
  const conversationId = orchestratorContext.event?.conversation_id;
  const agentId        = orchestratorContext.agent_id;

  if (!companyId || !conversationId || !agentId) {
    console.error('🤖 [CTX] ❌ Campos obrigatórios ausentes no OrchestratorContext:', {
      companyId, conversationId, agentId
    });
    return { success: false, skip_reason: 'error', error: 'missing_required_fields' };
  }

  // ── Busca paralela ────────────────────────────────────────────────────────
  // Promise.allSettled garante que falhas individuais não abortam as demais.
  // Apenas falha no agente é bloqueante.

  const [agentResult, messagesResult, contactResult, catalogResult] = await Promise.allSettled([
    fetchAgentConfig(svc, { agentId, companyId }),
    fetchRecentMessages(svc, { conversationId, companyId }),
    fetchContact(svc, { conversationId, companyId }),
    fetchCatalog(svc, { companyId })
  ]);

  // ── Agente: bloqueante ────────────────────────────────────────────────────
  if (agentResult.status === 'rejected') {
    console.error('🤖 [CTX] ❌ Falha ao buscar configuração do agente:', agentResult.reason?.message);
    return { success: false, skip_reason: 'error', error: 'agent_fetch_failed' };
  }

  const agent = agentResult.value;

  if (!agent) {
    console.warn('🤖 [CTX] ⏭️  Agente não encontrado ou inativo:', { agentId, companyId });
    return { success: false, skip_reason: 'agent_not_found' };
  }

  // ── Mensagens: não-bloqueante (pode retornar vazio) ───────────────────────
  let recentMessages = [];
  if (messagesResult.status === 'fulfilled') {
    recentMessages = messagesResult.value ?? [];
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar mensagens (continuando sem histórico):',
      messagesResult.reason?.message);
  }

  // ── Contato/Lead: não-bloqueante (pode retornar dados parciais) ───────────
  let contact = { lead_id: null, name: null, phone: null };
  if (contactResult.status === 'fulfilled') {
    contact = contactResult.value ?? contact;
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar contato (continuando sem dados do lead):',
      contactResult.reason?.message);
  }

  // ── Catálogo: não-bloqueante (pode retornar vazio) ────────────────────────
  let rawCatalog = { products: [], services: [] };
  if (catalogResult.status === 'fulfilled') {
    rawCatalog = catalogResult.value ?? rawCatalog;
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar catálogo (continuando sem produtos/serviços):',
      catalogResult.reason?.message);
  }

  // ── Filtrar catálogo por capabilities ────────────────────────────────────
  const catalog = applyCapabilityFilters(
    rawCatalog,
    orchestratorContext.capabilities,
    orchestratorContext.price_display_policy
  );

  // ── Montar ContextBuilderOutput ───────────────────────────────────────────

  const output = {
    run_id:     orchestratorContext.run_id,
    session_id: orchestratorContext.session_id,

    agent: {
      id:                  agent.id,
      prompt:              agent.prompt,        // lovoo_agents.prompt (system prompt)
      knowledge_mode:      agent.knowledge_mode, // 'none' | 'inline' | 'rag' | 'hybrid'
      knowledge_base:      agent.knowledge_base, // texto livre (inline/hybrid)
      model:               agent.model,
      model_config:        agent.model_config
    },

    conversation: {
      id:               conversationId,
      contact_phone:    orchestratorContext.conversation.contact_phone,
      recent_messages:  recentMessages
    },

    contact: {
      lead_id: contact.lead_id,
      name:    contact.name,
      phone:   contact.phone
    },

    catalog,

    // Mensagem atual sendo respondida (foco principal do LLM)
    user_message: orchestratorContext.event.message_text ?? '',

    // Capabilities e política de preços (para o AgentExecutor usar como defesa secundária)
    capabilities:         orchestratorContext.capabilities,
    price_display_policy: orchestratorContext.price_display_policy,

    metadata: {
      company_id:    companyId,
      assignment_id: orchestratorContext.assignment_id,
      rule_id:       orchestratorContext.rule_id
    }
  };

  console.log('🤖 [CTX] ✅ ContextBuilderOutput montado:', {
    run_id:           output.run_id,
    agent_id:         output.agent.id,
    knowledge_mode:   output.agent.knowledge_mode,
    messages_count:   output.conversation.recent_messages.length,
    has_lead:         !!output.contact.lead_id,
    products_count:   output.catalog.products.length,
    services_count:   output.catalog.services.length,
    conversation_id:  conversationId,
    company_id:       companyId
  });

  return { success: true, output };
}

// ── Fetchers individuais ──────────────────────────────────────────────────────

/**
 * Busca configuração do agente.
 * Retorna null se não encontrado ou inativo — buildContext trata como bloqueante.
 */
async function fetchAgentConfig(svc, { agentId, companyId }) {
  const { data, error } = await svc
    .from('lovoo_agents')
    .select('id, prompt, knowledge_mode, knowledge_base, knowledge_base_config, model, model_config')
    .eq('id', agentId)
    .eq('company_id', companyId)  // isolamento multi-tenant obrigatório
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`fetchAgentConfig: ${error.message}`);
  return data ?? null;
}

/**
 * Busca as últimas MESSAGES_LIMIT mensagens da conversa.
 *
 * Estratégia: p_reverse_order=true retorna DESC (mais recentes primeiro).
 * Revertemos o array para order cronológica (mais antigas → mais recentes),
 * que é o formato esperado pelo LLM para entender a progressão da conversa.
 *
 * Filtra mensagens com content vazio ou null.
 */
async function fetchRecentMessages(svc, { conversationId, companyId }) {
  const { data: rpcResult, error } = await svc.rpc('chat_get_messages', {
    p_conversation_id: conversationId,
    p_company_id:      companyId,
    p_limit:           MESSAGES_LIMIT,
    p_offset:          0,
    p_reverse_order:   true  // DESC: mais recentes primeiro
  });

  if (error) throw new Error(`fetchRecentMessages RPC: ${error.message}`);

  if (!rpcResult?.success || !Array.isArray(rpcResult?.data)) {
    console.warn('🤖 [CTX] ⚠️  chat_get_messages retornou sem dados:', rpcResult);
    return [];
  }

  // Reverter para ordem cronológica (mais antigas → mais recentes)
  const messages = [...rpcResult.data].reverse();

  // Mapear para campos mínimos necessários (economia de tokens)
  return messages
    .filter(m => m.content && m.content.trim() !== '')
    .map(m => ({
      id:             m.id,
      direction:      m.direction,    // 'inbound' | 'outbound'
      content:        m.content,
      created_at:     m.created_at,
      is_ai_generated: m.is_ai_generated ?? false
    }));
}

/**
 * Busca dados do contato associado à conversa.
 *
 * Ordem de prioridade para o nome:
 *   1. leads.name (se lead_id existir) — dado cadastral mais completo
 *   2. chat_conversations.contact_name — fallback (nome recebido via WhatsApp)
 *
 * lead_id em chat_conversations é INTEGER (não UUID).
 */
async function fetchContact(svc, { conversationId, companyId }) {
  // Passo 1: buscar dados da conversa
  const { data: conv, error: convError } = await svc
    .from('chat_conversations')
    .select('lead_id, contact_phone, contact_name')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (convError) throw new Error(`fetchContact (conv): ${convError.message}`);

  if (!conv) {
    return { lead_id: null, name: null, phone: null };
  }

  let leadName = conv.contact_name ?? null;

  // Passo 2: se lead_id existir, buscar nome mais completo do cadastro
  if (conv.lead_id) {
    const { data: lead, error: leadError } = await svc
      .from('leads')
      .select('name, phone')
      .eq('id', conv.lead_id)
      .eq('company_id', companyId)  // isolamento multi-tenant obrigatório
      .maybeSingle();

    if (leadError) {
      // Não-bloqueante: log e continua com contact_name
      console.warn('🤖 [CTX] ⚠️  Falha ao buscar dados do lead (usando contact_name):', leadError.message);
    } else if (lead?.name) {
      leadName = lead.name;
    }
  }

  return {
    lead_id: conv.lead_id ?? null,
    name:    leadName,
    phone:   conv.contact_phone ?? null
  };
}

/**
 * Busca catálogo (produtos + serviços) marcados para uso por IA.
 *
 * Filtros:
 *   - available_for_ai = true (flag explícita para IA)
 *   - is_active = true (apenas itens publicados)
 *   - company_id (isolamento multi-tenant)
 *
 * Inclui availability_status para que o agente saiba comunicar disponibilidade.
 * O filtro de preços é aplicado depois (applyCapabilityFilters).
 */
async function fetchCatalog(svc, { companyId }) {
  const [productsResult, servicesResult] = await Promise.allSettled([
    svc
      .from('products')
      .select('id, name, description, default_price, ai_notes, ai_unavailable_guidance, availability_status')
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true),

    svc
      .from('services')
      .select('id, name, description, default_price, ai_notes, ai_unavailable_guidance, availability_status')
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
  ]);

  const products = productsResult.status === 'fulfilled'
    ? (productsResult.value.data ?? [])
    : (console.warn('🤖 [CTX] ⚠️  Falha ao buscar produtos:', productsResult.reason?.message), []);

  const services = servicesResult.status === 'fulfilled'
    ? (servicesResult.value.data ?? [])
    : (console.warn('🤖 [CTX] ⚠️  Falha ao buscar serviços:', servicesResult.reason?.message), []);

  return { products, services };
}

// ── Filtro de capabilities ────────────────────────────────────────────────────

/**
 * Aplica filtros de capabilities no catálogo.
 *
 * Defesa primária: dados são removidos ANTES de chegar ao LLM.
 * O LLM nunca recebe dados que não deveria ver.
 *
 * Regras de preço:
 *   - can_inform_prices = false  → default_price = null em todos os itens
 *   - price_display_policy = 'disabled' → default_price = null (cobertura dupla)
 *   - price_display_policy = 'consult_only' → default_price = null
 *   - price_display_policy = 'fixed_only' | 'range_allowed' → mantém se can_inform_prices = true
 *
 * Ponto de extensão: adicionar novos filtros aqui (can_send_media, etc.)
 */
function applyCapabilityFilters(catalog, capabilities, pricePolicy) {
  const canInformPrices = capabilities?.can_inform_prices === true;
  const isPriceHidden   = !canInformPrices
    || pricePolicy === 'disabled'
    || pricePolicy === 'consult_only';

  const filterItem = item => ({
    ...item,
    default_price: isPriceHidden ? null : item.default_price
  });

  return {
    products: (catalog.products ?? []).map(filterItem),
    services: (catalog.services ?? []).map(filterItem)
  };
}

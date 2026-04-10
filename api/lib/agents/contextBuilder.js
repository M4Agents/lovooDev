// =============================================================================
// api/lib/agents/contextBuilder.js
//
// ContextBuilder — Etapa 6 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Buscar os dados necessários para o AgentExecutor (Etapa 7) e entregá-los
//   estruturados e filtrados. Não monta prompt. Não chama LLM.
//
// FLUXO (duas fases paralelas):
//   Fase 1 — independentes (Promise.allSettled):
//     a. Configuração do agente (lovoo_agents)
//     b. Mensagens recentes (RPC chat_get_messages)
//     c. Contato/Lead expandido (leads + custom fields)
//     d. Catálogo (products + services)
//     e. ID da empresa-pai (para buscar policy)
//     f. Dados da empresa executora (para variáveis)
//   Fase 2 — dependem de Fase 1 (Promise.allSettled):
//     g. Policy de governança (usa ID da empresa-pai)
//     h. Oportunidade ativa (usa lead_id do contato)
//
// VARIÁVEIS:
//   - Resolvidas com dados da EMPRESA EXECUTORA (nunca da empresa-pai)
//   - Aplicadas na policy de governança E no prompt do agente
//   - Grupos: Runtime, Empresa, Lead, Oportunidade, Campos Personalizados (cp_*)
//
// MULTI-TENANT:
//   company_id obrigatório em TODAS as queries. Nunca assume contexto global.
//
// RETORNO:
//   { success: true, output: ContextBuilderOutput }
//   { success: false, skip_reason: string, error?: string }
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  buildAllVariables,
  applyPolicyVariables,
} from '../utils/policyVariables.js';

// ── Constantes ────────────────────────────────────────────────────────────────

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

export async function buildContext(orchestratorContext) {
  const svc = getServiceSupabase();

  if (!svc) {
    console.error('🤖 [CTX] ❌ service_role client indisponível');
    return { success: false, skip_reason: 'error', error: 'service_role_unavailable' };
  }

  const companyId      = orchestratorContext.event?.company_id;
  const conversationId = orchestratorContext.event?.conversation_id;
  const agentId        = orchestratorContext.agent_id;

  if (!companyId || !conversationId || !agentId) {
    console.error('🤖 [CTX] ❌ Campos obrigatórios ausentes:', { companyId, conversationId, agentId });
    return { success: false, skip_reason: 'error', error: 'missing_required_fields' };
  }

  // ── Fase 1: busca paralela — todas as queries independentes ──────────────

  const [agentResult, messagesResult, contactResult, catalogResult, parentIdResult, childCompanyResult] =
    await Promise.allSettled([
      fetchAgentConfig(svc, { agentId, companyId }),
      fetchRecentMessages(svc, { conversationId, companyId }),
      fetchContact(svc, { conversationId, companyId }),
      fetchCatalog(svc, { companyId }),
      fetchParentCompanyId(svc),
      fetchChildCompanyData(svc, companyId),
    ]);

  // ── Agente: bloqueante ────────────────────────────────────────────────────

  if (agentResult.status === 'rejected') {
    console.error('🤖 [CTX] ❌ Falha ao buscar agente:', agentResult.reason?.message);
    return { success: false, skip_reason: 'error', error: 'agent_fetch_failed' };
  }

  const agent = agentResult.value;
  if (!agent) {
    console.warn('🤖 [CTX] ⏭️  Agente não encontrado ou inativo:', { agentId, companyId });
    return { success: false, skip_reason: 'agent_not_found' };
  }

  // ── Mensagens ─────────────────────────────────────────────────────────────

  let recentMessages = [];
  if (messagesResult.status === 'fulfilled') {
    recentMessages = messagesResult.value ?? [];
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar mensagens (continuando):', messagesResult.reason?.message);
  }

  // ── Contato / Lead ────────────────────────────────────────────────────────

  const emptyContact = { lead_id: null, name: null, phone: null };
  let contact = emptyContact;
  if (contactResult.status === 'fulfilled') {
    contact = contactResult.value ?? emptyContact;
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar contato (continuando):', contactResult.reason?.message);
  }

  // ── Catálogo ──────────────────────────────────────────────────────────────

  let rawCatalog = { products: [], services: [] };
  if (catalogResult.status === 'fulfilled') {
    rawCatalog = catalogResult.value ?? rawCatalog;
  } else {
    console.error('🤖 [CTX] ⚠️  Falha ao buscar catálogo (continuando):', catalogResult.reason?.message);
  }

  // ── Empresa executora (para variáveis) ────────────────────────────────────

  let childCompany = null;
  if (childCompanyResult.status === 'fulfilled') {
    childCompany = childCompanyResult.value;
  } else {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar empresa executora (variáveis ficam vazias):', childCompanyResult.reason?.message);
  }

  // ── ID da empresa-pai (para buscar policy) ────────────────────────────────

  const parentCompanyId = parentIdResult.status === 'fulfilled' ? parentIdResult.value : null;

  // ── Fase 2: policy + oportunidade (dependem de Fase 1) ───────────────────

  const [policyResult, opportunityResult] = await Promise.allSettled([
    fetchActiveSystemPolicy(svc, parentCompanyId),
    contact?.lead_id
      ? fetchActiveOpportunity(svc, { lead_id: contact.lead_id, company_id: companyId })
      : Promise.resolve(null),
  ]);

  // ── Policy global de governança ───────────────────────────────────────────
  // SEGURANÇA: conteúdo da policy NUNCA é logado.

  let rawSystemPolicy = null;
  if (policyResult.status === 'fulfilled') {
    rawSystemPolicy = policyResult.value ?? null;
  } else {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar policy (continuando sem diretriz):', policyResult.reason?.message);
  }

  // ── Oportunidade ativa ────────────────────────────────────────────────────

  let opportunity = null;
  if (opportunityResult.status === 'fulfilled') {
    opportunity = opportunityResult.value ?? null;
  } else {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar oportunidade (continuando):', opportunityResult.reason?.message);
  }

  // ── Montar mapa de variáveis (empresa executora) ──────────────────────────
  // Variáveis da EMPRESA EXECUTORA — nunca da empresa-pai.
  // SEGURANÇA: policy e prompt do agente recebem dados da empresa atendendo o cliente.

  const allVariables = buildAllVariables(
    childCompany,
    contact,                      // tem campos do lead (nome, email, etc.)
    opportunity,                  // tem stage_name resolvido
    contact?.custom_values ?? [], // lead_custom_values para cp_* variáveis
  );

  // Aplicar variáveis na policy (se existir)
  // SEGURANÇA: variáveis substituídas nunca são logadas
  const systemPolicy = rawSystemPolicy
    ? applyPolicyVariables(rawSystemPolicy, allVariables)
    : null;

  // Aplicar variáveis no prompt do agente
  const processedAgentPrompt = applyPolicyVariables(agent.prompt, allVariables);

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
      id:             agent.id,
      prompt:         processedAgentPrompt, // variáveis já substituídas
      knowledge_mode: agent.knowledge_mode,
      knowledge_base: agent.knowledge_base,
      model:          agent.model,
      model_config:   agent.model_config,
      allowed_tools:  Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [],
    },

    conversation: {
      id:              conversationId,
      contact_phone:   orchestratorContext.conversation.contact_phone,
      recent_messages: recentMessages
    },

    contact: {
      lead_id: contact.lead_id,
      name:    contact.name,
      phone:   contact.phone
    },

    catalog,

    user_message: orchestratorContext.event.message_text ?? '',

    capabilities:         orchestratorContext.capabilities,
    price_display_policy: orchestratorContext.price_display_policy,

    // SEGURANÇA: nunca logada, nunca exposta em responses ou debug
    system_policy: systemPolicy,

    // Phase 3: oportunidade travada pelo flowOrchestrator para esta conversa
    locked_opportunity_id: orchestratorContext.locked_opportunity_id ?? null,

    metadata: {
      company_id:    companyId,
      assignment_id: orchestratorContext.assignment_id,
      rule_id:       orchestratorContext.rule_id,
      flow_state_id: orchestratorContext.flow_state_id ?? null
    }
  };

  console.log('🤖 [CTX] ✅ ContextBuilderOutput montado:', {
    run_id:          output.run_id,
    agent_id:        output.agent.id,
    knowledge_mode:  output.agent.knowledge_mode,
    messages_count:  output.conversation.recent_messages.length,
    has_lead:        !!output.contact.lead_id,
    has_opportunity: !!opportunity,
    products_count:  output.catalog.products.length,
    services_count:  output.catalog.services.length,
    conversation_id: conversationId,
    company_id:      companyId,
  });

  return { success: true, output };
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchAgentConfig(svc, { agentId, companyId }) {
  // Tentativa 1: busca filtrando pelo company_id do evento (caminho normal)
  const { data, error } = await svc
    .from('lovoo_agents')
    .select('id, prompt, knowledge_mode, knowledge_base, knowledge_base_config, model, model_config, allowed_tools')
    .eq('id', agentId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`fetchAgentConfig: ${error.message}`);
  if (data) return data;

  // Tentativa 2 (fallback para flow state): lovoo_agents.company_id pode ser a empresa pai,
  // enquanto o evento tem company_id da empresa filha. Busca apenas por id e is_active.
  // Nota: service_role bypassa RLS — este fallback é seguro pois não expõe dados ao cliente.
  const { data: fallback, error: fallbackErr } = await svc
    .from('lovoo_agents')
    .select('id, prompt, knowledge_mode, knowledge_base, knowledge_base_config, model, model_config, allowed_tools')
    .eq('id', agentId)
    .eq('is_active', true)
    .maybeSingle();

  if (fallbackErr) throw new Error(`fetchAgentConfig (fallback): ${fallbackErr.message}`);
  if (fallback) {
    console.warn('🤖 [CTX] ⚠️ Agente encontrado via fallback (company_id divergente):', {
      agentId,
      eventCompanyId: companyId,
      agentCompanyId: fallback.company_id ?? 'desconhecido',
    });
  }
  return fallback ?? null;
}

async function fetchRecentMessages(svc, { conversationId, companyId }) {
  const { data: rpcResult, error } = await svc.rpc('chat_get_messages', {
    p_conversation_id: conversationId,
    p_company_id:      companyId,
    p_limit:           MESSAGES_LIMIT,
    p_offset:          0,
    p_reverse_order:   true
  });

  if (error) throw new Error(`fetchRecentMessages RPC: ${error.message}`);

  if (!rpcResult?.success || !Array.isArray(rpcResult?.data)) {
    console.warn('🤖 [CTX] ⚠️  chat_get_messages sem dados:', rpcResult);
    return [];
  }

  return [...rpcResult.data].reverse()
    .filter(m => m.content && m.content.trim() !== '')
    .map(m => ({
      id:               m.id,
      direction:        m.direction,
      content:          m.content,
      created_at:       m.created_at,
      is_ai_generated:  m.is_ai_generated ?? false
    }));
}

/**
 * Busca dados do contato/lead da conversa — versão expandida.
 * Inclui: campos de endereço, cargo, origem e campos personalizados.
 * Retorna custom_values para buildCustomFieldVariables.
 */
async function fetchContact(svc, { conversationId, companyId }) {
  // Passo 1: buscar conversa para obter lead_id e contato
  const { data: conv, error: convError } = await svc
    .from('chat_conversations')
    .select('lead_id, contact_phone, contact_name')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (convError) throw new Error(`fetchContact (conv): ${convError.message}`);
  if (!conv) return { lead_id: null, name: null, phone: null, custom_values: [] };

  if (!conv.lead_id) {
    return {
      lead_id: null,
      name:    conv.contact_name ?? null,
      phone:   conv.contact_phone ?? null,
      custom_values: [],
    };
  }

  // Passo 2: buscar lead completo com campos personalizados
  const { data: lead, error: leadError } = await svc
    .from('leads')
    .select(`
      name, email, phone, company_name, cargo,
      cidade, estado, endereco, bairro, cep, numero, origin,
      lead_custom_values(
        value,
        lead_custom_fields(field_name)
      )
    `)
    .eq('id', conv.lead_id)
    .eq('company_id', companyId)
    .maybeSingle();

  if (leadError) {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar lead completo (usando contact_name):', leadError.message);
    return {
      lead_id:       conv.lead_id,
      name:          conv.contact_name ?? null,
      phone:         conv.contact_phone ?? null,
      custom_values: [],
    };
  }

  if (!lead) {
    return {
      lead_id:       conv.lead_id,
      name:          conv.contact_name ?? null,
      phone:         conv.contact_phone ?? null,
      custom_values: [],
    };
  }

  return {
    lead_id:      conv.lead_id,
    // Campos para output.contact
    name:         lead.name ?? conv.contact_name ?? null,
    phone:        lead.phone ?? conv.contact_phone ?? null,
    // Campos extras para variáveis (buildLeadVariables usa estes)
    email:        lead.email        ?? null,
    company_name: lead.company_name ?? null,
    cargo:        lead.cargo        ?? null,
    cidade:       lead.cidade       ?? null,
    estado:       lead.estado       ?? null,
    endereco:     lead.endereco     ?? null,
    bairro:       lead.bairro       ?? null,
    cep:          lead.cep          ?? null,
    numero:       lead.numero       ?? null,
    origin:       lead.origin       ?? null,
    // Campos personalizados para buildCustomFieldVariables
    custom_values: lead.lead_custom_values ?? [],
  };
}

async function fetchCatalog(svc, { companyId }) {
  const [productsResult, servicesResult] = await Promise.allSettled([
    svc.from('products')
      .select('id, name, description, default_price, ai_notes, ai_unavailable_guidance, availability_status')
      .eq('company_id', companyId).eq('available_for_ai', true).eq('is_active', true),
    svc.from('services')
      .select('id, name, description, default_price, ai_notes, ai_unavailable_guidance, availability_status')
      .eq('company_id', companyId).eq('available_for_ai', true).eq('is_active', true),
  ]);

  const products = productsResult.status === 'fulfilled'
    ? (productsResult.value.data ?? [])
    : (console.warn('🤖 [CTX] ⚠️  Falha ao buscar produtos:', productsResult.reason?.message), []);

  const services = servicesResult.status === 'fulfilled'
    ? (servicesResult.value.data ?? [])
    : (console.warn('🤖 [CTX] ⚠️  Falha ao buscar serviços:', servicesResult.reason?.message), []);

  return { products, services };
}

/**
 * Busca apenas o ID da empresa-pai (company_type='parent').
 * Usado exclusivamente para localizar a policy de governança.
 * Dados da empresa-pai NÃO são usados para resolver variáveis.
 */
async function fetchParentCompanyId(svc) {
  const { data, error } = await svc
    .from('companies')
    .select('id')
    .eq('company_type', 'parent')
    .maybeSingle();

  if (error) throw new Error(`fetchParentCompanyId: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Busca dados completos da empresa EXECUTORA (empresa-filha ou pai, conforme companyId do evento).
 * Estes dados são usados para resolver todas as variáveis de empresa nos prompts.
 * SEGURANÇA: nunca mistura dados de empresa diferente.
 */
async function fetchChildCompanyData(svc, companyId) {
  const { data, error } = await svc
    .from('companies')
    .select(`
      id, name, nome_fantasia, timezone, default_currency,
      pais, cidade, estado, cep, logradouro, bairro, numero,
      country_code, telefone_principal,
      email_principal, site_principal, ramo_atividade
    `)
    .eq('id', companyId)
    .maybeSingle();

  if (error) throw new Error(`fetchChildCompanyData: ${error.message}`);
  return data ?? null;
}

/**
 * Busca a policy de governança da empresa-pai.
 * Conteúdo nunca é logado.
 *
 * @param {string|null} parentCompanyId - ID da empresa-pai
 * @returns {Promise<string|null>} Conteúdo bruto da policy (antes da substituição de variáveis)
 */
async function fetchActiveSystemPolicy(svc, parentCompanyId) {
  if (!parentCompanyId) return null;

  const { data: policy, error: policyErr } = await svc
    .from('ai_system_policies')
    .select('content')
    .eq('company_id', parentCompanyId)
    .eq('is_active', true)
    .maybeSingle();

  if (policyErr) throw new Error(`fetchActiveSystemPolicy: ${policyErr.message}`);
  return policy?.content ?? null;
  // Nota: substituição de variáveis ocorre em buildContext() após obter allVariables
}

/**
 * Busca a oportunidade aberta mais recente vinculada ao lead.
 * Resolve o nome da etapa via join com opportunity_funnel_positions → funnel_stages.
 * Retorna null se não houver oportunidade.
 */
async function fetchActiveOpportunity(svc, { lead_id, company_id }) {
  const { data, error } = await svc
    .from('opportunities')
    .select(`
      title, value, currency, status, probability, expected_close_date,
      opportunity_funnel_positions(
        funnel_stages(name)
      )
    `)
    .eq('lead_id', lead_id)
    .eq('company_id', company_id)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`fetchActiveOpportunity: ${error.message}`);
  if (!data) return null;

  // Resolver nome da etapa (primeiro position disponível)
  const stageName = data.opportunity_funnel_positions?.[0]?.funnel_stages?.name ?? null;

  return {
    title:               data.title,
    value:               data.value,
    currency:            data.currency,
    status:              data.status,
    probability:         data.probability,
    expected_close_date: data.expected_close_date,
    stage_name:          stageName,
  };
}

// ── Filtro de capabilities ────────────────────────────────────────────────────

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

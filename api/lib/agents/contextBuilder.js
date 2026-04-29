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
import { matchCatalogItem, findComparisonItems } from './catalogMatcher.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const MESSAGES_LIMIT   = 20;
const MAX_CATALOG_ITEMS = 30;

// ── Detecção de intenção de comparação ────────────────────────────────────────

// Padrões normalizados (sem acentos, lowercase) indicadores de comparação.
const COMPARISON_PATTERNS = [
  'diferenca', 'diferente', 'diferenca entre',
  'qual melhor', 'qual e melhor', 'qual seria melhor',
  ' ou ', ' vs ', 'versus',
  'vale mais a pena', 'mais indicado',
  'qual devo', 'qual escolher', 'entre os dois', 'entre as duas',
  'comparar', 'comparacao',
];

/**
 * Retorna true quando a mensagem indica intenção de comparação entre itens.
 * Opera sobre a mensagem já normalizada (lowercase + sem acentos).
 */
function hasComparisonIntent(message) {
  if (!message) return false;
  const normalized = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return COMPARISON_PATTERNS.some(p => normalized.includes(p));
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

  // Limite dinâmico: reduz para 10 quando memória com summary existe.
  // Fetched sempre com MESSAGES_LIMIT=20; o slice é feito aqui pós-fase-1
  // sem custo extra de DB. Economia: ~200-400 tokens em conversas com memória.
  const contactMemory = contactResult.status === 'fulfilled' ? (contactResult.value?.memory ?? null) : null;
  if (contactMemory?.summary) {
    recentMessages = recentMessages.slice(0, 10);
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
  // #region agent log
  console.log('[DEBUG:67ebe7:company_data_state]', JSON.stringify({status:childCompanyResult.status,error:childCompanyResult.reason?.message??null,company_name:childCompany?.name??null,logradouro:childCompany?.logradouro??null,address:childCompany?.address??null,cidade:childCompany?.cidade??null,city:childCompany?.city??null}));
  // #endregion

  // ── ID da empresa-pai (para buscar policy) ────────────────────────────────

  let parentCompanyId = null;
  if (parentIdResult.status === 'rejected') {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar ID da empresa-pai:', parentIdResult.reason?.message);
  } else {
    parentCompanyId = parentIdResult.value ?? null;
    if (!parentCompanyId) {
      console.warn('🤖 [CTX] ⚠️  Empresa-pai não encontrada (company_type=parent) — agente executará sem diretrizes globais de IA.');
    }
  }

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
  if (policyResult.status === 'rejected') {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar policy (continuando sem diretriz):', policyResult.reason?.message);
  } else {
    rawSystemPolicy = policyResult.value ?? null;
    if (parentCompanyId && !rawSystemPolicy) {
      console.warn('🤖 [CTX] ⚠️  Nenhuma policy de governança ativa para a empresa-pai — agente executará sem diretrizes globais de IA.', { parentCompanyId });
    }
  }

  // ── Oportunidade ativa ────────────────────────────────────────────────────

  let opportunity = null;
  if (opportunityResult.status === 'fulfilled') {
    opportunity = opportunityResult.value ?? null;
  } else {
    console.warn('🤖 [CTX] ⚠️  Falha ao buscar oportunidade (continuando):', opportunityResult.reason?.message);
  }

  // ── Filtrar catálogo por capabilities ────────────────────────────────────

  const catalog = applyCapabilityFilters(
    rawCatalog,
    orchestratorContext.capabilities,
    orchestratorContext.price_display_policy
  );

  // ── Identificar item de interesse (catalog matcher) ───────────────────────
  // Matching feito sobre o catálogo já filtrado (preços respeitam policy).
  // Não acessa banco — usa apenas o catálogo já carregado.
  //
  // Prioridade de detecção:
  //   1. Intenção de comparação (mensagem atual com padrões "ou/vs/diferença"):
  //      a. Matcher padrão retornou exatamente 2 candidatos → comparação direta
  //      b. Matcher padrão sem resultado → findComparisonItems (relaxado, ≥1 token)
  //         e retornou exatamente 2 itens → comparação
  //   2. Ambiguidade padrão (>1 candidato sem intenção de comparação)
  //   3. Item único identificado pelo matcher padrão
  //   4. Fallback multi-mensagem (últimas 5 inbound — só se nenhuma das anteriores)

  const userMessage = orchestratorContext.event.message_text ?? '';

  // Etapa 1: matcher padrão na mensagem atual (exato → token → fuzzy)
  const { bestMatch: currentMatch, topCandidates: currentCandidates, isAmbiguous: currentAmbiguous } =
    matchCatalogItem(userMessage, catalog);

  let itemOfInterest      = null;
  let ambiguousCandidates = [];
  let isComparison        = false;

  const comparisonIntent = hasComparisonIntent(userMessage);

  if (comparisonIntent) {
    // Verificar se o matcher padrão já entregou exatamente 2 candidatos
    if (currentAmbiguous && currentCandidates.length === 2) {
      isComparison        = true;
      ambiguousCandidates = currentCandidates;
      console.log('[CTX:comparison]', {
        source:     'standard_match',
        candidates: currentCandidates.map(i => i.name),
        company_id: companyId,
      });
    } else if (!currentMatch && !currentAmbiguous) {
      // Matcher padrão não encontrou nada — tentar matcher relaxado
      const comparisonItems = findComparisonItems(userMessage, catalog);
      if (comparisonItems.length === 2) {
        isComparison        = true;
        ambiguousCandidates = comparisonItems;
        console.log('[CTX:comparison]', {
          source:     'relaxed_match',
          candidates: comparisonItems.map(i => i.name),
          company_id: companyId,
        });
      }
    }
    // Se não encontrou 2 itens para comparar, cai no fluxo normal abaixo
  }

  if (!isComparison) {
    if (currentAmbiguous) {
      // Múltiplos itens com score similar — agente deve perguntar ao lead
      ambiguousCandidates = currentCandidates;
      console.log('[CTX:ambiguous]', {
        candidates:  currentCandidates.map(i => i.name),
        company_id:  companyId,
      });
    } else if (currentMatch) {
      itemOfInterest = currentMatch;
      console.log('🤖 [CTX] 🎯 Item de interesse identificado (mensagem atual):', {
        name:       itemOfInterest.name,
        status:     itemOfInterest.availability_status,
        company_id: companyId,
      });
    } else {
      // Fallback multi-mensagem
      // Só ativa quando a mensagem atual não produz match E não há ambiguidade.
      // Itera as últimas 5 mensagens inbound da mais recente para a mais antiga.
      const inboundHistory = recentMessages
        .filter(m => m.direction === 'inbound')
        .slice(-5)
        .reverse();

      for (const msg of inboundHistory) {
        const { bestMatch: fallbackMatch, isAmbiguous: fallbackAmbiguous } =
          matchCatalogItem(msg.content, catalog);

        // Pula mensagens anteriores que também eram ambíguas
        if (fallbackAmbiguous || !fallbackMatch) continue;

        itemOfInterest = fallbackMatch;
        console.log('[CTX:item-fallback]', {
          source:     'previous_message',
          item:       fallbackMatch.name,
          company_id: companyId,
        });
        break;
      }
    }
  }


  // ── Montar mapa de variáveis (empresa executora + produto em foco) ─────────
  // Variáveis da EMPRESA EXECUTORA — nunca da empresa-pai.
  // itemOfInterest preenche produto_* quando há match; strings vazias caso contrário.

  const allVariables = buildAllVariables(
    childCompany,
    contact,
    opportunity,
    contact?.custom_values ?? [],
    itemOfInterest,
  );

  // Aplicar variáveis na policy (se existir)
  // SEGURANÇA: variáveis substituídas nunca são logadas
  const systemPolicy = rawSystemPolicy
    ? applyPolicyVariables(rawSystemPolicy, allVariables)
    : null;

  // Aplicar variáveis no prompt do agente
  const processedAgentPrompt = applyPolicyVariables(agent.prompt, allVariables);
  // #region agent log
  console.log('[DEBUG:67ebe7:resolved_address_vars]', JSON.stringify({logradouro:allVariables.logradouro,bairro:allVariables.bairro,cidade:allVariables.cidade,estado:allVariables.estado,cep:allVariables.cep,nome_empresa:allVariables.nome_empresa}));
  // #endregion

  // ── Montar ContextBuilderOutput ───────────────────────────────────────────

  const output = {
    run_id:     orchestratorContext.run_id,
    session_id: orchestratorContext.session_id,

    agent: {
      id:             agent.id,
      prompt:         processedAgentPrompt, // variáveis já substituídas
      prompt_config:  agent.prompt_config ?? null, // estrutura JSONB para buildPromptFromConfig
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

    item_of_interest:     itemOfInterest ?? null,

    // Candidatos relevantes para ambiguidade ou comparação.
    // Quando ambiguous_candidates.length > 0, item_of_interest é null.
    // is_comparison distingue entre os dois modos de renderização.
    ambiguous_candidates: ambiguousCandidates,
    is_comparison:        isComparison,

    user_message: userMessage,

    capabilities:         orchestratorContext.capabilities,
    price_display_policy: orchestratorContext.price_display_policy,

    // SEGURANÇA: nunca logada, nunca exposta em responses ou debug
    system_policy: systemPolicy,

    // Phase 3: oportunidade travada pelo flowOrchestrator para esta conversa
    locked_opportunity_id: orchestratorContext.locked_opportunity_id ?? null,

    // Memória conversacional — lida de chat_conversations.memory.
    // Escrita exclusivamente pelo agentExecutor (LLM). Nunca por webhooks.
    // Usado pelo agentExecutor para: injetar no prompt e fazer merge pós-resposta.
    conversation_memory: contactMemory,

    // Dados live da empresa executora — usados por buildPromptFromConfig no agentExecutor.
    // Nunca usados para autorização — apenas para contexto do prompt (Seção B).
    company_data: childCompany ?? null,

    metadata: {
      company_id:    companyId,
      assignment_id: orchestratorContext.assignment_id,
      rule_id:       orchestratorContext.rule_id,
      flow_state_id: orchestratorContext.flow_state_id ?? null
    }
  };

  console.log('🤖 [CTX] ✅ ContextBuilderOutput montado:', {
    run_id:              output.run_id,
    agent_id:            output.agent.id,
    knowledge_mode:      output.agent.knowledge_mode,
    messages_count:      output.conversation.recent_messages.length,
    has_lead:            !!output.contact.lead_id,
    has_opportunity:     !!opportunity,
    products_count:      output.catalog.products.length,
    services_count:      output.catalog.services.length,
    item_of_interest:    itemOfInterest?.name ?? null,
    is_comparison:       isComparison,
    is_ambiguous:        !isComparison && ambiguousCandidates.length > 0,
    ambiguous_count:     ambiguousCandidates.length,
    conversation_id:     conversationId,
    company_id:          companyId,
  });

  return { success: true, output };
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchAgentConfig(svc, { agentId, companyId }) {
  const SELECT_AGENT = 'id, prompt, prompt_config, knowledge_mode, knowledge_base, knowledge_base_config, model, model_config, allowed_tools';

  // Tentativa 1: busca filtrando pelo company_id do evento (caminho normal)
  const { data, error } = await svc
    .from('lovoo_agents')
    .select(SELECT_AGENT)
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
    .select(SELECT_AGENT)
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
  // Passo 1: buscar conversa para obter lead_id, contato e memória conversacional
  const { data: conv, error: convError } = await svc
    .from('chat_conversations')
    .select('lead_id, contact_phone, contact_name, memory')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (convError) throw new Error(`fetchContact (conv): ${convError.message}`);
  if (!conv) return { lead_id: null, name: null, phone: null, custom_values: [], memory: null };

  if (!conv.lead_id) {
    return {
      lead_id: null,
      name:    conv.contact_name ?? null,
      phone:   conv.contact_phone ?? null,
      custom_values: [],
      memory:  conv.memory ?? null,
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
      memory:        conv.memory ?? null,
    };
  }

  if (!lead) {
    return {
      lead_id:       conv.lead_id,
      name:          conv.contact_name ?? null,
      phone:         conv.contact_phone ?? null,
      custom_values: [],
      memory:        conv.memory ?? null,
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
    // Memória conversacional — lida da conversa, nunca do lead
    memory:       conv.memory ?? null,
  };
}

async function fetchCatalog(svc, { companyId }) {
  const baseSelect = `
    id, name, description, default_price,
    ai_notes, ai_unavailable_guidance,
    availability_status, stock_status,
    catalog_categories ( name )
  `;

  const [productsResult, servicesResult] = await Promise.allSettled([
    svc.from('products')
      .select(baseSelect)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .order('availability_status')   // 'available' < outros alfabeticamente
      .limit(MAX_CATALOG_ITEMS),
    svc.from('services')
      .select(baseSelect)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .order('availability_status')
      .limit(MAX_CATALOG_ITEMS),
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
      email_principal, site_principal, ramo_atividade,
      ponto_referencia, horario_atendimento, descricao_empresa
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

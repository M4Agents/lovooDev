// =====================================================
// WHATSAPP SENDER — Etapa 2 do núcleo mínimo backend
//
// Responsabilidade:
//   - Resolver lead a partir de opportunity_id (ou leadId como fallback)
//   - Resolver conversa (chat_conversations)
//   - Substituir variáveis na mensagem
//   - Criar registro em chat_messages (RPC)
//   - Enviar via Uazapi HTTP
//
// Sem imports de src/ — usa apenas supabaseAdmin.
// =====================================================

const UAZAPI_BASE = 'https://lovoo.uazapi.com'

// ---------------------------------------------------------------------------
// Resolução de dados via banco
// ---------------------------------------------------------------------------

/**
 * Resolve o lead a partir de opportunityId (prioritário) ou leadId (fallback).
 * O fallback via leadId permite que gatilhos sem oportunidade (ex: message.received)
 * também consigam enviar mensagens ao lead correto.
 */
async function resolveLead(opportunityId, companyId, supabase, leadId) {
  const LEAD_SELECT = 'id, name, phone, email, company_name, cidade, estado'

  // Prioridade 1: resolver via oportunidade
  if (opportunityId) {
    const { data: opp, error: oppError } = await supabase
      .from('opportunities')
      .select('lead_id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error(`[whatsappSender] erro ao buscar oportunidade ${opportunityId}:`, oppError?.message, oppError?.code)
      return null
    }

    if (!opp?.lead_id) return null

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .eq('id', opp.lead_id)
      .maybeSingle()

    if (leadError) {
      console.error(`[whatsappSender] erro ao buscar lead ${opp.lead_id}:`, leadError?.message, leadError?.code)
      return null
    }

    return lead || null
  }

  // Fallback: resolver diretamente pelo leadId (gatilhos sem oportunidade, ex: message.received)
  if (leadId) {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .eq('id', leadId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (leadError) {
      console.error(`[whatsappSender] erro ao buscar lead ${leadId} (fallback):`, leadError?.message, leadError?.code)
      return null
    }

    return lead || null
  }

  return null
}

/**
 * Resolve dados da oportunidade para interpolação de variáveis em mensagens.
 * Busca título, valor, status, probabilidade, previsão de fechamento e etapa atual.
 * Retorna null se não houver opportunityId ou em caso de erro (não bloqueia o envio).
 */
async function resolveOpportunity(opportunityId, companyId, supabase) {
  if (!opportunityId) return null

  const { data: opp, error } = await supabase
    .from('opportunities')
    .select('id, title, description, value, currency, status, probability, expected_close_date')
    .eq('id', opportunityId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    console.error(`[whatsappSender] erro ao buscar oportunidade ${opportunityId}:`, error?.message)
    return null
  }

  if (!opp) return null

  // Buscar nome da etapa atual via opportunity_funnel_positions
  const { data: pos } = await supabase
    .from('opportunity_funnel_positions')
    .select('funnel_stages(name)')
    .eq('opportunity_id', opportunityId)
    .maybeSingle()

  return {
    ...opp,
    stage_name: pos?.funnel_stages?.name || '',
  }
}

async function resolveConversation(phone, leadName, instanceId, companyId, supabase) {
  const cleanPhone = cleanPhoneNumber(phone)

  // Prioridade 1: RPC cria ou retorna conversa existente (requer instanceId)
  if (instanceId) {
    const { data, error: rpcError } = await supabase.rpc('chat_create_or_get_conversation', {
      p_company_id: companyId,
      p_instance_id: instanceId,
      p_contact_phone: cleanPhone,
      p_contact_name: leadName || null,
    })
    if (data?.success && data.data?.id) return data.data.id
  }

  // Prioridade 2: busca conversa ativa existente pelo telefone
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('company_id', companyId)
    .eq('contact_phone', cleanPhone)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return conv?.id || null
}

async function resolveInstance(conversationId, contextInstanceId, supabase) {
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('instance_id')
    .eq('id', conversationId)
    .maybeSingle()

  // Tenta instâncias em ordem de prioridade:
  // 1. instance_id da conversa (vínculo histórico)
  // 2. contextInstanceId (configurado no nó da automação) — fallback quando a instância da conversa está inválida
  const candidateIds = []
  if (conv?.instance_id) candidateIds.push(conv.instance_id)
  if (contextInstanceId && contextInstanceId !== conv?.instance_id) {
    candidateIds.push(contextInstanceId)
  }

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b9caa6'},body:JSON.stringify({sessionId:'b9caa6',location:'whatsappSender.js:resolveInstance',message:'candidatos de instância',data:{conversationId,convInstanceId:conv?.instance_id,contextInstanceId,candidateIds},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  for (const instanceId of candidateIds) {
    const { data: inst } = await supabase
      .from('whatsapp_life_instances')
      .select('id, provider_token, status, deleted_at')
      .eq('id', instanceId)
      .maybeSingle()

    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b9caa6'},body:JSON.stringify({sessionId:'b9caa6',location:'whatsappSender.js:resolveInstance:loop',message:'verificando instância',data:{instanceId,status:inst?.status,deleted_at:inst?.deleted_at,valid:!!(inst && inst.deleted_at===null && inst.status==='connected')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (!inst) continue
    if (inst.deleted_at !== null) continue
    if (inst.status !== 'connected') continue

    return inst
  }

  return null
}

async function resolveUserId(companyId, supabase) {
  const { data } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return data?.user_id || null
}

// ---------------------------------------------------------------------------
// Substituição de variáveis (extraído de WhatsAppService.replaceVariables)
// ---------------------------------------------------------------------------

function cleanPhoneNumber(phone) {
  let clean = (phone || '').replace(/\D/g, '')
  if (!clean.startsWith('55') && clean.length <= 11) clean = '55' + clean
  return clean
}

function formatCurrency(value, currency) {
  if (value == null || value === '') return ''
  const curr = currency || 'BRL'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: curr }).format(Number(value))
  } catch {
    return String(value)
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('pt-BR')
  } catch {
    return ''
  }
}

const OPPORTUNITY_STATUS_LABELS = {
  open:   'Aberta',
  won:    'Ganha',
  lost:   'Perdida',
}

function replaceVariables(message, lead, opportunity, contextVariables) {
  if (!message) return ''
  let result = message
  const now = new Date()

  // Variáveis de lead
  result = result.replace(/\{\{lead\.nome\}\}/g,     lead?.name         || '')
  result = result.replace(/\{\{lead\.email\}\}/g,    lead?.email        || '')
  result = result.replace(/\{\{lead\.telefone\}\}/g, lead?.phone        || '')
  result = result.replace(/\{\{lead\.empresa\}\}/g,  lead?.company_name || '')
  result = result.replace(/\{\{lead\.cidade\}\}/g,   lead?.cidade       || '')
  result = result.replace(/\{\{lead\.estado\}\}/g,   lead?.estado       || '')

  // Variáveis de oportunidade
  result = result.replace(/\{\{oportunidade\.titulo\}\}/g,       opportunity?.title       || '')
  result = result.replace(/\{\{oportunidade\.descricao\}\}/g,    opportunity?.description || '')
  result = result.replace(/\{\{oportunidade\.valor\}\}/g,        formatCurrency(opportunity?.value, opportunity?.currency))
  result = result.replace(/\{\{oportunidade\.etapa\}\}/g,        opportunity?.stage_name  || '')
  result = result.replace(/\{\{oportunidade\.status\}\}/g,       OPPORTUNITY_STATUS_LABELS[opportunity?.status] || opportunity?.status || '')
  result = result.replace(/\{\{oportunidade\.probabilidade\}\}/g, opportunity?.probability != null ? `${opportunity.probability}%` : '')
  result = result.replace(/\{\{oportunidade\.previsao\}\}/g,     formatDate(opportunity?.expected_close_date))

  // Variáveis de data/hora
  result = result.replace(/\{\{data\.hoje\}\}/g, now.toLocaleDateString('pt-BR'))
  result = result.replace(/\{\{data\.hora\}\}/g, now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))

  // Variáveis de contexto/custom — padrão {{variavel}} (double-brace)
  const vars = contextVariables || {}
  Object.keys(vars).forEach(key => {
    const value = String(vars[key] ?? '')
    if (key.startsWith('custom_')) {
      const fieldName = key.replace('custom_', '')
      result = result.replace(new RegExp(`\\{\\{custom\\.${fieldName}\\}\\}`, 'g'), value)
    }
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  })

  return result
}

// ---------------------------------------------------------------------------
// Criação de mensagem no banco e envio via Uazapi
// ---------------------------------------------------------------------------

async function createDbMessage(conversationId, companyId, content, messageType, mediaUrl, userId, supabase) {
  // Truncar para evitar "value too long for character varying(500)"
  const truncated = content.length > 450 ? content.substring(0, 447) + '...' : content

  const { data, error } = await supabase.rpc('chat_create_message', {
    p_conversation_id: conversationId,
    p_company_id:      companyId,
    p_content:         truncated,
    p_message_type:    messageType,
    p_direction:       'outbound',
    p_sent_by:         userId,
    p_media_url:       mediaUrl || null,
  })

  if (error || !data?.success) {
    throw new Error(data?.error || error?.message || 'Erro ao criar mensagem no banco')
  }

  return data.message_id
}

async function sendViaUazapi(messageId, phone, providerToken, content, messageType, mediaUrl, supabase, instanceId, companyId) {
  const isMedia = messageType !== 'text'
  const endpoint = isMedia
    ? `${UAZAPI_BASE}/send/media`
    : `${UAZAPI_BASE}/send/text`

  const payload = isMedia
    ? { number: phone, type: messageType, file: mediaUrl, text: content || '', delay: 1000 }
    : { number: phone, text: content, delay: 1000, linkPreview: true }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: providerToken },
    body: JSON.stringify(payload),
  })

  const result = await response.json()

  const uazapiMessageId = result.messageid || result.messageId || null

  if (response.ok) {
    await supabase
      .from('chat_messages')
      .update({ status: 'sent', uazapi_message_id: uazapiMessageId, updated_at: new Date().toISOString() })
      .eq('id', messageId)
    return { sent: true, uazapiMessageId }
  } else {
    await supabase
      .from('chat_messages')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', messageId)

    // Detectar e registrar restrição WhatsApp (ex: WHATSAPP_REACHOUT_TIMELOCK)
    // Envolvido em try/catch para não impedir o throw original em caso de falha no helper
    if (instanceId && companyId) {
      try {
        const { isRestrictionError, recordRestriction } = await import('../uazapi/restrictions.js')
        if (isRestrictionError(result)) {
          await recordRestriction(supabase, { companyId, instanceId, errorPayload: result })
        }
      } catch (restrictionErr) {
        console.error('[whatsappSender] Erro ao registrar restrição (non-fatal):', restrictionErr.message)
      }
    }

    throw new Error(result.error || `Uazapi HTTP ${response.status}: falha no envio`)
  }
}

// ---------------------------------------------------------------------------
// Entry point principal — chamado pelo executor.js
// ---------------------------------------------------------------------------

export async function sendMessageNode(node, context, supabase) {
  const config      = node.data?.config || {}
  const messageType = config.messageType || 'text'

  // Tipos não suportados nesta etapa
  if (messageType === 'delay') {
    return { skipped: true, reason: 'messageType=delay não suportado nesta etapa' }
  }

  // Conteúdo da mensagem
  const rawMessage = config.message || config.caption || config.question || ''
  const mediaUrl   = config.fileUrl || config.audioUrl || null
  // Mapear tipo para a API (file → fileType, audio → audio, texto → text)
  const apiType = messageType === 'file'
    ? (config.fileType || 'document')
    : messageType === 'audio' ? 'audio' : 'text'

  // 1. Resolver lead via opportunity_id (prioritário) ou lead_id (fallback para gatilhos sem oportunidade)
  const lead = await resolveLead(context.opportunityId, context.companyId, supabase, context.leadId)
  if (!lead?.phone) {
    return {
      skipped: true,
      reason: `Lead não encontrado ou sem telefone (opportunity_id: ${context.opportunityId ?? null}, lead_id: ${context.leadId ?? null})`,
    }
  }

  // 1b. Resolver oportunidade para interpolação de variáveis (não bloqueia envio se ausente)
  const opportunity = await resolveOpportunity(context.opportunityId, context.companyId, supabase)

  // 2. Substituir variáveis na mensagem
  const message = replaceVariables(rawMessage, lead, opportunity, context.variables)
  if (!message && !mediaUrl) {
    return { skipped: true, reason: 'Mensagem vazia e sem mídia' }
  }

  // 3. Resolver conversa (existente ou criar nova)
  // instanceId vem do contexto (trigger_data) ou, como fallback, do config do nó de mensagem.
  // Isso permite que automações com instanceId no nó criem conversas para leads sem histórico.
  const effectiveInstanceId = context.instanceId || config.instanceId || null

  const conversationId = await resolveConversation(
    lead.phone,
    lead.name,
    effectiveInstanceId,
    context.companyId,
    supabase
  )
  if (!conversationId) {
    throw new Error(
      `Conversa não encontrada para lead ${lead.id} (tel: ${lead.phone}). ` +
      `O contato precisa ter enviado uma mensagem primeiro ou instanceId deve estar configurado.`
    )
  }

  // Propagar conversationId para o contexto — permite que nós subsequentes
  // (ex: attach_agent) usem a conversa criada/resolvida por este nó.
  context.conversationId = conversationId

  // 4. Resolver instância WhatsApp
  const instance = await resolveInstance(conversationId, effectiveInstanceId, supabase)
  if (!instance) {
    throw new Error('Instância WhatsApp não encontrada ou não está conectada')
  }

  // 5. Resolver userId válido para atribuição da mensagem
  const userId = await resolveUserId(context.companyId, supabase)
  if (!userId) {
    throw new Error('Nenhum usuário ativo encontrado para a empresa')
  }

  // 6. Criar registro em chat_messages
  const phone = cleanPhoneNumber(lead.phone)
  const dbMessageId = await createDbMessage(
    conversationId,
    context.companyId,
    message,
    apiType,
    mediaUrl,
    userId,
    supabase
  )

  // 7. Enviar via Uazapi
  const uazResult = await sendViaUazapi(
    dbMessageId,
    phone,
    instance.provider_token,
    message,
    apiType,
    mediaUrl,
    supabase,
    instance.id,
    context.companyId
  )

  return {
    sent:      true,
    to:        phone,
    message:   message.substring(0, 80),
    messageId: uazResult.uazapiMessageId || dbMessageId,
  }
}

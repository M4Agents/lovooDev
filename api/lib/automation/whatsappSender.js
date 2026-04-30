// =====================================================
// WHATSAPP SENDER — Etapa 2 do núcleo mínimo backend
//
// Responsabilidade:
//   - Resolver lead a partir de opportunity_id
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

async function resolveLead(opportunityId, companyId, supabase) {
  if (!opportunityId) return null

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
    .select('id, name, phone, email, company_name, cidade, estado')
    .eq('id', opp.lead_id)
    .maybeSingle()

  if (leadError) {
    console.error(`[whatsappSender] erro ao buscar lead ${opp.lead_id}:`, leadError?.message, leadError?.code)
    return null
  }

  return lead || null
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
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67ebe7'},body:JSON.stringify({sessionId:'67ebe7',location:'whatsappSender.js:62',message:'RPC chat_create_or_get_conversation result',data:{success:data?.success,conversationId:data?.data?.id,rpcError:rpcError?.message??null,phone:cleanPhone},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
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
  // Busca instanceId na conversa (sobrepõe o do contexto se existir)
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('instance_id')
    .eq('id', conversationId)
    .maybeSingle()

  const instanceId = conv?.instance_id || contextInstanceId
  if (!instanceId) return null

  const { data: inst } = await supabase
    .from('whatsapp_life_instances')
    .select('id, provider_token, status, deleted_at')
    .eq('id', instanceId)
    .maybeSingle()

  if (!inst) return null
  if (inst.deleted_at !== null) return null
  if (inst.status !== 'connected') return null

  return inst
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

function replaceVariables(message, lead, contextVariables) {
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

async function sendViaUazapi(messageId, phone, providerToken, content, messageType, mediaUrl, supabase) {
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

  // 1. Resolver lead via opportunity_id
  const lead = await resolveLead(context.opportunityId, context.companyId, supabase)
  if (!lead?.phone) {
    return {
      skipped: true,
      reason: `Lead não encontrado ou sem telefone (opportunity_id: ${context.opportunityId})`,
    }
  }

  // 2. Substituir variáveis na mensagem
  const message = replaceVariables(rawMessage, lead, context.variables)
  if (!message && !mediaUrl) {
    return { skipped: true, reason: 'Mensagem vazia e sem mídia' }
  }

  // 3. Resolver conversa (existente ou criar nova)
  // instanceId vem do contexto (trigger_data) ou, como fallback, do config do nó de mensagem.
  // Isso permite que automações com instanceId no nó criem conversas para leads sem histórico.
  const effectiveInstanceId = context.instanceId || config.instanceId || null

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'67ebe7'},body:JSON.stringify({sessionId:'67ebe7',location:'whatsappSender.js:252',message:'resolveConversation params',data:{contextInstanceId:context.instanceId,nodeConfigInstanceId:config.instanceId,effectiveInstanceId,phone:lead.phone,companyId:context.companyId},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

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
    supabase
  )

  return {
    sent:      true,
    to:        phone,
    message:   message.substring(0, 80),
    messageId: uazResult.uazapiMessageId || dbMessageId,
  }
}

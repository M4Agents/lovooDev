// Webhook Uazapi para Recebimento Automático de Mensagens WhatsApp
// Endpoint: /api/webhook/uazapi/[company_id]
// Método: POST com payload real da Uazapi
// Padrão baseado no webhook/lead/[api_key] que funciona 100%

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK UAZAPI INICIADO - PADRÃO API LEADS');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);

  // Set CORS headers (mesmo padrão do webhook-lead)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - retornando 200');
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    res.status(405).json({ 
      success: false, 
      error: 'Método não permitido. Use POST.' 
    });
    return;
  }
  
  try {
    const { company_id } = req.query;
    
    if (!company_id) {
      console.error('Uazapi webhook: Missing company_id');
      res.status(400).json({ 
        success: false, 
        error: 'Company ID é obrigatório na URL' 
      });
      return;
    }
    
    console.log('📥 PAYLOAD UAZAPI RECEBIDO:', req.body);
    console.log('📊 PAYLOAD DETALHADO:');
    console.log('- Tipo do payload:', typeof req.body);
    console.log('- Keys do payload:', Object.keys(req.body || {}));
    console.log('- Company ID:', company_id);
    
    // Processar mensagem da Uazapi
    const result = await processUazapiMessage({
      company_id,
      payload: req.body,
      user_agent: req.headers['user-agent'] || 'Uazapi-Webhook/1.0',
      ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
    
    if (result.success) {
      console.log('SUCCESS: Mensagem Uazapi processada:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'Mensagem processada com sucesso!'
      });
    } else {
      console.error('ERROR: Falha ao processar mensagem Uazapi:', result.error);
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in Uazapi webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
}

async function processUazapiMessage(params) {
  try {
    // Use the Supabase client (mesmo padrão do webhook-lead)
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    // Usando chave anon (mesmo padrão do webhook-lead)
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔑 USANDO CHAVE ANON (MESMO PADRÃO WEBHOOK LEAD)');
    console.log('Processando webhook para Company ID:', params.company_id);
    
    // 1. Validar company_id e obter empresa (mesmo padrão do webhook-lead)
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', params.company_id)
      .single();
    
    if (companyError || !company) {
      console.error('Invalid company_id:', params.company_id);
      return { success: false, error: 'Company ID inválido' };
    }
    
    console.log('Company ID validado para empresa:', company.name);
    
    // 2. Extrair dados do payload real da Uazapi
    const payload = params.payload;
    const eventType = payload.EventType;
    const message = payload.message;
    
    // Validações básicas
    if (eventType !== 'messages') {
      return { success: false, error: 'Event type não suportado: ' + eventType };
    }
    
    if (!message) {
      return { success: false, error: 'Mensagem não encontrada no payload' };
    }
    
    // Filtros (mesmo padrão da função SQL)
    if (message.fromMe === true || message.wasSentByApi === true) {
      return { success: false, error: 'Mensagem enviada pela API - ignorada para evitar loops' };
    }
    
    if (message.isGroup === true) {
      return { success: false, error: 'Mensagens de grupo ignoradas por enquanto' };
    }
    
    const messageType = (message.messageType || '').toLowerCase();
    if (messageType !== 'conversation' && messageType !== 'extendedtextmessage') {
      return { success: false, error: 'Tipo de mensagem não suportado: ' + messageType };
    }
    
    // 3. Extrair dados da mensagem
    const phoneNumber = extractPhoneFromSender(message.sender);
    const senderName = message.senderName || `Contato ${phoneNumber}`;
    const messageText = message.text || message.content || '';
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    
    if (!phoneNumber || phoneNumber.length < 10) {
      return { success: false, error: 'Número de telefone inválido: ' + phoneNumber };
    }
    
    console.log('Dados extraídos:', {
      phoneNumber,
      senderName,
      messageText,
      messageId,
      timestamp
    });
    
    // 4. Buscar instância WhatsApp (mesmo padrão das tabelas existentes)
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id')
      .eq('company_id', company.id)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      console.error('Instância WhatsApp não encontrada para company:', company.id);
      return { success: false, error: 'Instância WhatsApp não encontrada' };
    }
    
    // 5. Buscar ou criar contato (mesmo padrão das tabelas chat)
    let contactId;
    const { data: existingContact } = await supabase
      .from('chat_contacts')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingContact) {
      contactId = existingContact.id;
      console.log('Contato existente encontrado:', contactId);
    } else {
      // Criar novo contato
      const { data: newContact, error: contactError } = await supabase
        .from('chat_contacts')
        .insert({
          phone_number: phoneNumber,
          name: senderName,
          company_id: company.id,
          lead_source: 'whatsapp_webhook',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (contactError) {
        console.error('Erro ao criar contato:', contactError);
        return { success: false, error: contactError.message };
      }
      
      contactId = newContact.id;
      console.log('Novo contato criado:', contactId);
    }
    
    // 6. Buscar ou criar conversa
    let conversationId;
    const { data: existingConversation } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('contact_phone', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingConversation) {
      conversationId = existingConversation.id;
      console.log('Conversa existente encontrada:', conversationId);
    } else {
      // Criar nova conversa
      const { data: newConversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .insert({
          contact_phone: phoneNumber,
          company_id: company.id,
          instance_id: instance.id,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (conversationError) {
        console.error('Erro ao criar conversa:', conversationError);
        return { success: false, error: conversationError.message };
      }
      
      conversationId = newConversation.id;
      console.log('Nova conversa criada:', conversationId);
    }
    
    // 7. Verificar se mensagem já existe (evitar duplicatas)
    const { data: existingMessage } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('uazapi_message_id', messageId)
      .single();
    
    if (existingMessage) {
      console.log('Mensagem já existe, ignorando duplicata:', messageId);
      return { success: true, message_id: existingMessage.id, note: 'Mensagem duplicada ignorada' };
    }
    
    // 8. Salvar mensagem
    const finalMessageType = (messageType === 'conversation' || messageType === 'extendedtextmessage') ? 'text' : 'text';
    
    const { data: savedMessage, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        company_id: company.id,
        instance_id: instance.id,
        uazapi_message_id: messageId,
        content: messageText,
        message_type: finalMessageType,
        direction: 'inbound',
        status: 'delivered',
        timestamp: new Date(timestamp).toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (messageError) {
      console.error('Erro ao salvar mensagem:', messageError);
      return { success: false, error: messageError.message };
    }
    
    console.log('Mensagem salva com sucesso:', savedMessage.id);
    
    return { 
      success: true, 
      message_id: savedMessage.id,
      contact_id: contactId,
      conversation_id: conversationId,
      phone_number: phoneNumber,
      sender_name: senderName
    };
    
  } catch (error) {
    console.error('Exception in processUazapiMessage:', error);
    return { success: false, error: error.message };
  }
}

function extractPhoneFromSender(sender) {
  if (!sender) return null;
  
  // Remover @s.whatsapp.net, @lid, etc.
  const phone = sender.replace(/@.*$/, '');
  
  // Validar se é um número válido
  if (phone && phone.length >= 10) {
    return phone;
  }
  
  return null;
}

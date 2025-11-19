// Webhook Uazapi - NOME COMPLETAMENTE NOVO PARA EVITAR CACHE
// Endpoint: /api/uazapi-webhook-final
// SOLUÇÃO DEFINITIVA PARA PROBLEMA DE CACHE DO VERCEL

export default async function handler(req, res) {
  console.log('🎯 WEBHOOK UAZAPI FINAL - NOVO ARQUIVO SEM CACHE');
  console.log('Timestamp:', new Date().toISOString());

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Use POST' });
    return;
  }
  
  try {
    console.log('📥 PAYLOAD RECEBIDO:', req.body);
    
    const result = await processMessage(req.body);
    
    if (result.success) {
      console.log('✅ SUCESSO:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'Mensagem processada!'
      });
    } else {
      console.log('⚠️ FILTRADO:', result.error);
      res.status(200).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('❌ ERRO:', error);
    res.status(200).json({ success: false, error: error.message });
  }
}

async function processMessage(payload) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabase = createClient(
      'https://etzdsywunlpbgxkphuil.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E',
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { 'cache-control': 'no-cache' } }
      }
    );
    
    console.log('🔑 SUPABASE CONECTADO - ARQUIVO NOVO');
    
    // Validações
    if (payload.EventType !== 'messages') {
      return { success: false, error: 'Event type inválido' };
    }
    
    if (!payload.message) {
      return { success: false, error: 'Mensagem não encontrada' };
    }
    
    const message = payload.message;
    
    // Filtros
    if (message.fromMe || message.wasSentByApi || message.isGroup) {
      return { success: false, error: 'Mensagem filtrada' };
    }
    
    const messageType = (message.messageType || '').toLowerCase();
    if (messageType !== 'conversation' && messageType !== 'extendedtextmessage') {
      return { success: false, error: 'Tipo não suportado' };
    }
    
    // Extrair dados
    const phoneNumber = message.sender.replace(/@.*$/, '');
    const senderName = message.senderName || payload.chat?.name || `Contato ${phoneNumber}`;
    const messageText = message.text || message.content || '';
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    const instanceName = payload.instanceName;
    
    console.log('📞 DADOS:', { phoneNumber, senderName, instanceName });
    
    // Buscar instância
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id, companies(id, name)')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const company = instance.companies;
    console.log('🏢 EMPRESA:', company.name);
    
    // Buscar/criar contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('chat_contacts')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingContact) {
      contactId = existingContact.id;
      console.log('👤 CONTATO EXISTENTE:', contactId);
    } else {
      // USAR NOME CORRETO DA COLUNA
      const { data: newContact, error: contactError } = await supabase
        .from('chat_contacts')
        .insert({
          phone_number: phoneNumber,
          name: senderName,
          company_id: company.id,
          lead_source: 'whatsapp_webhook',
          profile_picture_url: payload.chat?.imagePreview || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (contactError) {
        console.error('❌ ERRO CONTATO:', contactError);
        return { success: false, error: contactError.message };
      }
      
      contactId = newContact.id;
      console.log('👤 NOVO CONTATO:', contactId);
    }
    
    // Buscar/criar conversa
    let conversationId;
    const { data: existingConversation } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('contact_phone', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingConversation) {
      conversationId = existingConversation.id;
      console.log('💬 CONVERSA EXISTENTE:', conversationId);
    } else {
      const { data: newConversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .insert({
          contact_phone: phoneNumber,
          company_id: company.id,
          instance_id: instance.id,
          status: 'active',
          last_message_at: new Date(timestamp).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (conversationError) {
        return { success: false, error: conversationError.message };
      }
      
      conversationId = newConversation.id;
      console.log('💬 NOVA CONVERSA:', conversationId);
    }
    
    // Verificar duplicata
    const { data: existingMessage } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('uazapi_message_id', messageId)
      .single();
    
    if (existingMessage) {
      console.log('📝 DUPLICATA IGNORADA');
      return { 
        success: true, 
        message_id: existingMessage.id,
        note: 'Duplicata ignorada'
      };
    }
    
    // Salvar mensagem
    const { data: savedMessage, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        company_id: company.id,
        instance_id: instance.id,
        uazapi_message_id: messageId,
        content: messageText,
        message_type: 'text',
        direction: 'inbound',
        status: 'delivered',
        sender_name: senderName,
        sender_phone: phoneNumber,
        timestamp: new Date(timestamp).toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (messageError) {
      return { success: false, error: messageError.message };
    }
    
    console.log('✅ MENSAGEM SALVA:', savedMessage.id);
    
    return { 
      success: true, 
      message_id: savedMessage.id,
      contact_id: contactId,
      conversation_id: conversationId
    };
    
  } catch (error) {
    console.error('❌ EXCEPTION:', error);
    return { success: false, error: error.message };
  }
}

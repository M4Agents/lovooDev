// Webhook Uazapi - Recebimento de Mensagens WhatsApp
// Endpoint: /api/webhook-uazapi-real
// Método: POST com payload real da Uazapi (formato N8N)
// BASEADO NO PADRÃO /api/webhook/lead/[api_key].js QUE FUNCIONA 100%

// Importar função de processamento robusto de mídia
import { processMediaMessageRobust } from './uazapi-webhook-final.js';

export default async function handler(req, res) {
  console.error('🚀 WEBHOOK UAZAPI REAL v2.0 - LOGS FORÇADOS');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔧 METHOD:', req.method);
  console.error('📡 USER-AGENT:', req.headers['user-agent']);

  // Set CORS headers (EXATO do webhook-lead que funciona)
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
    console.error('📥 PAYLOAD UAZAPI RECEBIDO:', JSON.stringify(req.body, null, 2));
    console.error('📊 PAYLOAD DETALHADO:');
    console.error('- Tipo do payload:', typeof req.body);
    console.error('- Keys do payload:', Object.keys(req.body || {}));
    console.error('📨 MESSAGE COMPLETO:', JSON.stringify(req.body?.message, null, 2));
    
    // Processar mensagem da Uazapi (formato real do N8N)
    const result = await processUazapiRealMessage({
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
        contact_id: result.contact_id,
        conversation_id: result.conversation_id,
        message: 'Mensagem processada com sucesso!'
      });
    } else {
      console.log('INFO: Mensagem não processada (filtrada):', result.error);
      // Sempre responder 200 para Uazapi (como N8N faz)
      res.status(200).json({ 
        success: false, 
        error: result.error,
        filtered: true
      });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in Uazapi webhook:', error);
    // Sempre responder 200 para Uazapi (evitar retry desnecessário)
    res.status(200).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      exception: error.message
    });
  }
}

async function processUazapiRealMessage(params) {
  try {
    // Use EXACT same Supabase connection as webhook-lead (that works 100%)
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    // Using SAME anon key that works in webhook-lead
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔑 USANDO MESMA CHAVE ANON DO WEBHOOK-LEAD QUE FUNCIONA');
    
    // Extrair dados do payload real (formato N8N)
    const payload = params.payload;
    
    // Verificar se é array (formato N8N) e pegar primeiro item
    let webhookData;
    if (Array.isArray(payload) && payload.length > 0) {
      webhookData = payload[0].body; // N8N envia como array com body
      console.log('📦 Payload N8N detectado - extraindo body');
    } else if (payload.body) {
      webhookData = payload.body; // Formato direto com body
      console.log('📦 Payload direto com body detectado');
    } else {
      webhookData = payload; // Formato direto
      console.log('📦 Payload direto detectado');
    }
    
    console.log('📋 Dados extraídos do webhook:', {
      EventType: webhookData.EventType,
      instanceName: webhookData.instanceName,
      owner: webhookData.owner,
      hasMessage: !!webhookData.message,
      hasChat: !!webhookData.chat
    });
    
    // Validações básicas
    if (webhookData.EventType !== 'messages') {
      return { success: false, error: 'Event type não suportado: ' + webhookData.EventType };
    }
    
    if (!webhookData.message) {
      return { success: false, error: 'Mensagem não encontrada no payload' };
    }
    
    const message = webhookData.message;
    const chat = webhookData.chat;
    const owner = webhookData.owner;
    const instanceName = webhookData.instanceName;
    
    // Filtros de segurança (evitar loops e mensagens inválidas)
    if (message.fromMe === true || message.wasSentByApi === true) {
      return { success: false, error: 'Mensagem enviada pela API - ignorada para evitar loops' };
    }
    
    if (message.isGroup === true) {
      return { success: false, error: 'Mensagens de grupo ignoradas por enquanto' };
    }
    
    const messageType = (message.messageType || '').toLowerCase();
    const rawType = (message.type || '').toLowerCase();
    const rawMediaType = (message.mediaType || '').toLowerCase();
    
    // LOGS DETALHADOS DA DETECÇÃO DE MÍDIA
    console.error('🔍 ANÁLISE DETALHADA DA DETECÇÃO:');
    console.error('📊 VARIÁVEIS BÁSICAS:', {
      messageType: messageType,
      rawType: rawType,
      rawMediaType: rawMediaType
    });
    
    const isTextMessage = (messageType === 'conversation' || messageType === 'extendedtextmessage');
    
    // DETECÇÃO ROBUSTA DE MÍDIA - MÚLTIPLOS FORMATOS
    const condition1 = (rawType === 'media' && !!rawMediaType);
    const condition2 = (messageType.includes('message') && messageType !== 'conversation' && messageType !== 'extendedtextmessage');
    const condition3 = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url));
    
    console.error('🎯 CONDIÇÕES DE DETECÇÃO:', {
      'condition1 (rawType === media && rawMediaType)': condition1,
      'condition2 (messageType includes message)': condition2,
      'condition3 (message.content object with URL)': condition3
    });
    
    const isMediaMessage = condition1 || condition2 || condition3;
    
    console.error('🎯 RESULTADO DETECÇÃO:', { isTextMessage, isMediaMessage });
    
    if (!isTextMessage && !isMediaMessage) {
      return { success: false, error: 'Tipo de mensagem não suportado: ' + messageType };
    }
    
    // Extrair dados da mensagem
    const phoneNumber = extractPhoneFromSender(message.sender);
    const senderName = message.senderName || chat?.name || `Contato ${phoneNumber}`;
    let messageText = message.text || message.content || '';
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    
    // PROCESSAMENTO DE MÍDIA
    let mediaUrl = null;
    let messageTypeForDb = 'text';
    
    if (isMediaMessage) {
      console.error('🎥 PROCESSAMENTO DE MÍDIA INICIADO:', { messageType, rawType, rawMediaType });
      
      const originalUrl = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url)) || null;
      
      console.error('🔗 URL DE MÍDIA ENCONTRADA:', originalUrl ? originalUrl.substring(0, 100) + '...' : 'NENHUMA URL');
      
      if (originalUrl) {
        console.error('🚀 PROCESSANDO URL DE MÍDIA COM FUNÇÃO ROBUSTA...');
        
        // Determinar tipo de mídia para o banco
        if (rawMediaType === 'image' || messageType.includes('image')) {
          messageTypeForDb = 'image';
        } else if (rawMediaType === 'video' || messageType.includes('video')) {
          messageTypeForDb = 'video';
        } else if (rawMediaType === 'audio' || messageType.includes('audio')) {
          messageTypeForDb = 'audio';
        } else {
          messageTypeForDb = 'document';
        }
        
        // Usar função robusta para processar mídia (preserva formato original)
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          );
          
          console.error('🎨 CHAMANDO PROCESSAMENTO ROBUSTO PARA:', rawMediaType.toUpperCase());
          mediaUrl = await processMediaMessageRobust(originalUrl, rawMediaType, supabase);
          console.error('✅ MÍDIA PROCESSADA COM SUCESSO:', { 
            originalUrl: originalUrl.substring(0, 60) + '...', 
            processedUrl: mediaUrl.substring(0, 60) + '...',
            messageTypeForDb 
          });
        } catch (error) {
          console.error('❌ ERRO NO PROCESSAMENTO ROBUSTO:', error);
          mediaUrl = originalUrl; // Fallback para URL original
          console.error('🔄 USANDO URL ORIGINAL COMO FALLBACK');
        }
      } else {
        console.error('❌ NENHUMA URL DE MÍDIA ENCONTRADA');
      }
    } else {
      console.error('⚠️ MENSAGEM NÃO É MÍDIA - PROCESSAMENTO TEXTO');
    }
    
    if (!phoneNumber || phoneNumber.length < 10) {
      return { success: false, error: 'Número de telefone inválido: ' + phoneNumber };
    }
    
    if (!owner) {
      return { success: false, error: 'Owner não encontrado no payload' };
    }
    
    console.log('📞 Dados da mensagem extraídos:', {
      phoneNumber,
      senderName,
      messageText: messageText.substring(0, 50) + '...',
      messageId,
      owner,
      instanceName
    });
    
    // 1. Buscar empresa pela instância WhatsApp
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id, companies(id, name)')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      console.error('Instância WhatsApp não encontrada:', instanceName);
      return { success: false, error: 'Instância WhatsApp não encontrada: ' + instanceName };
    }
    
    const company = instance.companies;
    console.log('🏢 Empresa identificada:', company.name, '(ID:', company.id, ')');
    
    // 2. Buscar ou criar contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('chat_contacts')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingContact) {
      contactId = existingContact.id;
      console.log('👤 Contato existente encontrado:', contactId);
      
      // Atualizar nome se necessário
      await supabase
        .from('chat_contacts')
        .update({ 
          name: senderName,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);
        
    } else {
      // Criar novo contato
      const { data: newContact, error: contactError } = await supabase
        .from('chat_contacts')
        .insert({
          phone_number: phoneNumber,
          name: senderName,
          company_id: company.id,
          lead_source: 'whatsapp_webhook',
          profile_image_url: chat?.imagePreview || null,
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
      console.log('👤 Novo contato criado:', contactId);
    }
    
    // 3. Buscar ou criar conversa
    let conversationId;
    const { data: existingConversation } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('contact_phone', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingConversation) {
      conversationId = existingConversation.id;
      console.log('💬 Conversa existente encontrada:', conversationId);
      
      // Atualizar última atividade
      await supabase
        .from('chat_conversations')
        .update({ 
          updated_at: new Date().toISOString(),
          last_message_at: new Date(timestamp).toISOString()
        })
        .eq('id', conversationId);
        
    } else {
      // Criar nova conversa
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
        console.error('Erro ao criar conversa:', conversationError);
        return { success: false, error: conversationError.message };
      }
      
      conversationId = newConversation.id;
      console.log('💬 Nova conversa criada:', conversationId);
    }
    
    // 4. Verificar se mensagem já existe (evitar duplicatas)
    const { data: existingMessage } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('uazapi_message_id', messageId)
      .single();
    
    if (existingMessage) {
      console.log('📝 Mensagem já existe, ignorando duplicata:', messageId);
      return { 
        success: true, 
        message_id: existingMessage.id, 
        contact_id: contactId,
        conversation_id: conversationId,
        note: 'Mensagem duplicada ignorada' 
      };
    }
    
    // 5. Salvar mensagem
    const { data: savedMessage, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        company_id: company.id,
        instance_id: instance.id,
        uazapi_message_id: messageId,
        content: messageText,
        message_type: messageTypeForDb,
        media_url: mediaUrl,
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
      console.error('Erro ao salvar mensagem:', messageError);
      return { success: false, error: messageError.message };
    }
    
    console.log('✅ Mensagem salva com sucesso:', savedMessage.id);
    
    return { 
      success: true, 
      message_id: savedMessage.id,
      contact_id: contactId,
      conversation_id: conversationId,
      phone_number: phoneNumber,
      sender_name: senderName,
      company_id: company.id,
      instance_id: instance.id
    };
    
  } catch (error) {
    console.error('Exception in processUazapiRealMessage:', error);
    return { success: false, error: error.message };
  }
}

function extractPhoneFromSender(sender) {
  if (!sender) return null;
  
  // Remover @s.whatsapp.net, @c.us, @lid, etc.
  const phone = sender.replace(/@.*$/, '');
  
  // Validar se é um número válido
  if (phone && phone.length >= 10) {
    return phone;
  }
  
  return null;
}

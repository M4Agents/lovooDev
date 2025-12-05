// Webhook Uazapi - Compatível com formato oficial da Uazapi
// Endpoint: /api/webhook/uazapi/[company_id]
// Baseado no webhook antigo funcional + processamento robusto de mídia

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK UAZAPI NOVO - FORMATO COMPATÍVEL');
  console.log('Timestamp:', new Date().toISOString());

  // CORS headers (mesmo padrão do antigo)
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
    
    console.log('🔑 SUPABASE CONECTADO - WEBHOOK NOVO');
    
    // Validações (mesmo padrão do antigo)
    if (payload.EventType !== 'messages') {
      return { success: false, error: 'Event type inválido' };
    }
    
    if (!payload.message) {
      return { success: false, error: 'Mensagem não encontrada' };
    }
    
    const message = payload.message;

    // Filtros (mesmo padrão do antigo)
    const isFromMe = !!message.fromMe;
    const isFromApi = !!message.wasSentByApi;
    const isDeviceSent = !!message.deviceSent;

    if (message.isGroup) {
      return { success: false, error: 'Mensagem de grupo filtrada' };
    }

    let direction = 'inbound';
    let source = 'device';

    // Cliente -> empresa (mensagem recebida)
    if (!isFromMe && !isFromApi) {
      direction = 'inbound';
      source = 'device';
    }
    // Empresa -> cliente (enviado pelo painel / API)
    else if (isFromMe && isFromApi && !isDeviceSent) {
      direction = 'outbound';
      source = 'panel';
    }
    // Empresa -> cliente (enviado do celular / WhatsApp Web)
    else if (isFromMe && isDeviceSent) {
      direction = 'outbound';
      source = 'device';
    }
    // Fallback seguro para outros casos fromMe
    else if (isFromMe) {
      direction = 'outbound';
      source = 'device';
    }

    // Detecção de tipos (mesmo padrão do antigo)
    const rawMessageType = (message.messageType || '').toLowerCase();
    const rawType = (message.type || '').toLowerCase();
    const rawMediaType = (message.mediaType || '').toLowerCase();

    const isTextMessage =
      rawMessageType === 'conversation' ||
      rawMessageType === 'extendedtextmessage';

    const isMediaMessage =
      rawType === 'media' && !!rawMediaType;

    if (!isTextMessage && !isMediaMessage) {
      return { success: false, error: 'Tipo não suportado' };
    }
    
    // Extrair dados (mesmo padrão do antigo)
    let rawPhone;

    if (direction === 'outbound') {
      rawPhone =
        message.chatid ||
        payload.chat?.wa_chatid ||
        payload.chat?.phone ||
        message.sender_pn ||
        message.sender;
    } else {
      rawPhone =
        message.sender_pn ||
        message.chatid ||
        payload.chat?.wa_chatid ||
        payload.chat?.phone ||
        message.sender;
    }

    const phoneNumber = rawPhone
      .replace(/@.*$/, '')
      .replace(/\D/g, '');

    const tempSenderName = message.senderName || payload.chat?.name || `Contato ${phoneNumber}`;

    let messageText = message.text || '';
    let mediaUrl = null;

    if (!messageText && typeof message.content === 'string') {
      messageText = message.content;
    }

    if (isMediaMessage && message.content && typeof message.content === 'object') {
      const originalUrl = message.content.URL || message.content.url || null;
      if (originalUrl) {
        // NOSSA LÓGICA NOVA: Processar mídia com download/upload
        mediaUrl = await processMediaMessage(message, supabase, originalUrl, rawMediaType);
      }
    }
    
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    const instanceName = payload.instanceName;
    
    console.log('📞 DADOS:', { phoneNumber, tempSenderName, instanceName });
    
    // Buscar instância (mesmo padrão do antigo)
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id, companies(id, name, api_key)')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const company = instance.companies;
    console.log('🏢 EMPRESA:', company.name);
    
    // Buscar nome do lead (mesmo padrão do antigo)
    const { data: existingLead } = await supabase
      .from('leads')
      .select('name')
      .eq('phone', phoneNumber)
      .eq('company_id', company.id)
      .is('deleted_at', null)
      .single();

    const senderName = existingLead?.name || tempSenderName;
    
    console.log('👤 NOME RESOLVIDO:', { 
      leadName: existingLead?.name, 
      tempName: tempSenderName, 
      finalName: senderName 
    });
    
    // Buscar/criar contato (mesmo padrão do antigo)
    let contactId;
    const { data: existingContact } = await supabase
      .from('chat_contacts')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    const isNewContact = !existingContact;
    
    if (existingContact) {
      contactId = existingContact.id;
      console.log('👤 CONTATO EXISTENTE:', contactId);
    } else {
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
    
    // Buscar/criar conversa (mesmo padrão do antigo)
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
      
      // Atualizar conversa
      await supabase
        .from('chat_conversations')
        .update({
          contact_name: senderName,
          last_message_at: new Date(timestamp).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .is('contact_name', null);
        
    } else {
      const { data: newConversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .insert({
          contact_phone: phoneNumber,
          contact_name: senderName,
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
    
    // Verificar duplicata (mesmo padrão do antigo)
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
    
    // Salvar mensagem (mesmo padrão do antigo + nossa URL processada)
    const messageTypeForDb = isMediaMessage
      ? (rawMediaType === 'image'
          ? 'image'
          : rawMediaType === 'document'
            ? 'document'
            : (rawMediaType === 'audio' || rawMediaType === 'ptt')
              ? 'audio'
              : rawMediaType === 'video'
                ? 'video'
                : 'document')
      : 'text';

    const { data: savedMessage, error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        company_id: company.id,
        instance_id: instance.id,
        uazapi_message_id: messageId,
        content: messageText,
        message_type: messageTypeForDb,
        media_url: mediaUrl, // URL processada por nossa função
        direction,
        status: 'delivered',
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

// Função para processar mídia (vídeos, imagens, documentos, áudios)
async function processMediaMessage(message, supabase, originalUrl, mediaType) {
  if (!originalUrl) return null;

  try {
    console.log('📥 Processando mídia:', mediaType, originalUrl);
    
    // Download da mídia externa
    const response = await fetch(originalUrl);
    if (!response.ok) {
      console.error('Falha ao baixar mídia:', response.status, response.statusText);
      return originalUrl; // Fallback para URL original
    }
    
    const mediaBuffer = await response.arrayBuffer();
    console.log('📦 Mídia baixada, tamanho:', mediaBuffer.byteLength, 'bytes');
    
    // Determinar extensão baseada no tipo
    const extension = getFileExtension(mediaType);
    const fileName = `${mediaType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    console.log('📁 Fazendo upload para Supabase Storage:', fileName);
    
    // Upload para Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, mediaBuffer, {
        contentType: getContentType(mediaType)
      });
    
    if (error) {
      console.error('Erro no upload para Supabase:', error);
      return originalUrl; // Fallback para URL original
    }
    
    // Retornar URL pública
    const { data: publicUrl } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName);
    
    console.log('✅ Upload concluído, URL pública:', publicUrl.publicUrl);
    return publicUrl.publicUrl;
    
  } catch (error) {
    console.error('Erro ao processar mídia:', error);
    return originalUrl; // Fallback para URL original
  }
}

// Função para determinar extensão do arquivo
function getFileExtension(mediaType) {
  const typeMap = {
    'video': 'mp4',
    'image': 'jpg',
    'audio': 'ogg',
    'document': 'pdf'
  };
  
  return typeMap[mediaType] || 'bin';
}

// Função para determinar content type
function getContentType(mediaType) {
  const typeMap = {
    'video': 'video/mp4',
    'image': 'image/jpeg',
    'audio': 'audio/ogg',
    'document': 'application/pdf'
  };
  
  return typeMap[mediaType] || 'application/octet-stream';
}

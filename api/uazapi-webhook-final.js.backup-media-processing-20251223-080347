// Webhook Uazapi - CONVERTIDO PARA USAR FUNÇÃO SECURITY DEFINER
// Endpoint: /pages/api/uazapi-webhook-final
// CORREÇÃO RLS: Agora usa process_webhook_message_safe para bypass do RLS

export default async function handler(req, res) {
  console.error('🚀 WEBHOOK PAGES/API EXECUTANDO - CONVERTIDO PARA RLS');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔧 MÉTODO:', req.method);
  console.error('📡 USER-AGENT:', req.headers['user-agent']);

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
    console.log('🔍 PAYLOAD DETALHADO:', JSON.stringify(req.body, null, 2));
    
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
    
    console.log('🔑 SUPABASE CONECTADO - WEBHOOK CONVERTIDO PARA USAR SECURITY DEFINER');
    
    // Validações básicas
    if (payload.EventType !== 'messages') {
      return { success: false, error: 'Event type inválido' };
    }
    
    if (!payload.message) {
      return { success: false, error: 'Mensagem não encontrada' };
    }
    
    const message = payload.message;

    // Detectar direção da mensagem
    const isFromMe = !!message.fromMe;
    const isFromApi = !!message.wasSentByApi;
    const isDeviceSent = !!message.deviceSent;

    if (message.isGroup) {
      return { success: false, error: 'Mensagem de grupo filtrada' };
    }

    let direction = 'inbound';
    if (!isFromMe && !isFromApi) {
      direction = 'inbound';
    } else if (isFromMe && isFromApi && !isDeviceSent) {
      direction = 'outbound';
    } else if (isFromMe && isDeviceSent) {
      direction = 'outbound';
    } else if (isFromMe) {
      direction = 'outbound';
    }

    // Extrair dados básicos
    const rawMessageType = (message.messageType || '').toLowerCase();
    const rawType = (message.type || '').toLowerCase();
    const rawMediaType = (message.mediaType || '').toLowerCase();

    const isTextMessage = rawMessageType === 'conversation' || rawMessageType === 'extendedtextmessage';
    const isMediaMessage = (rawType === 'media' && !!rawMediaType) || 
                          (rawMessageType.includes('message') && rawMessageType !== 'conversation' && rawMessageType !== 'extendedtextmessage') ||
                          (message.media && message.media.url) ||
                          (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url));

    if (!isTextMessage && !isMediaMessage) {
      return { success: false, error: 'Tipo não suportado' };
    }
    
    // Extrair telefone
    let rawPhone;
    if (direction === 'outbound') {
      rawPhone = message.chatid || payload.chat?.wa_chatid || payload.chat?.phone || message.sender_pn || message.sender;
    } else {
      rawPhone = message.sender_pn || message.chatid || payload.chat?.wa_chatid || payload.chat?.phone || message.sender;
    }

    const phoneNumber = rawPhone.replace(/@.*$/, '').replace(/\D/g, '');
    const tempSenderName = message.senderName || payload.chat?.name || `Contato ${phoneNumber}`;
    let messageText = message.text || '';
    let mediaUrl = null;

    if (!messageText && typeof message.content === 'string') {
      messageText = message.content;
    }

    // Processar mídia se necessário
    if (isMediaMessage) {
      const originalUrl = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url)) ||
                         (message.media && message.media.url) ||
                         message.url;
      
      if (originalUrl) {
        mediaUrl = originalUrl; // Usar URL original por enquanto
      }
    }

    const messageId = message.id;
    const instanceName = payload.instanceName;
    
    // Buscar instância
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    // Buscar empresa usando função SECURITY DEFINER (bypass RLS)
    console.log('🔍 Buscando empresa com company_id via SECURITY DEFINER:', instance.company_id);
    
    const { data: companyResult, error: companyError } = await supabase
      .rpc('webhook_get_company_by_id', {
        p_company_id: instance.company_id
      });
      
    console.log('🏢 Resultado da busca empresa via RPC:', {
      result: companyResult,
      error: companyError,
      company_id_usado: instance.company_id
    });
    
    // Extrair dados da empresa do resultado da função
    const company = companyResult?.success ? {
      id: companyResult.id,
      name: companyResult.name,
      api_key: companyResult.api_key
    } : null;
    
    // CORREÇÃO CRÍTICA: Verificar se company existe antes de acessar propriedades
    if (companyError || !company) {
      console.error('❌ EMPRESA NÃO ENCONTRADA para instância:', instanceName, 'Error:', companyError);
      return { success: false, error: 'Empresa não encontrada para a instância: ' + instanceName };
    }
    
    console.log('🏢 EMPRESA:', company.name);
    
    // Buscar nome do lead no cadastro
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
    
    // ✅ USAR FUNÇÃO SECURITY DEFINER PARA PROCESSAR MENSAGEM COMPLETA
    console.log('🔄 USANDO FUNÇÃO SECURITY DEFINER PARA PROCESSAMENTO SEGURO');
    
    const { data: webhookResult, error: webhookError } = await supabase
      .rpc('process_webhook_message_safe', {
        p_company_id: company.id,
        p_instance_id: instance.id,
        p_phone_number: phoneNumber,
        p_sender_name: senderName,
        p_content: messageText,
        p_message_type: isMediaMessage ? (rawMediaType || 'document') : 'text',
        p_media_url: mediaUrl,
        p_direction: direction,
        p_uazapi_message_id: messageId,
        p_profile_picture_url: payload.chat?.imagePreview || null
      });
    
    if (webhookError) {
      console.error('❌ ERRO NA FUNÇÃO SECURITY DEFINER:', webhookError);
      return { success: false, error: webhookError.message };
    }
    
    if (!webhookResult || !webhookResult.success) {
      console.error('❌ FUNÇÃO SECURITY DEFINER RETORNOU ERRO:', webhookResult);
      return { success: false, error: webhookResult?.error || 'Erro desconhecido na função segura' };
    }
    
    console.log('✅ FUNÇÃO SECURITY DEFINER EXECUTADA COM SUCESSO:', webhookResult);
    
    const contactId = webhookResult.contact_id;
    const conversationId = webhookResult.conversation_id;
    const savedMessageId = webhookResult.message_id;

    console.log('✅ MENSAGEM PROCESSADA VIA FUNÇÃO SEGURA:', savedMessageId);
    
    return { 
      success: true, 
      message_id: savedMessageId,
      contact_id: contactId,
      conversation_id: conversationId
    };
    
  } catch (error) {
    console.error('❌ EXCEPTION:', error);
    return { success: false, error: error.message };
  }
}

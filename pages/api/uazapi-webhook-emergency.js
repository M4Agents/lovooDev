// WEBHOOK UAZAPI EMERGENCY - SOLUÇÃO DEFINITIVA CACHE VERCEL
// Endpoint: /api/uazapi-webhook-emergency
// Arquivo novo para contornar cache extremamente persistente
// Data: 2025-12-18 - SOLUÇÃO GARANTIDA SEM CACHE

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  console.error('🚀 WEBHOOK EMERGENCY - CACHE BYPASS GARANTIDO - ARQUIVO NOVO');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔧 MÉTODO:', req.method);
  console.error('📡 USER-AGENT:', req.headers['user-agent']);
  console.error('🆘 EMERGENCY MODE - SEM CACHE VERCEL');

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
    console.log('📥 PAYLOAD RECEBIDO EMERGENCY:', JSON.stringify(req.body, null, 2));
    
    const result = await processMessage(req.body);
    
    if (result.success) {
      console.log('✅ SUCESSO EMERGENCY:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'WEBHOOK EMERGENCY - CACHE BYPASS SUCESSO!',
        timestamp: new Date().toISOString(),
        version: 'emergency-no-cache'
      });
    } else {
      console.log('⚠️ FILTRADO EMERGENCY:', result.error);
      res.status(200).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('❌ ERRO EMERGENCY:', error);
    res.status(200).json({ success: false, error: error.message });
  }
}

async function processMessage(payload) {
  console.log('🔑 SUPABASE CONECTADO - WEBHOOK EMERGENCY COM RPC DIRETO');
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  try {
    // Validações básicas
    if (!payload || !payload.message) {
      return { success: false, error: 'Payload inválido' };
    }

    const { message, instanceName } = payload;
    
    // Verificar se é mensagem de grupo (ignorar)
    if (message.isGroup) {
      return { success: false, error: 'Mensagem de grupo ignorada' };
    }

    // Verificar se é mensagem própria (ignorar)
    if (message.fromMe) {
      return { success: false, error: 'Mensagem própria ignorada' };
    }

    // Verificar se foi enviada via API (evitar loop)
    if (message.wasSentByApi) {
      return { success: false, error: 'Mensagem enviada via API ignorada' };
    }

    // Extrair dados da mensagem
    const phoneNumber = message.sender?.replace('@s.whatsapp.net', '') || 
                       message.chatid?.replace('@s.whatsapp.net', '') || 
                       payload.chat?.phone?.replace(/\D/g, '');
    
    const senderName = message.senderName || 
                      payload.chat?.name || 
                      payload.chat?.wa_contactName || 
                      'Contato';
    
    const content = message.text || message.content || '';
    const messageType = message.mediaType || 'text';
    const direction = message.fromMe ? 'outbound' : 'inbound';
    const uazapiMessageId = message.id || message.messageid;
    const profilePictureUrl = payload.chat?.imagePreview || null;
    
    console.log('📞 DADOS EXTRAÍDOS EMERGENCY:', {
      phoneNumber,
      senderName,
      content,
      messageType,
      direction,
      uazapiMessageId
    });
    
    // BUSCAR INSTÂNCIA E EMPRESA
    const { data: instanceData, error: instanceError } = await supabase
      .rpc('get_instance_company_for_webhook', {
        p_instance_name: instanceName
      });
    
    if (instanceError || !instanceData || instanceData.length === 0) {
      console.error('❌ ERRO RPC INSTÂNCIA EMERGENCY:', instanceError);
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const instanceInfo = instanceData[0];
    console.log('🏢 EMPRESA ENCONTRADA EMERGENCY:', instanceInfo.company_name);
    
    // USAR RPC PROCESS_WEBHOOK_MESSAGE_SAFE DIRETAMENTE
    const { data: result, error: processError } = await supabase
      .rpc('process_webhook_message_safe', {
        p_company_id: instanceInfo.company_id,
        p_instance_id: instanceInfo.instance_id,
        p_phone_number: phoneNumber,
        p_sender_name: senderName,
        p_content: content,
        p_message_type: messageType,
        p_media_url: null,
        p_direction: direction,
        p_uazapi_message_id: uazapiMessageId,
        p_profile_picture_url: profilePictureUrl
      });
    
    if (processError) {
      console.error('❌ ERRO RPC PROCESS EMERGENCY:', processError);
      return { success: false, error: 'Erro ao processar mensagem: ' + processError.message };
    }
    
    console.log('✅ SUCESSO RPC DIRETO EMERGENCY:', result);
    return {
      success: true,
      message_id: result.message_id,
      contact_id: result.contact_id,
      conversation_id: result.conversation_id,
      message: 'Processado via RPC direto EMERGENCY (cache bypass)'
    };

  } catch (error) {
    console.error('❌ ERRO GERAL EMERGENCY:', error);
    return { success: false, error: error.message };
  }
}

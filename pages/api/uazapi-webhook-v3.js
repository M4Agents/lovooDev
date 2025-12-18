// WEBHOOK UAZAPI V3 - SOLUÇÃO DEFINITIVA CACHE VERCEL
// Endpoint: /api/uazapi-webhook-v3 (NOVO ARQUIVO PARA FORÇAR CACHE MISS)
// Código V2 funcional aplicado em arquivo completamente novo
// Data: 2025-12-18 - SOLUÇÃO GARANTIDA SEM CACHE

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  console.error('🚀 WEBHOOK V3 - ARQUIVO NOVO - CACHE MISS GARANTIDO');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔧 MÉTODO:', req.method);
  console.error('📡 USER-AGENT:', req.headers['user-agent']);
  console.error('🎯 VERSÃO V3 - SOLUÇÃO DEFINITIVA VERCEL');

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
    console.log('📥 PAYLOAD RECEBIDO V3:', JSON.stringify(req.body, null, 2));
    
    const result = await processMessage(req.body);
    
    if (result.success) {
      console.log('✅ SUCESSO V3:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'WEBHOOK V3 - CACHE MISS GARANTIDO SUCESSO!',
        timestamp: new Date().toISOString(),
        version: 'v3-cache-miss-garantido'
      });
    } else {
      console.log('⚠️ FILTRADO V3:', result.error);
      res.status(200).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('❌ ERRO V3:', error);
    res.status(200).json({ success: false, error: error.message });
  }
}

async function processMessage(payload) {
  console.log('🔑 SUPABASE CONECTADO - WEBHOOK V3 COM RPC DIRETO');
  
  const supabase = createClient(
    'https://etzdsywunlpbgxkphuil.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE4NjI4NjEsImV4cCI6MjA0NzQzODg2MX0.Zt6Nt_Ej6Ue8Ky7Zt6Nt_Ej6Ue8Ky7Zt6Nt_Ej6Ue8Ky7'
  );

  try {
    // Validações básicas
    if (!payload || !payload.message) {
      return { success: false, error: 'Payload inválido' };
    }

    const message = payload.message;
    const instanceName = payload.instanceName;
    
    if (!instanceName) {
      return { success: false, error: 'Nome da instância não encontrado' };
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
    
    console.log('📞 DADOS EXTRAÍDOS V3:', {
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
      console.error('❌ ERRO RPC INSTÂNCIA V3:', instanceError);
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const instanceInfo = instanceData[0];
    console.log('🏢 EMPRESA ENCONTRADA V3:', instanceInfo.company_name);
    
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
      console.error('❌ ERRO RPC PROCESS V3:', processError);
      return { success: false, error: 'Erro ao processar mensagem: ' + processError.message };
    }
    
    console.log('✅ SUCESSO RPC DIRETO V3:', result);
    return {
      success: true,
      message_id: result.message_id,
      contact_id: result.contact_id,
      conversation_id: result.conversation_id,
      message: 'Processado via RPC direto V3 (cache miss garantido)'
    };

  } catch (error) {
    console.error('❌ ERRO GERAL V3:', error);
    return { success: false, error: error.message };
  }
}

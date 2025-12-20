// WEBHOOK UAZAPI OFICIAL - CÓDIGO V2 APLICADO DEFINITIVAMENTE
// Endpoint: /api/uazapi-webhook-final (URL OFICIAL CONFORME DOCUMENTAÇÃO)
// Código V2 funcional aplicado para invalidar cache persistente
// Data: 2025-12-18 - SOLUÇÃO DEFINITIVA CACHE VERCEL

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  console.error('🎬 MÍDIA RESTAURADA - 2025-12-20 06:49 - PROCESSAMENTO COMPLETO ATIVO');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔧 MÉTODO:', req.method);
  console.error('📡 USER-AGENT:', req.headers['user-agent']);
  console.error('🎯 ARQUIVO OFICIAL - CÓDIGO V2 APLICADO');

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
    console.log('📥 PAYLOAD RECEBIDO OFICIAL V2:', JSON.stringify(req.body, null, 2));
    
    const result = await processMessage(req.body);
    
    if (result.success) {
      console.log('✅ SUCESSO OFICIAL V2:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'WEBHOOK OFICIAL V2 - CACHE INVALIDADO SUCESSO!',
        timestamp: new Date().toISOString(),
        version: 'oficial-v2-cache-fixed'
      });
    } else {
      console.log('⚠️ FILTRADO OFICIAL V2:', result.error);
      res.status(200).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('❌ ERRO OFICIAL V2:', error);
    res.status(200).json({ success: false, error: error.message });
  }
}

async function processMessage(payload) {
  console.log('🔑 SUPABASE CONECTADO - WEBHOOK OFICIAL V2 COM RPC DIRETO');
  
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
    
    // DETECÇÃO DE MÍDIA RESTAURADA (PRÉ-RLS)
    const rawMessageType = (message.messageType || '').toLowerCase();
    const rawType = (message.type || '').toLowerCase();
    const rawMediaType = (message.mediaType || '').toLowerCase();

    const isTextMessage = rawMessageType === 'conversation' || rawMessageType === 'extendedtextmessage';
    const isMediaMessage = rawType === 'media' && !!rawMediaType;

    console.log('🎥 DETECÇÃO MÍDIA RESTAURADA:', { isTextMessage, isMediaMessage, rawType, rawMediaType });

    // EXTRAÇÃO DE CONTEÚDO E URL DE MÍDIA
    let content = message.text || '';
    let mediaUrl = null;

    if (!content && typeof message.content === 'string') {
      content = message.content;
    }

    if (isMediaMessage && message.content && typeof message.content === 'object') {
      mediaUrl = message.content.URL || message.content.url || null;
      console.log('📎 URL MÍDIA EXTRAÍDA:', mediaUrl ? mediaUrl.substring(0, 100) + '...' : 'NENHUMA');
    }

    const messageType = isMediaMessage ? rawMediaType : 'text';
    const direction = message.fromMe ? 'outbound' : 'inbound';
    const uazapiMessageId = message.id || message.messageid;
    const profilePictureUrl = payload.chat?.imagePreview || null;
    
    console.log('📞 DADOS EXTRAÍDOS OFICIAL V2:', {
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
      console.error('❌ ERRO RPC INSTÂNCIA OFICIAL V2:', instanceError);
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const instanceInfo = instanceData[0];
    console.log('🏢 EMPRESA ENCONTRADA OFICIAL V2:', instanceInfo.company_name);
    
    // PROCESSAMENTO DE MÍDIA RESTAURADO (PRÉ-RLS)
    let processedMediaUrl = null;
    
    if (isMediaMessage && mediaUrl) {
      console.log('🎬 INICIANDO PROCESSAMENTO DE MÍDIA...');
      
      try {
        // Download da mídia
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          console.error('❌ Falha ao baixar mídia:', response.status);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          
          console.log('📦 Mídia baixada, tamanho:', buffer.length, 'bytes');
          
          // Determinar extensão baseada no tipo
          let ext = 'bin';
          const contentType = response.headers.get('content-type');
          
          if (contentType) {
            if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
            else if (contentType.includes('png')) ext = 'png';
            else if (contentType.includes('gif')) ext = 'gif';
            else if (contentType.includes('pdf')) ext = 'pdf';
            else if (contentType.includes('audio')) ext = 'ogg';
            else if (contentType.includes('mp4')) ext = 'mp4';
            else if (contentType.includes('webp')) ext = 'webp';
          } else if (rawMediaType) {
            if (rawMediaType === 'image') ext = 'jpg';
            else if (rawMediaType === 'audio' || rawMediaType === 'ptt') ext = 'ogg';
            else if (rawMediaType === 'video') ext = 'mp4';
            else if (rawMediaType === 'document') ext = 'pdf';
          }
          
          const fileName = `${instanceInfo.company_id}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
          
          console.log('📁 Fazendo upload para Supabase Storage:', fileName);
          
          // Upload para Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('chat-media')
            .upload(fileName, buffer, {
              contentType: contentType || undefined,
              upsert: true
            });
          
          if (uploadError) {
            console.error('❌ Erro no upload:', uploadError);
          } else {
            // Obter URL pública
            const { data: publicData } = supabase.storage
              .from('chat-media')
              .getPublicUrl(fileName);
            
            processedMediaUrl = publicData?.publicUrl;
            console.log('✅ MÍDIA PROCESSADA:', processedMediaUrl ? 'SUCESSO' : 'FALHOU');
          }
        }
      } catch (error) {
        console.error('❌ ERRO PROCESSAMENTO MÍDIA:', error);
      }
    }
    
    // USAR RPC PROCESS_WEBHOOK_MESSAGE_SAFE COM MÍDIA PROCESSADA
    const { data: result, error: processError } = await supabase
      .rpc('process_webhook_message_safe', {
        p_company_id: instanceInfo.company_id,
        p_instance_id: instanceInfo.instance_id,
        p_phone_number: phoneNumber,
        p_sender_name: senderName,
        p_content: content,
        p_message_type: messageType,
        p_media_url: processedMediaUrl,
        p_direction: direction,
        p_uazapi_message_id: uazapiMessageId,
        p_profile_picture_url: profilePictureUrl
      });
    
    if (processError) {
      console.error('❌ ERRO RPC PROCESS OFICIAL V2:', processError);
      return { success: false, error: 'Erro ao processar mensagem: ' + processError.message };
    }
    
    console.log('✅ SUCESSO RPC DIRETO OFICIAL V2:', result);
    return {
      success: true,
      message_id: result.message_id,
      contact_id: result.contact_id,
      conversation_id: result.conversation_id,
      message: 'Processado via RPC direto OFICIAL V2 (cache invalidated)'
    };

  } catch (error) {
    console.error('❌ ERRO GERAL OFICIAL V2:', error);
    return { success: false, error: error.message };
  }
}

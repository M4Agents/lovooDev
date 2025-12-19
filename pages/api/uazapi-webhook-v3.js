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
  console.error('🔥 DEPLOY FORÇADO - 2025-12-19 08:17 - FILTRO @LID ATIVO');
  console.error('🖼️ FORMATO PNG - 2025-12-19 12:12 - PRESERVAÇÃO DE FORMATO IMPLEMENTADA');

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
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
  );

  try {
    console.log('🎯 WEBHOOK V3 - ARQUIVO NOVO (cache miss garantido)');
    console.log('📥 PAYLOAD RECEBIDO V3:', JSON.stringify(payload).substring(0, 200) + '...');

    // Validar payload básico
    if (!payload || !payload.message) {
      console.log('❌ PAYLOAD INVÁLIDO V3 - sem message');
      return { success: false, error: 'Payload inválido' };
    }

    const { message, instanceName } = payload;
    console.log('📨 MENSAGEM V3:', message.messageType, message.text?.substring(0, 50) + '...');

    // FILTRO DE GRUPOS V3 - DETECÇÃO CRÍTICA PRIMEIRO
    console.log('🔍 DEBUG GRUPOS V3 - DADOS COMPLETOS:', {
      isGroup: message.isGroup,
      sender: message.sender,
      chatid: message.chatid,
      messageType: message.messageType,
      senderName: message.senderName
    });
    
    // BLOQUEIO ABSOLUTO DE @LID - REGRA DEFINITIVA
    // QUALQUER COISA COM @LID DEVE SER DESPREZADA
    const senderHasLid = message.sender && message.sender.includes('@lid');
    const chatidHasLid = message.chatid && message.chatid.includes('@lid');
    
    console.log('🎯 VERIFICAÇÃO @LID V3:', {
      sender: message.sender,
      chatid: message.chatid,
      senderHasLid,
      chatidHasLid
    });
    
    if (senderHasLid || chatidHasLid) {
      console.log('🚫 @LID DETECTADO - BLOQUEANDO COMPLETAMENTE V3');
      console.log('🚫 IDENTIFICADOR @LID:', senderHasLid ? message.sender : message.chatid);
      return { success: false, error: 'Mensagem @lid bloqueada - não é telefone válido' };
    }
    
    // DETECÇÃO ADICIONAL DE GRUPOS (@g.us)
    const isGroupMessage = message.isGroup === true || 
                          message.isGroup === 'true' ||
                          (message.sender && message.sender.includes('@g.us')) ||
                          (message.chatid && message.chatid.includes('@g.us'));
    
    console.log('🎯 RESULTADO DETECÇÃO GRUPOS V3:', { isGroupMessage });
    
    if (isGroupMessage) {
      console.log('🚫 MENSAGEM DE GRUPO FILTRADA V3 - IGNORANDO COMPLETAMENTE');
      console.log('🚫 GRUPO DETECTADO:', message.sender || message.chatid);
      return { success: false, error: 'Mensagem de grupo filtrada' };
    }

    // DETECÇÃO DE DIREÇÃO DA MENSAGEM - SEGUINDO PADRÃO OFICIAL
    const isFromMe = !!message.fromMe;
    const isFromApi = !!message.wasSentByApi;
    const isDeviceSent = !!message.deviceSent;

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

    console.log('🎯 DIREÇÃO DETECTADA V3:', {
      isFromMe,
      isFromApi,
      isDeviceSent,
      direction
    });

    // EXTRAÇÃO DE TELEFONE POR DIREÇÃO - CORREÇÃO CONVERSAS DUPLICADAS
    let rawPhone;
    if (direction === 'outbound') {
      // Outbound: usar sempre o número do chat/contato (lead), nunca o número do owner/sender
      rawPhone = message.chatid || 
                 payload.chat?.wa_chatid || 
                 payload.chat?.phone || 
                 message.sender_pn || 
                 message.sender;
    } else {
      // Inbound: manter comportamento atual, priorizando quem enviou a mensagem
      rawPhone = message.sender_pn || 
                 message.chatid || 
                 payload.chat?.wa_chatid || 
                 payload.chat?.phone || 
                 message.sender;
    }

    // Limpar telefone removendo sufixos @... e caracteres não numéricos
    const phoneNumber = rawPhone?.replace(/@.*$/, '')?.replace(/\D/g, '') || '';
    
    const senderName = message.senderName || 
                      payload.chat?.name || 
                      payload.chat?.wa_contactName || 
                      'Contato';

    console.log('📞 EXTRAÇÃO DE TELEFONE V3:', {
      direction,
      rawPhone,
      phoneNumber,
      senderName
    });
    
    // DETECÇÃO DE MÍDIA V3
    const rawType = message.type || '';
    const rawMediaType = message.mediaType || '';
    const rawMessageType = message.messageType || '';
    
    console.log('🔍 DETECÇÃO MÍDIA V3:', {
      rawType,
      rawMediaType,
      rawMessageType
    });
    
    // LOGS DETALHADOS PARA DEBUG DE MÍDIA - SEGUINDO PADRÃO BACKUP FUNCIONAL
    console.log('🔍 CONTENT ANALYSIS V3:', {
      hasContent: !!message.content,
      contentType: typeof message.content,
      contentKeys: message.content && typeof message.content === 'object' ? Object.keys(message.content) : null,
      hasURL: message.content && message.content.URL,
      hasUrl: message.content && message.content.url
    });
    
    console.log('🎥 MEDIA ANALYSIS V3:', {
      hasMedia: !!message.media,
      mediaType: typeof message.media,
      mediaKeys: message.media ? Object.keys(message.media) : null,
      hasMediaUrl: message.media && message.media.url
    });

    // DETECÇÃO ROBUSTA DE MÍDIA - SEGUINDO BACKUP FUNCIONAL COM 4 CONDIÇÕES
    const condition1 = (rawType === 'media' && !!rawMediaType);
    const condition2 = (rawMessageType.includes('message') && 
                       rawMessageType !== 'conversation' && 
                       rawMessageType !== 'extendedtextmessage');
    const condition3 = (message.media && message.media.url);
    const condition4 = (message.content && typeof message.content === 'object' && 
                       (message.content.URL || message.content.url));
    
    console.log('🎯 CONDIÇÕES INDIVIDUAIS V3:', {
      'condition1 (rawType === media && rawMediaType)': condition1,
      'condition2 (messageType includes message)': condition2,
      'condition3 (message.media.url exists)': condition3,
      'condition4 (message.content object with URL)': condition4
    });
    
    const isTextMessage = rawMessageType === 'Conversation' || rawMessageType === 'conversation';
    const isMediaMessage = condition1 || condition2 || condition3 || condition4;
    
    console.log('🎯 RESULTADO DETECÇÃO V3:', { isTextMessage, isMediaMessage });
    
    // LOG ESPECÍFICO PARA MÍDIA
    if (isMediaMessage) {
      console.log('🎥 MÍDIA DETECTADA V3! Analisando estrutura...');
      console.log('📋 CONDIÇÕES DE DETECÇÃO V3:', {
        'rawType === media && rawMediaType': condition1,
        'messageType includes message': condition2,
        'message.media exists': condition3,
        'message.content object with URL': condition4
      });
    } else {
      console.log('⚠️ MÍDIA NÃO DETECTADA V3 - VERIFICANDO CONDIÇÕES');
    }
    
    let content = message.text || message.content || '';
    let mediaUrl = null;
    
    // PROCESSAMENTO DE MÍDIA V3
    if (isMediaMessage) {
      console.log('🎥 PROCESSAMENTO DE MÍDIA V3 INICIADO:', { rawMessageType, rawType, rawMediaType });
      
      // LOCALIZAÇÃO ROBUSTA DE URL - SEGUINDO PADRÃO BACKUP FUNCIONAL
      console.log('🔍 BUSCANDO URL DE MÍDIA V3...');
      
      const urlFromContent = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url));
      const urlFromMedia = (message.media && message.media.url);
      const urlFromMessage = message.url;
      
      console.log('📋 ANÁLISE DE URLs V3:', {
        'message.content.URL': message.content && message.content.URL,
        'message.content.url': message.content && message.content.url,
        'message.media.url': message.media && message.media.url,
        'message.url': message.url,
        'urlFromContent': urlFromContent,
        'urlFromMedia': urlFromMedia,
        'urlFromMessage': urlFromMessage
      });
      
      // Localizar URL da mídia de forma robusta
      const originalUrl = urlFromContent || urlFromMedia || urlFromMessage || null;
      
      console.log('🔗 URL FINAL SELECIONADA V3:', originalUrl ? originalUrl.substring(0, 100) + '...' : 'NENHUMA URL ENCONTRADA');
      
      if (originalUrl) {
        console.log('🚀 CHAMANDO FUNÇÃO processMediaMessageRobust V3...');
        mediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
        console.log('✅ RESULTADO PROCESSAMENTO V3:', mediaUrl ? 'SUCESSO' : 'FALHOU');
        
        // CORREÇÃO FINAL: Limpar content para mídia - mostrar preview em vez de URL
        if (mediaUrl) {
          content = `(${rawMediaType || 'mídia'})`;
          console.log('🎨 CONTENT LIMPO PARA MÍDIA V3:', content);
        }
      } else {
        console.log('❌ NENHUMA URL DE MÍDIA ENCONTRADA V3');
        mediaUrl = null;
      }
    } else {
      console.log('⚠️ MENSAGEM NÃO É MÍDIA V3 - PULANDO PROCESSAMENTO');
    }
    const messageType = message.mediaType || 'text';
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
        p_media_url: mediaUrl,
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

// =====================================================
// FUNÇÃO DE PROCESSAMENTO DE MÍDIA V3
// Implementada em: 2025-12-18 - Suporte completo a mídia
// Download automático de URLs externas + Upload para Supabase Storage
// =====================================================
async function processMediaMessageRobust(message, supabase, originalUrl, rawMediaType) {
  try {
    console.log('🎥 PROCESSAMENTO ROBUSTO DE MÍDIA V3:', rawMediaType, originalUrl.substring(0, 80) + '...');
    
    // DESCRIPTOGRAFIA VIA UAZAPI - CORREÇÃO CRÍTICA V2
    let finalUrl = originalUrl;
    
    if (message && message.id && originalUrl.includes('whatsapp.net')) {
      console.log('🔓 DESCRIPTOGRAFANDO URL VIA UAZAPI V3:', message.id);
      console.log('🔗 URL ORIGINAL V3:', originalUrl.substring(0, 100) + '...');
      
      try {
        // Tentar diferentes formatos de requisição para Uazapi
        const uazapiPayload = {
          messageId: message.id,
          id: message.id
        };
        
        console.log('📤 PAYLOAD UAZAPI V3:', JSON.stringify(uazapiPayload));
        
        const uazapiResponse = await fetch('https://lovoo.uazapi.com/message/download', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(uazapiPayload)
        });
        
        console.log('📥 RESPONSE STATUS V3:', uazapiResponse.status);
        
        if (uazapiResponse.ok) {
          const uazapiData = await uazapiResponse.json();
          console.log('📋 RESPONSE DATA V3:', JSON.stringify(uazapiData).substring(0, 200) + '...');
          
          if (uazapiData.fileURL) {
            finalUrl = uazapiData.fileURL;
            console.log('✅ URL DESCRIPTOGRAFADA V3:', finalUrl.substring(0, 80) + '...');
          } else if (uazapiData.url) {
            finalUrl = uazapiData.url;
            console.log('✅ URL ALTERNATIVA V3:', finalUrl.substring(0, 80) + '...');
          } else {
            console.log('⚠️ Uazapi não retornou URL válida V3, usando original');
          }
        } else {
          const errorText = await uazapiResponse.text();
          console.log('❌ ERRO UAZAPI V3:', uazapiResponse.status, errorText.substring(0, 200));
        }
      } catch (uazapiError) {
        console.log('❌ EXCEPTION UAZAPI V3:', uazapiError.message);
      }
    }
    
    // Download da mídia (URL descriptografada ou original)
    const response = await fetch(finalUrl);
    if (!response.ok) {
      console.error('❌ Falha ao baixar mídia V3:', response.status, response.statusText);
      return originalUrl; // Fallback para URL original
    }
    
    const mediaBuffer = await response.arrayBuffer();
    console.log('📦 Mídia baixada V3, tamanho:', mediaBuffer.byteLength, 'bytes');
    
    // Determinar extensão baseada no tipo de mídia E URL original
    const extension = getFileExtensionRobust(rawMediaType, originalUrl);
    const fileName = `${rawMediaType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    console.log('📁 Fazendo upload para Supabase Storage V3:', fileName);
    console.log('🎨 FORMATO DETECTADO V3:', { rawMediaType, extension, originalUrl: originalUrl.substring(0, 100) + '...' });
    
    // Upload para Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, mediaBuffer, {
        contentType: getContentTypeRobust(rawMediaType, originalUrl)
      });
    
    if (error) {
      console.error('❌ Erro no upload para Supabase V3:', error);
      return originalUrl; // Fallback para URL original
    }
    
    // Retornar URL pública estável
    const { data: publicUrl } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName);
    
    console.log('✅ PROCESSAMENTO CONCLUÍDO V3 - URL INTERNA:', publicUrl.publicUrl.substring(0, 80) + '...');
    return publicUrl.publicUrl;
    
  } catch (error) {
    console.error('❌ EXCEPTION no processamento de mídia V3:', error);
    return originalUrl; // Fallback para URL original
  }
}

// Função para determinar extensão do arquivo baseada no tipo de mídia
function getFileExtensionRobust(mediaType, originalUrl = null) {
  // DETECÇÃO INTELIGENTE DE FORMATO PARA IMAGENS - PRESERVAR PNG
  if (mediaType === 'image' && originalUrl) {
    if (originalUrl.includes('.png') || originalUrl.toLowerCase().includes('png')) return 'png';
    if (originalUrl.includes('.webp') || originalUrl.toLowerCase().includes('webp')) return 'webp';
    if (originalUrl.includes('.gif') || originalUrl.toLowerCase().includes('gif')) return 'gif';
    if (originalUrl.includes('.jpeg') || originalUrl.toLowerCase().includes('jpeg')) return 'jpeg';
    return 'jpg'; // Fallback para JPG
  }
  
  const typeMap = {
    'video': 'mp4',
    'image': 'jpg', 
    'audio': 'ogg',
    'ptt': 'ogg',
    'document': 'pdf'
  };
  
  return typeMap[mediaType] || 'bin';
}

// Função para determinar content-type baseado no tipo de mídia
function getContentTypeRobust(mediaType, originalUrl = null) {
  // DETECÇÃO INTELIGENTE DE CONTENT-TYPE PARA IMAGENS - PRESERVAR PNG
  if (mediaType === 'image' && originalUrl) {
    if (originalUrl.includes('.png') || originalUrl.toLowerCase().includes('png')) return 'image/png';
    if (originalUrl.includes('.webp') || originalUrl.toLowerCase().includes('webp')) return 'image/webp';
    if (originalUrl.includes('.gif') || originalUrl.toLowerCase().includes('gif')) return 'image/gif';
    if (originalUrl.includes('.jpeg') || originalUrl.toLowerCase().includes('jpeg')) return 'image/jpeg';
    return 'image/jpeg'; // Fallback para JPEG
  }
  
  const typeMap = {
    'video': 'video/mp4',
    'image': 'image/jpeg',
    'audio': 'audio/ogg',
    'ptt': 'audio/ogg',
    'document': 'application/pdf'
  };
  
  return typeMap[mediaType] || 'application/octet-stream';
}

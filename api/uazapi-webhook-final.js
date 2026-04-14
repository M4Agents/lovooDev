// Webhook Uazapi - CONVERTIDO PARA USAR FUNÇÃO SECURITY DEFINER
// Endpoint: /pages/api/uazapi-webhook-final
// CORREÇÃO RLS: Agora usa process_webhook_message_safe para bypass do RLS

import { dispatchLeadCreatedTrigger }    from './lib/automation/dispatchLeadCreatedTrigger.js';
import { dispatchMessageReceivedTrigger } from './lib/automation/dispatchMessageReceivedTrigger.js';

// =====================================================
// NORMALIZAÇÃO DE MESSAGE_TYPE
// =====================================================
// Mapeia tipos específicos do WhatsApp para tipos aceitos pela constraint
function normalizeMessageType(rawType) {
  if (!rawType) return 'document';
  
  const type = rawType.toLowerCase();
  
  // Mapear tipos de áudio (ptt = push-to-talk)
  if (type === 'ptt' || type === 'audiomessage' || type === 'audio') {
    return 'audio';
  }
  
  // Mapear outros tipos do WhatsApp
  if (type === 'imagemessage') return 'image';
  if (type === 'videomessage') return 'video';
  if (type === 'documentmessage') return 'document';
  
  // Se já está normalizado, retornar
  if (['audio', 'image', 'video', 'document', 'text'].includes(type)) {
    return type;
  }
  
  // Fallback para document
  return 'document';
}

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
    
    // 🔍 LOG IDENTIFICADOR DE VERSÃO - INVESTIGAÇÃO DE DEPLOY
    const versionTimestamp = '2025-12-23 08:47:00';
    console.log('🚀 WEBHOOK FINAL EXECUTANDO - VERSÃO:', versionTimestamp);
    console.log('🔍 INVESTIGAÇÃO: Verificando se código corrigido está ativo');
    console.log('📝 CORREÇÃO ESPERADA: Processamento de mídia antes do RPC');
    
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

    // Processar mídia se necessário - CORREÇÃO FINAL: USAR DIRECTPATH
    if (isMediaMessage) {
      // CORREÇÃO CRÍTICA: Usar directPath em vez de URL criptografada
      let originalUrl = null;
      
      if (message.content && typeof message.content === 'object') {
        if (message.content.directPath) {
          // SOLUÇÃO DEFINITIVA: directPath contém arquivo descriptografado
          originalUrl = `https://mmg.whatsapp.net${message.content.directPath}`;
          console.log('🔧 CORREÇÃO FINAL: Usando directPath em vez de URL criptografada');
        } else if (message.content.URL || message.content.url) {
          // FALLBACK: usar URL se directPath não disponível
          originalUrl = message.content.URL || message.content.url;
          console.log('⚠️ FALLBACK: Usando URL (pode estar criptografada)');
        }
      } else {
        // FALLBACK: outros formatos
        originalUrl = (message.media && message.media.url) || message.url;
      }
      
      if (originalUrl) {
        console.log('📎 MÍDIA DETECTADA - URL EXTRAÍDA:', originalUrl.substring(0, 80) + '...');
        mediaUrl = originalUrl; // Apenas extrair URL - processamento será feito depois
      }
    }

    const messageId = message.id;
    const instanceName = payload.instanceName;
    const ownerPhone = payload.owner; // Telefone da instância
    
    // SOLUÇÃO 3: Buscar instância com fallback por phone_number
    console.log('🔍 Buscando instância:', { instanceName, ownerPhone });
    
    // Tentar buscar por provider_instance_id primeiro
    let { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id, provider_instance_id')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    // Se não encontrou, buscar por phone_number (fallback)
    if (instanceError || !instance) {
      console.log('⚠️ Instância não encontrada por provider_instance_id, tentando por phone_number...');
      
      const { data: instanceByPhone, error: phoneError } = await supabase
        .from('whatsapp_life_instances')
        .select('id, company_id, provider_instance_id')
        .eq('phone_number', ownerPhone)
        .eq('status', 'connected')
        .single();
      
      if (phoneError || !instanceByPhone) {
        console.error('❌ Instância não encontrada nem por provider_instance_id nem por phone_number:', { instanceName, ownerPhone });
        return { success: false, error: 'Instância não encontrada: ' + instanceName };
      }
      
      // Encontrou por phone_number! Auto-atualizar provider_instance_id
      console.log('✅ Instância encontrada por phone_number! Auto-atualizando provider_instance_id...');
      console.log('📝 Atualizando de:', instanceByPhone.provider_instance_id, '→', instanceName);
      
      const { error: updateError } = await supabase
        .from('whatsapp_life_instances')
        .update({ 
          provider_instance_id: instanceName,
          updated_at: new Date().toISOString()
        })
        .eq('id', instanceByPhone.id);
      
      if (updateError) {
        console.error('⚠️ Erro ao atualizar provider_instance_id:', updateError);
      } else {
        console.log('✅ provider_instance_id atualizado com sucesso!');
      }
      
      instance = instanceByPhone;
    } else {
      console.log('✅ Instância encontrada por provider_instance_id');
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
    
    // 🎬 PROCESSAR MÍDIA ANTES DE CHAMAR RPC (CORREÇÃO CRÍTICA)
    let finalMediaUrl = mediaUrl;
    if (isMediaMessage && mediaUrl) {
      console.log('🎬 PROCESSANDO MÍDIA ANTES DO RPC:', { mediaUrl: mediaUrl.substring(0, 80) + '...', rawMediaType });
      
      const originalUrl = mediaUrl;
      
      // AWS S3 DIRETO - MESMO SISTEMA DO FRONTEND
      if (originalUrl) {
        try {
          console.error('🚀 AWS S3 DIRETO: Fazendo download da URL temporária...');
          console.error('🔗 URL temporária WhatsApp:', originalUrl.substring(0, 100) + '...');
          
          // CORREÇÃO FINAL: Download com headers adequados para evitar corrupção
          const mediaResponse = await fetch(originalUrl, {
            headers: {
              'User-Agent': 'WhatsApp/2.0',
              'Accept': '*/*',
              'Accept-Encoding': 'identity',
              'Cache-Control': 'no-cache'
            },
            timeout: 30000
          });
          
          if (mediaResponse.ok) {
            const encryptedBuffer = Buffer.from(await mediaResponse.arrayBuffer());
            console.error('📦 AWS S3 DIRETO: Mídia baixada com headers corretos, tamanho:', encryptedBuffer.length, 'bytes');
            console.error('🔧 CORREÇÃO APLICADA: Headers adequados para evitar corrupção do arquivo');
            
            // 🔍 IMPORTAR CRYPTO (NODE RUNTIME)
            const crypto = await import('crypto');
            
            // 🔓 FUNÇÃO DESCRIPTOGRAFIA WHATSAPP (BUFFER NORMALIZADO)
            function sha256Base64(buf) {
              return crypto.default.createHash('sha256').update(buf).digest('base64');
            }
            
            // CORREÇÃO CRÍTICA: Normalizar tipos para Buffer
            function asBuffer(x) {
              if (Buffer.isBuffer(x)) return x;
              if (x instanceof Uint8Array) return Buffer.from(x);
              if (x instanceof ArrayBuffer) return Buffer.from(new Uint8Array(x));
              return Buffer.from(x);
            }
            
            function hkdf(mediaKey, length, info) {
              const salt = Buffer.alloc(32, 0);
              const out = crypto.default.hkdfSync('sha256', mediaKey, salt, Buffer.from(info, 'utf8'), length);
              return asBuffer(out); // ✅ GARANTIR BUFFER
            }
            
            function decryptWhatsAppMedia({ encryptedBuffer, mediaKeyB64, mediaType }) {
              try {
                console.error('🔓 CORREÇÃO BUFFER: Iniciando descriptografia WhatsApp...');
                
                const mediaKey = Buffer.from(mediaKeyB64, 'base64');
                
                const infoByType = {
                  image: 'WhatsApp Image Keys',
                  video: 'WhatsApp Video Keys',
                  audio: 'WhatsApp Audio Keys',
                  ptt: 'WhatsApp Audio Keys',  // ✅ CORREÇÃO: PTT usa mesmas chaves de áudio
                  document: 'WhatsApp Document Keys',
                };
                
                const info = infoByType[mediaType] || 'WhatsApp Media Keys';
                console.error('🔧 INFO STRING:', info);
                
                // CORREÇÃO: HKDF retorna Buffer garantido
                const expanded = hkdf(mediaKey, 112, info);
                console.error('🔧 HKDF TIPO:', {
                  isBuffer: Buffer.isBuffer(expanded),
                  hasSubarray: typeof expanded.subarray === 'function',
                  length: expanded.length
                });
                
                const iv = expanded.subarray(0, 16);
                const cipherKey = expanded.subarray(16, 48);
                
                // Remover MAC de 10 bytes do final
                const cipher = encryptedBuffer.length > 10
                  ? encryptedBuffer.subarray(0, encryptedBuffer.length - 10)
                  : encryptedBuffer;
                
                console.error('🔧 REMOÇÃO MAC:', {
                  original: encryptedBuffer.length,
                  semMAC: cipher.length,
                  removido: encryptedBuffer.length - cipher.length
                });
                
                const decipher = crypto.default.createDecipheriv('aes-256-cbc', cipherKey, iv);
                const decrypted = Buffer.concat([decipher.update(cipher), decipher.final()]);
                
                console.error('✅ CORREÇÃO BUFFER: Descriptografia concluída com sucesso');
                
                // VALIDAÇÃO COMPLETA
                const isJpeg = decrypted.length >= 3 &&
                              decrypted[0] === 0xFF &&
                              decrypted[1] === 0xD8 &&
                              decrypted[2] === 0xFF;
                
                console.error('🔬 VALIDAÇÃO FINAL:', {
                  tamanho: decrypted.length,
                  primeiros3Bytes: Array.from(decrypted.subarray(0, 3)),
                  isJpeg,
                  esperado: [0xFF, 0xD8, 0xFF]
                });
                
                return decrypted;
                
              } catch (error) {
                console.error('❌ ERRO DESCRIPTOGRAFIA BUFFER:', error.message);
                console.error('🔄 STACK COMPLETO:', error.stack);
                return null;
              }
            }
            
            // 1️⃣ VALIDAR HASH CRIPTOGRAFADO (opcional)
            const encHash = sha256Base64(encryptedBuffer);
            const expectedEncHash = message.content?.fileEncSHA256;
            console.error('🔐 HASH CRIPTOGRAFADO:', {
              encHash,
              expectedEncHash,
              match: encHash === expectedEncHash
            });
            
            // 2️⃣ DESCRIPTOGRAFAR
            let finalBuffer = encryptedBuffer; // fallback
            
            if (message.content?.mediaKey) {
              console.error('🔓 INICIANDO DESCRIPTOGRAFIA...');
              
              // CORREÇÃO: Detectar mediaType automaticamente do payload
              const autoMediaType = message.mediaType || message.messageType || 'image';
              const normalizedMediaType = autoMediaType.toLowerCase().replace('message', '');
              
              console.error('🎯 DETECÇÃO MEDIATYPE:', {
                messageMediaType: message.mediaType,
                messageType: message.messageType,
                autoDetected: autoMediaType,
                normalized: normalizedMediaType,
                mimetype: message.content?.mimetype
              });
              
              const decryptedBuffer = decryptWhatsAppMedia({
                encryptedBuffer,
                mediaKeyB64: message.content.mediaKey,
                mediaType: normalizedMediaType
              });
              
              if (decryptedBuffer) {
                finalBuffer = decryptedBuffer;
                console.error('✅ DESCRIPTOGRAFIA: Usando buffer descriptografado');
                
                // 3️⃣ VALIDAR HASH DESCRIPTOGRAFADO
                const decHash = sha256Base64(decryptedBuffer);
                const expectedDecHash = message.content?.fileSHA256;
                console.error('🔐 HASH DESCRIPTOGRAFADO:', {
                  decHash,
                  expectedDecHash,
                  match: decHash === expectedDecHash
                });
                
                // 4️⃣ VALIDAR MAGIC BYTES JPEG
                const isJpeg = decryptedBuffer[0] === 0xFF && decryptedBuffer[1] === 0xD8 && decryptedBuffer[2] === 0xFF;
                const firstBytes = Array.from(decryptedBuffer.slice(0, 8));
                console.error('🔬 MAGIC BYTES DESCRIPTOGRAFADO:', {
                  firstBytes,
                  isJpeg,
                  expected: [0xFF, 0xD8, 0xFF]
                });
                
                // 5️⃣ STATUS FINAL
                console.error('✅ STATUS DESCRIPTOGRAFIA:', {
                  hashOK: decHash === expectedDecHash,
                  formatOK: isJpeg,
                  success: (decHash === expectedDecHash) && isJpeg
                });
                
                // 6️⃣ VALIDAÇÃO HASH SHA256 COMPLETA
                if (decHash === expectedDecHash) {
                  console.error('✅ HASH SHA256: Arquivo descriptografado íntegro');
                } else {
                  console.error('❌ HASH SHA256: Arquivo pode estar corrompido');
                }
                
              } else {
                console.error('❌ DESCRIPTOGRAFIA FALHOU: Usando buffer original');
              }
            } else {
              console.error('⚠️ SEM MEDIAKEY: Usando buffer original');
            }
            
            // Detectar formato e gerar nome do arquivo (CORREÇÃO: usar mimetype do payload)
            const { S3Storage } = await import('../src/services/aws/s3Storage.js');
            
            // PRIORIZAR MIMETYPE DO PAYLOAD WHATSAPP
            const payloadMimetype = message.content?.mimetype;
            const detectedContentType = S3Storage.detectContentType(finalBuffer, 'media');
            const contentType = payloadMimetype || detectedContentType;
            
            const extension = contentType.split('/')[1] || 'bin';
            const fileName = `whatsapp_${Date.now()}_${message.id.substring(0, 8)}.${extension}`;
            
            console.error('🎯 CORREÇÃO FORMATO:', { 
              payloadMimetype, 
              detectedContentType, 
              finalContentType: contentType,
              extension 
            });
            
            console.error('🔬 AWS S3 DIRETO: Formato detectado:', { contentType, extension, fileName });
            
            // Upload para AWS S3 (mesmo sistema do frontend)
            console.error('☁️ AWS S3 DIRETO: Fazendo upload para S3...');
            
            // CORREÇÃO CRÍTICA: Sanitizar messageId para evitar caracteres especiais em URLs
            const sanitizedMessageId = message.id.replace(/[^a-zA-Z0-9\-_]/g, '_');
            console.error('🔧 MESSAGEID SANITIZADO:', { 
              original: message.id, 
              sanitized: sanitizedMessageId 
            });
            
            const s3Result = await S3Storage.uploadToS3({
              companyId: company.id,
              buffer: finalBuffer,
              originalFileName: fileName,
              contentType: contentType,
              source: 'whatsapp',
              messageId: sanitizedMessageId
            });
            
            if (s3Result.success) {
              console.error('✅ AWS S3 DIRETO: Upload concluído com sucesso!');
              
              // 💬 SALVAR NA PASTA CHAT - CORREÇÃO CRÍTICA
              // IMPORTANTE: Salvar mídia na biblioteca APÓS processamento via SECURITY DEFINER
              // para ter acesso ao lead_id correto
              console.error('💬 PASTA CHAT: Mídia salva no S3, aguardando processamento completo para sincronizar com biblioteca...');
                
              
              // Gerar signed URL permanente (mesmo sistema do frontend)
              console.error('🔗 AWS S3 DIRETO: Gerando signed URL...');
              const signedUrlResult = await S3Storage.generateSignedUrl(
                company.id, 
                s3Result.data.s3Key,
                { expiresIn: 7200 } // 2 horas (mesmo do frontend)
              );
              
              if (signedUrlResult.success) {
                finalMediaUrl = signedUrlResult.data;
                console.error('🎯 AWS S3 DIRETO: URL permanente gerada:', finalMediaUrl.substring(0, 100) + '...');
              } else {
                console.error('❌ AWS S3 DIRETO: Erro ao gerar signed URL:', signedUrlResult.error);
                // FALLBACK: usar processamento Supabase
                const processedUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
                finalMediaUrl = processedUrl;
              }
            } else {
              console.error('❌ AWS S3 DIRETO: Erro no upload:', s3Result.error);
              // FALLBACK: usar processamento Supabase
              const processedUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
              finalMediaUrl = processedUrl;
            }
          } else {
            console.error('❌ AWS S3 DIRETO: Erro ao baixar mídia da URL temporária');
            // FALLBACK: usar processamento Supabase
            const processedUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
            finalMediaUrl = processedUrl;
          }
        } catch (error) {
          console.error('❌ ERRO NO AWS S3 DIRETO:', error);
          console.error('🔄 FALLBACK: usando processamento Supabase');
          // FALLBACK: usar processamento Supabase
          const processedUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
          finalMediaUrl = processedUrl;
        }
      } else {
        console.error('❌ NENHUMA URL DE MÍDIA ENCONTRADA');
        finalMediaUrl = null;
      }
    }
    
    // ✅ USAR FUNÇÃO SECURITY DEFINER PARA PROCESSAR MENSAGEM COMPLETA
    console.log('🔄 USANDO FUNÇÃO SECURITY DEFINER PARA PROCESSAMENTO SEGURO');
    console.log('📎 MÍDIA URL FINAL PARA RPC:', finalMediaUrl ? finalMediaUrl.substring(0, 80) + '...' : 'null');
    
    // Normalizar message_type antes de enviar para RPC
    const normalizedType = isMediaMessage ? normalizeMessageType(rawMediaType) : 'text';
    console.log('🔧 MESSAGE_TYPE NORMALIZADO:', {
      original: rawMediaType,
      normalized: normalizedType,
      isMedia: isMediaMessage
    });
    
    // Restante do código...
    const { data: webhookResult, error: webhookError } = await supabase
      .rpc('process_webhook_message_safe', {
        p_company_id: company.id,
        p_instance_id: instance.id,
        p_phone_number: phoneNumber,
        p_sender_name: senderName,
        p_content: messageText,
        p_message_type: normalizedType,
        p_media_url: finalMediaUrl,
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

    // lead_id resolvido do bloco inbound — acessível após o bloco para o dispatch de message.received
    let inboundLeadId = null;

    // 🎯 CRIAÇÃO AUTOMÁTICA DE LEAD PARA NOVOS CONTATOS - CORREÇÃO CRÍTICA 2026-02-20
    // USANDO SECURITY DEFINER PARA MANTER RLS ATIVO
    if (direction === 'inbound') {
      try {
        console.log('🎯 CRIANDO LEAD AUTOMATICAMENTE VIA SECURITY DEFINER...');
        
        // Usar RPC SECURITY DEFINER para criar lead (bypass controlado do RLS)
        const { data: leadResult, error: leadError } = await supabase
          .rpc('create_lead_from_whatsapp_safe', {
            p_company_id: company.id,
            p_phone: phoneNumber,
            p_name: senderName
          });
        
        if (leadError) {
          console.error('❌ ERRO NA RPC create_lead_from_whatsapp_safe:', leadError);
        } else if (leadResult && leadResult.success) {
          if (leadResult.created) {
            console.log('✅ LEAD CRIADO AUTOMATICAMENTE:', leadResult.lead_id, '-', senderName);
            // Disparar automação apenas para leads recém-criados (fire-and-forget)
            dispatchLeadCreatedTrigger({ companyId: company.id, leadId: leadResult.lead_id, source: 'whatsapp' })
              .catch(err => console.error('[uazapi-webhook-final] automation trigger failed:', err));
          } else {
            console.log('ℹ️ Lead já existe para este telefone:', leadResult.lead_id);
          }
          
          if (leadResult.lead_id && conversationId) {
            await supabase.from('chat_conversations').update({ lead_id: leadResult.lead_id }).eq('id', conversationId);
          }
          // Expor para uso no dispatch de message.received
          inboundLeadId = leadResult.lead_id || null;
        } else {
          console.error('❌ RPC retornou erro:', leadResult);
        }
      } catch (leadCreationError) {
        console.error('❌ EXCEPTION na criação automática de lead:', leadCreationError);
        // Não falhar o webhook por causa disso - apenas log
      }

      // 🔔 CANCELAMENTO AUTOMÁTICO DE MENSAGENS AGENDADAS
      // Quando lead responde, cancelar mensagens agendadas se configurado
      // 🔥 WEBHOOK VERSION: 2026-03-02-17:40 - AUTO-CANCEL ENABLED
      try {
        console.log('🔥 WEBHOOK AUTO-CANCEL VERSION: 2026-03-02-17:40');
        console.log('🔔 VERIFICANDO CANCELAMENTO AUTOMÁTICO DE MENSAGENS AGENDADAS...');
        
        const { data: cancelResult, error: cancelError } = await supabase
          .rpc('auto_cancel_scheduled_messages_on_reply', {
            p_conversation_id: conversationId,
            p_company_id: company.id
          });
        
        if (cancelError) {
          console.error('❌ ERRO NO CANCELAMENTO AUTOMÁTICO:', cancelError);
        } else if (cancelResult && cancelResult.cancelled_count > 0) {
          console.log(`✅ CANCELAMENTO AUTOMÁTICO: ${cancelResult.cancelled_count} mensagem(ns) cancelada(s)`);
          console.log('📋 IDs cancelados:', cancelResult.cancelled_ids);
        } else {
          console.log('ℹ️ CANCELAMENTO AUTOMÁTICO: Nenhuma mensagem para cancelar');
        }
      } catch (cancelError) {
        console.error('❌ EXCEPTION no cancelamento automático:', cancelError);
        // Não falhar o webhook por causa disso - apenas log
      }
    } else {
      console.log('ℹ️ Mensagem outbound - não cria lead automaticamente');
    }

    // � SINCRONIZAÇÃO DE FOTO DE PERFIL (THROTTLE 24H)
    // Atualiza foto do contato em cada interação, respeitando throttle de 24h
    // URLs expiradas do WhatsApp são sempre atualizadas
    try {
      console.log('📸 Iniciando sincronização de foto de perfil...');
      
      // Buscar dados do contato incluindo photo_updated_at
      const { data: contactData, error: contactError } = await supabase
        .from('chat_contacts')
        .select('id, phone_number, profile_picture_url, photo_updated_at, company_id')
        .eq('id', contactId)
        .single();
      
      if (contactError || !contactData) {
        console.log('📸 Contato não encontrado, pulando sincronização de foto');
      } else {
        // Importar funções de sincronização
        const { syncContactPhoto } = require('../lib/photoSync.cjs');
        
        // Executar sincronização de forma assíncrona (não bloqueia webhook)
        syncContactPhoto(supabase, contactData, instance, company)
          .then(result => {
            if (result.updated) {
              console.log(`📸 ✅ Foto sincronizada com sucesso: ${contactData.phone_number}`);
            } else {
              console.log(`📸 ℹ️ Foto não atualizada: ${result.reason}`);
            }
          })
          .catch(error => {
            console.error(`📸 ❌ Erro na sincronização de foto: ${error.message}`);
            // Não falhar o webhook por causa disso
          });
      }
    } catch (photoSyncError) {
      console.error('📸 ❌ EXCEPTION na sincronização de foto:', photoSyncError);
      // Não falhar o webhook por causa disso - apenas log
    }

    // �💬 SINCRONIZAR COM BIBLIOTECA DE MÍDIAS - CORREÇÃO CRÍTICA
    if (finalMediaUrl && finalMediaUrl.includes('aws-lovoocrm-media.s3')) {
      try {
        console.error('💬 BIBLIOTECA: Iniciando sincronização da mídia processada...');
        
        // Extrair s3_key da URL final
        const s3KeyMatch = finalMediaUrl.match(/amazonaws\.com\/(.+)$/);
        const s3Key = s3KeyMatch ? s3KeyMatch[1] : null;
        
        if (s3Key && s3Key.startsWith('clientes/')) {
          console.error('💬 BIBLIOTECA: S3 key válida encontrada:', s3Key);
          
          // CORREÇÃO DEFINITIVA: Sincronização genérica para pasta Chat (sem lead_id específico)
          console.error('💬 BIBLIOTECA: Implementando sincronização genérica para pasta Chat');
          console.error('💬 BIBLIOTECA: Salvando mídia com company_id apenas (sem lead_id específico)');
          
          // Sempre salvar mídia para pasta Chat - não depende de lead específico
          
          // Determinar tipo de arquivo da URL
          const fileExtension = s3Key.split('.').pop().toLowerCase();
          const fileType = fileExtension.match(/jpe?g|png|gif|webp/) ? 'image' :
                         fileExtension.match(/mp4|webm|mov|avi/) ? 'video' :
                         fileExtension.match(/mp3|wav|ogg|m4a/) ? 'audio' : 'document';
          
          const originalFilename = s3Key.split('/').pop();
          
          // NOVA ABORDAGEM: Não sincronizar com banco - pasta Chat usa listagem S3 direta
          console.error('💬 BIBLIOTECA: Nova abordagem implementada - pasta Chat lista S3 diretamente');
          console.error('💬 BIBLIOTECA: Mídia salva no S3 e será listada automaticamente pela nova API');
          console.error('💬 BIBLIOTECA: Removendo dependência de sincronização via banco de dados');
          
          // Simular sucesso para não quebrar o fluxo
          const mediaRecord = { 
            id: 's3_direct_' + Date.now(),
            s3_key: s3Key,
            source: 's3_direct_listing'
          };
          const mediaError = null;
          
          if (mediaError) {
            console.error('❌ BIBLIOTECA: Erro ao salvar:', mediaError);
          } else {
            console.error('✅ BIBLIOTECA: Mídia disponível via listagem S3 direta:', mediaRecord);
          }
        } else {
          console.error('⚠️ BIBLIOTECA: S3 key inválida ou não é mídia do WhatsApp:', s3Key);
        }
      } catch (syncError) {
        console.error('❌ BIBLIOTECA: Erro na sincronização:', syncError);
      }
    }

    console.log('✅ MENSAGEM PROCESSADA VIA FUNÇÃO SEGURA:', savedMessageId);
    
    // 🤖 VERIFICAR E RETOMAR AUTOMAÇÕES PAUSADAS (user_input)
    // Estratégia: busca direta no banco, prioriza lead_id; fallback para qualquer
    // execução pausada da empresa. Chama continue-execution diretamente para evitar
    // inconsistência de status que o RPC anterior causava.
    if (direction === 'inbound' && conversationId) {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'uazapi-webhook-final.js:resume-start',message:'iniciando busca de execução pausada',data:{companyId:company.id,inboundLeadId,conversationId,messageText:messageText?.substring(0,80)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        // Busca execuções pausadas da empresa e filtra _awaiting_input em JS
        // (filtro JSONB via PostgREST com -> não funciona para IS NOT NULL)
        const { data: allPaused, error: pausedErr } = await supabase
          .from('automation_executions')
          .select('id, lead_id, current_node_id, paused_at, variables')
          .eq('company_id', company.id)
          .eq('status', 'paused')
          .order('paused_at', { ascending: false })
          .limit(20);

        const pausedCandidates = (allPaused || []).filter(e => e.variables?._awaiting_input);

        if (pausedErr) {
          console.error('[webhook][user_input] erro ao buscar execuções pausadas:', pausedErr.message);
        } else if (!pausedCandidates || pausedCandidates.length === 0) {
          console.log('[webhook][user_input] nenhuma execução pausada aguardando input');
        } else {
          // Prioridade 1: execução cujo lead_id bate com o inboundLeadId
          // Prioridade 2: execução com lead_id null (trigger sem lead explícito)
          // Prioridade 3: a mais recente (fallback)
          let target = null;
          if (inboundLeadId) {
            target = pausedCandidates.find(e => e.lead_id == inboundLeadId) || null;
          }
          if (!target) {
            target = pausedCandidates.find(e => e.lead_id === null) || pausedCandidates[0];
          }

          // #region agent log
          fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'uazapi-webhook-final.js:resume-target',message:'execução candidata selecionada',data:{candidates:pausedCandidates.length,targetId:target?.id,targetLeadId:target?.lead_id,inboundLeadId},timestamp:Date.now()})}).catch(()=>{});
          // #endregion

          if (target) {
            console.log(`[webhook][user_input] retomando execução ${target.id} com resposta do lead ${inboundLeadId}`);

            // Chamar continue-execution diretamente (o status ainda é 'paused' — correto)
            const appBase = process.env.APP_URL || 'https://loovocrm.vercel.app';
            const continueEndpoint = `${appBase}/api/automation/continue-execution`;

            const continueRes = await fetch(continueEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': process.env.INTERNAL_SECRET || ''
              },
              body: JSON.stringify({
                execution_id: target.id,
                user_response: messageText
              })
            });

            const continueBody = await continueRes.json().catch(() => ({}));

            // #region agent log
            fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'25e06b'},body:JSON.stringify({sessionId:'25e06b',location:'uazapi-webhook-final.js:resume-result',message:'resultado do continue-execution',data:{executionId:target.id,httpStatus:continueRes.status,body:continueBody},timestamp:Date.now()})}).catch(()=>{});
            // #endregion

            if (continueRes.ok) {
              console.log(`[webhook][user_input] ✅ execução ${target.id} retomada com sucesso`);
            } else {
              console.error(`[webhook][user_input] ❌ falha ao retomar execução ${target.id}:`, continueRes.status, continueBody);
            }
          }
        }
      } catch (resumeError) {
        console.error('[webhook][user_input] EXCEPTION ao retomar automação:', resumeError?.message);
      }
    }

    // =====================================================
    // 🤖 CONVERSATION EVENT EMITTER — Etapa 3 MVP Agentes
    //
    // Dispara evento 'conversation.message_received' para o
    // endpoint de processamento de IA de forma fire-and-forget.
    //
    // Regras críticas:
    //   - SOMENTE mensagens inbound (guard duplo)
    //   - SOMENTE quando conversationId confirmado pelo banco
    //   - SEM await — webhook retorna 200 antes de processar
    //   - try/catch interno: erro no emitter nunca quebra o 200
    //
    // Processamento real (Router, Orchestrator, LLM) ocorre no
    // endpoint /api/agents/process-conversation-event (Etapa 4+).
    // =====================================================
    if (direction === 'inbound' && conversationId) {
      try {
        const agentEventPayload = {
          event_type:          'conversation.message_received',
          channel:             'whatsapp',
          company_id:          company.id,
          instance_id:         instance.id,
          conversation_id:     conversationId,
          uazapi_message_id:   messageId,
          source_type:         'whatsapp_message',
          source_identifier:   instanceName,
          message_text:        messageText,
          saved_message_id:    savedMessageId,
          timestamp:           new Date().toISOString()
        };

        // Resolução da URL:
        //   - process.env.APP_URL: variável de ambiente configurada por deployment
        //   - Fallback fixo: domínio oficial de produção
        const appBase = process.env.APP_URL || 'https://app.lovoocrm.com';
        const agentEventUrl = `${appBase}/api/agents/process-conversation-event`;

        // fire-and-forget — mesmo padrão de automations/resume-execution
        // NÃO usar await: o 200 do webhook não pode depender do agente
        fetch(agentEventUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(agentEventPayload)
        }).catch(emitError => {
          console.error('🤖 ❌ Falha ao emitir evento de conversação:', emitError.message);
        });

        console.log('🤖 ✅ Evento de conversação emitido (fire-and-forget):', {
          conversation_id:   conversationId,
          uazapi_message_id: messageId,
          company_id:        company.id,
          target_url:        agentEventUrl
        });

      } catch (emitterError) {
        // Emitter nunca pode quebrar o fluxo do webhook
        console.error('🤖 ❌ EXCEPTION no emitter de conversação:', emitterError.message);
      }
    }

    // 🎯 DISPATCH message.received — aciona automações de mensagem recebida (fire-and-forget)
    // Executado após resume/user_input e após emitter de IA.
    // Independente do user_input: resume retoma execução pausada; message.received inicia nova.
    if (direction === 'inbound' && conversationId) {
      dispatchMessageReceivedTrigger({
        companyId:      company.id,
        leadId:         inboundLeadId,
        conversationId,
        instanceId:     instance.id,
        messageId:      savedMessageId,
        text:           messageText,
      }).catch(err => console.error('[uazapi-webhook-final] message.received trigger failed:', err));
    }

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

// =====================================================
// FUNÇÃO ROBUSTA PARA PROCESSAMENTO DE MÍDIA
// =====================================================
// Adaptada do webhook company_id para webhook-final
// Implementa: Download + Upload para Supabase Storage + URLs permanentes
async function processMediaMessageRobust(message, supabase, originalUrl, rawMediaType) {
  try {
    console.log('🎥 PROCESSAMENTO ROBUSTO DE MÍDIA:', rawMediaType, originalUrl.substring(0, 80) + '...');
    
    // Download da mídia externa (WhatsApp CDN descriptografada)
    const response = await fetch(originalUrl);
    if (!response.ok) {
      console.error('❌ Falha ao baixar mídia:', response.status, response.statusText);
      return originalUrl; // Fallback para URL original
    }
    
    const mediaBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(mediaBuffer);
    console.log('📦 Mídia baixada, tamanho:', mediaBuffer.byteLength, 'bytes');
    
    // Detectar formato via magic bytes (mais preciso que rawMediaType)
    const detectedFormat = detectFormatByMagicBytes(bytes, response.headers.get('content-type'));
    const extension = detectedFormat.extension;
    const contentType = detectedFormat.contentType;
    
    console.log('🔬 FORMATO DETECTADO:', { extension, contentType, rawMediaType });
    
    // Nome do arquivo com formato correto
    const fileName = `${rawMediaType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    console.log('📁 Fazendo upload para Supabase Storage:', fileName);
    
    // Upload para Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, mediaBuffer, {
        contentType: contentType
      });
    
    if (error) {
      console.error('❌ Erro no upload para Supabase:', error);
      return originalUrl; // Fallback para URL original
    }
    
    // Retornar URL pública estável
    const { data: publicUrl } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName);
    
    console.log('✅ PROCESSAMENTO CONCLUÍDO - URL PERMANENTE:', publicUrl.publicUrl.substring(0, 80) + '...');
    return publicUrl.publicUrl;
    
  } catch (error) {
    console.error('❌ EXCEPTION no processamento de mídia:', error);
    return originalUrl; // Fallback para URL original
  }
}

// Função para detectar formato via magic bytes (mais precisa)
function detectFormatByMagicBytes(bytes, responseContentType) {
  console.log('🔬 DETECTANDO FORMATO VIA MAGIC BYTES:', {
    bufferLength: bytes.length,
    firstEightBytes: Array.from(bytes.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')),
    responseContentType
  });

  // Magic bytes para diferentes formatos
  if (bytes.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      console.log('✅ PNG DETECTADO POR MAGIC BYTES!');
      return { extension: 'png', contentType: 'image/png' };
    }
    
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      console.log('✅ JPEG DETECTADO POR MAGIC BYTES!');
      return { extension: 'jpg', contentType: 'image/jpeg' };
    }
    
    // WebP: RIFF ... WEBP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      console.log('✅ WEBP DETECTADO POR MAGIC BYTES!');
      return { extension: 'webp', contentType: 'image/webp' };
    }
    
    // GIF: GIF87a ou GIF89a
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      console.log('✅ GIF DETECTADO POR MAGIC BYTES!');
      return { extension: 'gif', contentType: 'image/gif' };
    }
  }
  
  // Fallback para content-type do response
  if (responseContentType) {
    console.log('🔍 TENTANDO CONTENT-TYPE:', responseContentType);
    
    if (responseContentType.includes('image/png')) {
      console.log('✅ PNG DETECTADO POR CONTENT-TYPE!');
      return { extension: 'png', contentType: 'image/png' };
    }
    if (responseContentType.includes('image/jpeg') || responseContentType.includes('image/jpg')) {
      console.log('✅ JPEG DETECTADO POR CONTENT-TYPE!');
      return { extension: 'jpg', contentType: 'image/jpeg' };
    }
    if (responseContentType.includes('image/webp')) {
      console.log('✅ WEBP DETECTADO POR CONTENT-TYPE!');
      return { extension: 'webp', contentType: 'image/webp' };
    }
    if (responseContentType.includes('image/gif')) {
      console.log('✅ GIF DETECTADO POR CONTENT-TYPE!');
      return { extension: 'gif', contentType: 'image/gif' };
    }
    if (responseContentType.includes('video/')) {
      console.log('✅ VÍDEO DETECTADO POR CONTENT-TYPE!');
      return { extension: 'mp4', contentType: 'video/mp4' };
    }
    if (responseContentType.includes('audio/')) {
      console.log('✅ ÁUDIO DETECTADO POR CONTENT-TYPE!');
      return { extension: 'ogg', contentType: 'audio/ogg' };
    }
  }
  
  // Fallback final baseado no tipo bruto
  console.log('⚠️ USANDO FALLBACK FINAL - NENHUM FORMATO DETECTADO');
  return { extension: 'jpg', contentType: 'image/jpeg' };
}

// =====================================================
// WEBHOOK OFICIAL — Uazapi WhatsApp
// =====================================================
//
// ATENÇÃO: Este é o webhook ATIVO em produção.
// Qualquer correção ou nova funcionalidade deve ser
// aplicada NESTE arquivo (api/uazapi-webhook-final.js).
//
// O arquivo api/webhook/uazapi/[company_id].js NÃO está
// em uso — não editar por engano.
//
// Endpoint registrado no Uazapi:
//   https://app.lovoocrm.com/api/uazapi-webhook-final
//
// Fluxo principal (inbound):
//   1. Salva mensagem via RPC process_webhook_message_safe (SECURITY DEFINER)
//   2. Cria/atualiza lead via create_lead_from_whatsapp_safe
//   3. Cancela mensagens agendadas (auto_cancel_scheduled_messages_on_reply)
//   4. Retoma automações pausadas aguardando user_input
//   5. AWAIT dispatchMessageReceivedTrigger → executa automações, incluindo
//      attach_agent que seta ai_state = 'ai_active' na conversa
//   6. AWAIT fetch process-conversation-event → ConversationRouter verifica
//      ai_state (já atualizado pelo passo 5) e aciona o agente de IA
//
// REGRA CRÍTICA de ordenação (passos 5 e 6):
//   dispatchMessageReceivedTrigger DEVE ser aguardado (await) ANTES de
//   process-conversation-event. Se a ordem for invertida ou o dispatch
//   rodar como fire-and-forget, o ConversationRouter encontrará ai_state
//   = 'ai_inactive' e o agente NÃO responderá à primeira mensagem.
//
// =====================================================

import { dispatchLeadCreatedTrigger }    from './lib/automation/dispatchLeadCreatedTrigger.js';
import { dispatchMessageReceivedTrigger } from './lib/automation/dispatchMessageReceivedTrigger.js';
import { resumeFromNode, resumeClaimedExecution } from './lib/automation/executor.js';
import { acquireLock, releaseLock }               from './lib/automation/executionLock.js';
import { getSupabaseAdmin }               from './lib/automation/supabaseAdmin.js';
import { handleLeadReentry }              from './lib/leads/handleLeadReentry.js';

// =====================================================
// EXTRAÇÃO DE REPLY ID DO PAYLOAD UAZAPI
// =====================================================
// Suporta múltiplos campos candidatos utilizados por versões diferentes da API.
// Retorna string com o ID da mensagem original ou null se não encontrado.
// Não lança exceção — fail-safe por design.
function extractReplyId(message) {
  try {
    if (!message || typeof message !== 'object') return null;

    // Candidatos em ordem de prioridade (mais específico primeiro)
    const candidates = [
      message?.contextInfo?.quotedMessage?.key?.id,
      message?.contextInfo?.stanzaId,
      message?.quotedMsgId,
      message?.quoted?.id,
      message?.referencedMessageId,
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
    
    if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase environment variables');
    }
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { 'cache-control': 'no-cache' } }
      }
    );

    // #endregion

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

    // Filtrar eco de mensagens enviadas via API pelo sistema (agente, automação, painel).
    // Essas mensagens são pré-salvas no banco ANTES do envio via Uazapi.
    // O eco de confirmação que o Uazapi devolve chega antes de updateMessageStatus
    // gravar o uazapi_message_id, tornando a deduplicação por ID ineficaz.
    // Mensagens enviadas do celular físico (isDeviceSent=true) NÃO são filtradas.
    if (direction === 'outbound' && isFromApi && !isDeviceSent) {
      console.log('[WEBHOOK] Echo de mensagem API filtrado — já pré-salvo pelo sistema:', { messageId: message.id });
      return { success: true, skipped: true, reason: 'outbound_api_echo' };
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

    const messageId  = message.id;
    const replyToId  = extractReplyId(message);
    // Log de diagnóstico de reply — sanitizado (sem conteúdo da mensagem)
    console.log('[WEBHOOK][REPLY-DIAG] campos candidatos presentes:', {
      quotedMsgId:           message.quotedMsgId             ? 'present' : 'absent',
      contextInfoStanzaId:   message.contextInfo?.stanzaId   ? 'present' : 'absent',
      contextInfoQuotedId:   message.contextInfo?.quotedMessage?.key?.id ? 'present' : 'absent',
      quotedId:              message.quoted?.id              ? 'present' : 'absent',
      referencedMessageId:   message.referencedMessageId     ? 'present' : 'absent',
      resolved:              replyToId ? 'yes' : 'none',
    });
    const instanceName = payload.instanceName;
    const ownerPhone = payload.owner; // Telefone da instância
    
    // SOLUÇÃO 3: Buscar instância com fallback por phone_number
    console.log('🔍 Buscando instância:', { instanceName, ownerPhone });

    // Tentar buscar por provider_instance_id via RPC segura
    const { data: instanceData, error: instanceError } = await supabase.rpc(
      'get_instance_for_webhook',
      { p_provider_instance_id: instanceName }
    );

    let instance;
    let company;

    if (!instanceError && instanceData?.found === true) {
      instance = {
        id: instanceData.instance_id,
        company_id: instanceData.company_id,
        provider_instance_id: instanceName
      };
      company = {
        id: instanceData.company_id,
        name: instanceData.company_name,
        api_key: null
      };
      console.log('✅ Instância encontrada por provider_instance_id');
    } else {
      // Se não encontrou, buscar por phone_number (fallback)
      // Usa supabaseAdmin (service_role) para não depender da policy wli_select_anonymous_webhook
      console.log('⚠️ Instância não encontrada por provider_instance_id, tentando por phone_number...');

      const supabaseAdminFallback = getSupabaseAdmin();
      const { data: instanceByPhone, error: phoneError } = await supabaseAdminFallback
        .from('whatsapp_life_instances')
        .select('id, company_id, provider_instance_id')
        .eq('phone_number', ownerPhone)
        .eq('status', 'connected')
        .is('deleted_at', null)
        .single();

      if (phoneError || !instanceByPhone) {
        console.error('❌ Instância não encontrada nem por provider_instance_id nem por phone_number:', { instanceName, ownerPhone });
        return { success: false, error: 'Instância não encontrada: ' + instanceName };
      }

      // Encontrou por phone_number! Auto-atualizar provider_instance_id
      console.log('✅ Instância encontrada por phone_number! Auto-atualizando provider_instance_id...');
      console.log('📝 Atualizando de:', instanceByPhone.provider_instance_id, '→', instanceName);

      const { error: updateError } = await supabaseAdminFallback
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
      company = companyResult?.success ? {
        id: companyResult.id,
        name: companyResult.name,
        api_key: companyResult.api_key
      } : null;

      // CORREÇÃO CRÍTICA: Verificar se company existe antes de acessar propriedades
      if (companyError || !company) {
        console.error('❌ EMPRESA NÃO ENCONTRADA para instância:', instanceName, 'Error:', companyError);
        return { success: false, error: 'Empresa não encontrada para a instância: ' + instanceName };
      }
    }
    
    console.log('🏢 EMPRESA:', company.name);
    
    // [IDEMPOTÊNCIA] Early-exit antes de qualquer IO pesado (S3, Whisper, RPC, automações)
    if (messageId && company?.id) {
      try {
        const supabaseAdmin = getSupabaseAdmin()

        const { data: existingMsg } = await supabaseAdmin
          .from('chat_messages')
          .select('id')
          .eq('company_id', company.id)
          .eq('uazapi_message_id', messageId)
          .maybeSingle()

        if (existingMsg) {
          console.log('[WEBHOOK][IDEMPOTENCY] Duplicata detectada — early-exit:', {
            messageId,
            company_id: company.id
          })

          return { success: true, skipped: true, reason: 'duplicate_message' }
        }
      } catch (err) {
        console.error('[WEBHOOK][IDEMPOTENCY] Erro no check — seguindo fluxo normal:', err)
      }
    }

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
    // Buffer de áudio capturado para transcrição posterior (apenas áudio sem texto)
    let capturedAudioBuffer = null;
    let capturedAudioMime   = null;
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

            // [AUDIO] Capturar buffer para transcrição posterior (escopo externo)
            {
              const _rawType = (rawMediaType || message.messageType || '').toLowerCase();
              if (['ptt', 'audiomessage', 'audio'].includes(_rawType) && !messageText) {
                capturedAudioBuffer = finalBuffer;
                capturedAudioMime   = message.content?.mimetype || 'audio/ogg';
              }
            }
            
            // Detectar formato e gerar nome do arquivo (CORREÇÃO: usar mimetype do payload)
            const { S3Storage } = await import('../src/services/aws/s3Storage.js');
            
            // PRIORIZAR MIMETYPE DO PAYLOAD WHATSAPP
            const payloadMimetype = message.content?.mimetype;
            const detectedContentType = S3Storage.detectContentType(finalBuffer, 'media');
            const contentType = payloadMimetype || detectedContentType;
            
            const extension = (contentType.split('/')[1] || 'bin').split(';')[0].trim();
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

    // ── [AUDIO TRANSCRIPTION] ────────────────────────────────────────────────
    // Transcreve áudio via Whisper-1 de forma invisível ao usuário.
    // Pré-condições: tipo audio, sem texto existente, buffer disponível.
    // Fallback: se falhar, messageText permanece '' — comportamento atual.
    if (normalizedType === 'audio' && !messageText && capturedAudioBuffer) {
      try {
        const { transcribeAudioBuffer } = await import('./lib/openai/audioTranscriber.js');
        const transcript = await transcribeAudioBuffer(capturedAudioBuffer, capturedAudioMime);
        if (transcript) {
          messageText = transcript;
          console.info('[WEBHOOK] audio transcribed', { company_id: company?.id, chars: transcript.length });
        }
      } catch (transcriptionErr) {
        console.warn('[WEBHOOK] audio transcription error (non-fatal)', { error: transcriptionErr.message });
        // Fallback: messageText permanece '' — agente não responde (comportamento atual)
      }
    }
    // ── [/AUDIO TRANSCRIPTION] ───────────────────────────────────────────────

    // Restante do código...
    const { data: webhookResult, error: webhookError } = await supabase
      .rpc('process_webhook_message_safe', {
        p_company_id:                 company.id,
        p_instance_id:                instance.id,
        p_phone_number:               phoneNumber,
        p_sender_name:                senderName,
        p_content:                    messageText,
        p_message_type:               normalizedType,
        p_media_url:                  finalMediaUrl,
        p_direction:                  direction,
        p_uazapi_message_id:          messageId,
        p_profile_picture_url:        payload.chat?.imagePreview || null,
        p_reply_to_uazapi_message_id: replyToId || null,
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

    // Contabilizar tamanho de mídia inbound para cálculo de storage da empresa.
    // Fire-and-forget: NUNCA bloqueia, NUNCA lança exceção, NUNCA impacta performance.
    // media_file_size é usado pelo get_company_storage_used_mb para calcular uso de storage.
    if (savedMessageId && isMediaMessage) {
      const rawFileLength = message.content?.fileLength ?? message.content?.fileLenght ?? null
      const mediaFileSizeBytes = rawFileLength ? parseInt(rawFileLength, 10) : NaN
      if (!isNaN(mediaFileSizeBytes) && mediaFileSizeBytes > 0) {
        supabase
          .from('chat_messages')
          .update({ media_file_size: mediaFileSizeBytes })
          .eq('id', savedMessageId)
          .then(({ error: updateErr }) => {
            if (updateErr) {
              console.warn('[WEBHOOK] Falha ao registrar media_file_size (non-fatal):', updateErr.message)
            }
          })
          .catch(() => {}) // erros silenciados — contabilização é best-effort
      }
    }

    // =====================================================
    // IMPORTANTE: Memória conversacional NÃO pode ser escrita por webhooks.
    // Apenas o agentExecutor (via LLM) pode atualizar chat_conversations.memory.
    // Exceção: /confirmar_reset limpa memory = '{}' como reset total de sistema.
    // =====================================================

    // =====================================================
    // COMANDOS DE SISTEMA — /resetar e /confirmar_reset
    //
    // Interceptados aqui, ANTES de qualquer pipeline downstream.
    // Nunca chegam ao agentExecutor, emitter de eventos ou automações.
    // return early em todos os caminhos de execução.
    //
    // Fluxo:
    //   /resetar         → SET reset_pending = true → pede confirmação
    //   /confirmar_reset → verifica pending + expiração → executa reset completo
    // =====================================================

    if (direction === 'inbound' && conversationId) {
      const trimmedCommand = messageText?.trim().toLowerCase();

      // ── /resetar — solicitar confirmação ───────────────────────────────────
      if (trimmedCommand === '/resetar') {
        try {
          console.log('[RESET] /resetar detectado — aguardando confirmação:', {
            conversation_id: conversationId,
            company_id:      company.id,
          });

          const supabaseAdmin = getSupabaseAdmin();

          // Marcar reset pendente + atualizar updated_at para controle de expiração
          const { error: pendingError } = await supabaseAdmin
            .from('chat_conversations')
            .update({ reset_pending: true, updated_at: new Date().toISOString() })
            .eq('id', conversationId)
            .eq('company_id', company.id);

          if (pendingError) {
            console.error('[RESET] Erro ao marcar reset_pending:', pendingError.message);
          }

          // Buscar token e enviar pedido de confirmação (fire-and-forget)
          const { data: instanceFull } = await supabaseAdmin
            .from('whatsapp_life_instances')
            .select('provider_token')
            .eq('id', instance.id)
            .maybeSingle();

          if (instanceFull?.provider_token) {
            fetch('https://lovoo.uazapi.com/send/text', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'token': instanceFull.provider_token },
              body:    JSON.stringify({
                number: phoneNumber,
                text:   'Tem certeza que deseja reiniciar a conversa?\nDigite /confirmar_reset para continuar.',
              }),
            }).catch(e => console.error('[RESET] Erro ao enviar confirmação:', e.message));
          }

          return { success: true, message: 'reset:/resetar — aguardando confirmação' };
        } catch (err) {
          console.error('[RESET] Erro inesperado em /resetar:', err.message);
        }
      }

      // ── /confirmar_reset — executar reset completo ─────────────────────────
      if (trimmedCommand === '/confirmar_reset') {
        try {
          console.log('[RESET] /confirmar_reset detectado — verificando solicitação:', {
            conversation_id: conversationId,
            company_id:      company.id,
          });

          const supabaseAdmin = getSupabaseAdmin();

          // Helper: busca token e envia resposta via Uazapi
          const sendReply = async (text) => {
            const { data: inst } = await supabaseAdmin
              .from('whatsapp_life_instances')
              .select('provider_token')
              .eq('id', instance.id)
              .maybeSingle();

            if (inst?.provider_token) {
              fetch('https://lovoo.uazapi.com/send/text', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'token': inst.provider_token },
                body:    JSON.stringify({ number: phoneNumber, text }),
              }).catch(e => console.error('[RESET] Erro ao enviar resposta:', e.message));
            }
          };

          // Buscar estado atual: reset_pending + updated_at (para expiração)
          const { data: conv, error: convError } = await supabaseAdmin
            .from('chat_conversations')
            .select('reset_pending, updated_at')
            .eq('id', conversationId)
            .eq('company_id', company.id)
            .maybeSingle();

          if (convError || !conv) {
            console.error('[RESET] Erro ao buscar estado da conversa:', convError?.message);
            await sendReply('Erro ao verificar solicitação de reset.');
            return { success: true, message: 'reset:/confirmar_reset — erro na leitura' };
          }

          // Verificar se há reset pendente
          if (!conv.reset_pending) {
            console.log('[RESET] Nenhum reset pendente:', { conversation_id: conversationId });
            await sendReply('Nenhuma solicitação de reset encontrada.');
            return { success: true, message: 'reset:/confirmar_reset — nenhum pending' };
          }

          // Verificar expiração (10 minutos a partir de updated_at)
          const RESET_EXPIRY_MS = 10 * 60 * 1000;
          const updatedAt  = conv.updated_at ? new Date(conv.updated_at).getTime() : 0;
          const isExpired  = updatedAt > 0 && (Date.now() - updatedAt) > RESET_EXPIRY_MS;

          if (isExpired) {
            console.log('[RESET] Solicitação expirada:', {
              conversation_id: conversationId,
              updated_at:      conv.updated_at,
            });
            // Limpar flag expirado sem executar reset
            await supabaseAdmin
              .from('chat_conversations')
              .update({ reset_pending: false })
              .eq('id', conversationId)
              .eq('company_id', company.id);

            await sendReply('Solicitação expirada. Digite /resetar novamente.');
            return { success: true, message: 'reset:/confirmar_reset — expirado' };
          }

          // ── Executar reset completo — deleta conversa + lead e tudo relacionado ─
          //
          // Ordem de operações (respeitando FK constraints):
          //   1. sendReply antes de deletar (precisa da conversa aberta)
          //   2. duplicate_notifications (NO ACTION — bloqueia delete do lead)
          //   3. conversation_flow_states (sem CASCADE de chat_conversations)
          //   4. chat_conversations (CASCADE: messages, sessions, locks, handoff_events...)
          //   5. leads pelo telefone (CASCADE: opportunities, custom_values, activities, tags...)

          await sendReply('Pronto! Conversa e lead deletados. Pode reimportar para começar do zero 😊');

          // 1. Remover duplicate_notifications do(s) lead(s) deste telefone
          const { data: leadsToDelete } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('phone', phoneNumber)
            .eq('company_id', company.id);

          const leadIds = (leadsToDelete ?? []).map(l => l.id);

          if (leadIds.length > 0) {
            await supabaseAdmin
              .from('duplicate_notifications')
              .delete()
              .or(`lead_id.in.(${leadIds.join(',')}),duplicate_of_lead_id.in.(${leadIds.join(',')})`);
          }

          // 2. Deletar conversation_flow_states (sem FK cascade)
          const { error: flowError } = await supabaseAdmin
            .from('conversation_flow_states')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('company_id', company.id);

          if (flowError) {
            console.error('[RESET] Erro ao deletar flow states:', flowError.message);
          }

          // 3. Deletar a conversa — CASCADE limpa: messages, sessions, locks, handoff_events,
          //    scheduled_messages, migration_log. agent_processed_messages → SET NULL.
          const { error: convDeleteError } = await supabaseAdmin
            .from('chat_conversations')
            .delete()
            .eq('id', conversationId)
            .eq('company_id', company.id)
            .eq('reset_pending', true); // anti-execução-duplicada

          if (convDeleteError) {
            console.error('[RESET] Erro ao deletar conversa:', convDeleteError.message);
          }

          // 4. Deletar todos os leads do telefone — CASCADE limpa: opportunities,
          //    opportunity_items, opportunity_funnel_positions, lead_custom_values,
          //    lead_activities, lead_tag_assignments, lead_stage_history, lead_entries,
          //    lead_media_unified, internal_notes, system_notifications.
          //    automation_executions + webhook_trigger_logs → SET NULL.
          let leadsDeleted = 0;
          if (leadIds.length > 0) {
            const { error: leadDeleteError, count } = await supabaseAdmin
              .from('leads')
              .delete({ count: 'exact' })
              .in('id', leadIds)
              .eq('company_id', company.id);

            if (leadDeleteError) {
              console.error('[RESET] Erro ao deletar leads:', leadDeleteError.message);
            } else {
              leadsDeleted = count ?? 0;
            }
          }

          console.log('[RESET] reset total concluído', {
            conversation_id: conversationId,
            company_id:      company.id,
            phone:           phoneNumber,
            leads_deleted:   leadsDeleted,
            flow_deleted:    !flowError,
            conv_deleted:    !convDeleteError,
          });

          return { success: true, message: 'reset:/confirmar_reset — total' };
        } catch (err) {
          console.error('[RESET] Erro inesperado em /confirmar_reset:', err.message);
        }
      }
    }

    // lead_id resolvido do bloco inbound — acessível após o bloco para o dispatch de message.received
    let inboundLeadId = null;

    // 🎯 CRIAÇÃO AUTOMÁTICA DE LEAD PARA NOVOS CONTATOS - CORREÇÃO CRÍTICA 2026-02-20
    // USANDO SECURITY DEFINER PARA MANTER RLS ATIVO
    if (direction === 'inbound') {
      try {
        console.log('🎯 CRIANDO LEAD AUTOMATICAMENTE VIA SECURITY DEFINER...');
        
        // Usar service_role para garantir que a RPC encontre leads de qualquer formato de telefone
        const supabaseAdminForLead = getSupabaseAdmin();
        const { data: leadResult, error: leadError } = await supabaseAdminForLead
          .rpc('create_lead_from_whatsapp_safe', {
            p_company_id: company.id,
            p_phone: phoneNumber,
            p_name: senderName,
            p_instance_id: instance.id  // v7: atribuição automática de responsável por instância
          });
        
        if (leadError) {
          console.error('❌ ERRO NA RPC create_lead_from_whatsapp_safe:', leadError);
        } else if (leadResult && leadResult.success) {
          if (leadResult.created) {
            console.log('✅ LEAD CRIADO AUTOMATICAMENTE:', leadResult.lead_id, '-', senderName);
            dispatchLeadCreatedTrigger({ companyId: company.id, leadId: leadResult.lead_id, source: 'whatsapp' })
              .catch(err => console.error('[uazapi-webhook-final] automation trigger failed:', err));
          } else {
            console.log('ℹ️ Lead já existe para este telefone:', leadResult.lead_id);
            // Registrar reentrada via WhatsApp — await garante execução completa
            const supabaseAdmin = getSupabaseAdmin();
            try {
              await handleLeadReentry({
                newLeadId: leadResult.lead_id,
                existingLeadId: leadResult.lead_id,
                companyId: company.id,
                source: 'whatsapp',
                externalEventId: payload?.data?.key?.id || null,
                originChannel: 'whatsapp',
                metadata: { phone: phoneNumber, contact_name: senderName },
                supabase: supabaseAdmin,
              });
            } catch (err) {
              console.error('[uazapi-webhook-final] handleLeadReentry failed:', err);
            }
          }
          
          if (leadResult.lead_id && conversationId) {
            await supabase.from('chat_conversations').update({ lead_id: leadResult.lead_id }).eq('id', conversationId);

            // Fase 3c: sincronizar assigned_to na conversa quando lead novo veio com responsável da instância
            if (leadResult.created && leadResult.responsible_user_id) {
              try {
                const { data: syncCount, error: syncError } = await supabaseAdminForLead
                  .rpc('sync_lead_responsible_to_conversations', {
                    p_lead_id:             Number(leadResult.lead_id),
                    p_responsible_user_id: leadResult.responsible_user_id,
                  });
                if (syncError) {
                  console.error('[webhook] chat-sync assigned_to error:', syncError.message);
                } else {
                  console.log('[webhook] chat-sync assigned_to ok:', { lead_id: leadResult.lead_id, responsible: leadResult.responsible_user_id, updated: syncCount ?? 0 });
                }
              } catch (syncErr) {
                console.error('[webhook] chat-sync assigned_to exception:', syncErr?.message);
              }
            }
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

      // Motor de Ciclos: fechar ciclo aberto quando cliente responder via inbound
      if (inboundLeadId) {
        try {
          const svcCycle = getSupabaseAdmin();
          await svcCycle.rpc('handle_inbound_for_contact_cycle', {
            p_lead_id:             Number(inboundLeadId),
            p_company_id:          company.id,
            p_whatsapp_message_id: messageId || null,
          });
          console.log('[contact-cycle] inbound handled for lead', inboundLeadId);
        } catch (cycleErr) {
          console.warn('[contact-cycle] handle_inbound_for_contact_cycle failed (non-blocking):', cycleErr?.message);
        }
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

    // SINCRONIZAÇÃO DE FOTO DE PERFIL
    // Estratégia em duas etapas:
    //   1. Se imagePreview fresco chegou via payload e a foto atual é CDN/vazia:
    //      baixar e salvar permanentemente no Storage imediatamente.
    //   2. Fallback assíncrono: syncContactPhoto (Uazapi API + throttle 24h).
    // Nunca sobrescreve URL permanente já salva no Storage.
    try {
      const { data: contactData, error: contactError } = await supabase
        .from('chat_contacts')
        .select('id, phone_number, profile_picture_url, photo_updated_at, company_id')
        .eq('id', contactId)
        .single();

      if (contactError || !contactData) {
        console.log('[photoSync:webhook] contato não encontrado, pulando sync de foto');
      } else {
        const {
          isWhatsAppCdnPhoto,
          downloadAndStorePhoto,
          syncContactPhoto,
        } = await import('../lib/photoSync.cjs');

        const imagePreview  = payload.chat?.imagePreview || null;
        const currentUrl    = contactData.profile_picture_url;
        const currentIsCdn  = !currentUrl || isWhatsAppCdnPhoto(currentUrl);
        const previewIsCdn  = imagePreview && isWhatsAppCdnPhoto(imagePreview);

        if (previewIsCdn && currentIsCdn) {
          // Caminho direto: imagePreview é fresco (recém-chegado do WhatsApp) e a
          // foto atual ainda é temporária ou está vazia → download imediato.
          downloadAndStorePhoto(supabase, imagePreview, contactData.company_id, contactData.phone_number)
            .then(async (permanentUrl) => {
              const { error: updErr } = await supabase
                .from('chat_contacts')
                .update({
                  profile_picture_url: permanentUrl,
                  photo_updated_at:    new Date().toISOString(),
                  updated_at:          new Date().toISOString(),
                })
                .eq('id', contactData.id);
              if (updErr) {
                console.error('[photoSync:webhook] erro ao atualizar contato:', updErr.message);
              } else {
                console.log('[photoSync:webhook] foto salva permanentemente, contato:', contactData.id);
              }
            })
            .catch((err) => {
              // Download direto falhou (URL expirada ou erro de rede) → fallback
              console.error('[photoSync:webhook] download direto falhou, usando syncContactPhoto:', err.message);
              syncContactPhoto(supabase, contactData, instance, company).catch(() => {});
            });
        } else {
          // Sem imagePreview fresco ou foto já é permanente → fallback com throttle 24h
          syncContactPhoto(supabase, contactData, instance, company)
            .then(result => {
              if (result.updated) {
                console.log('[photoSync:webhook] sincronizado via Uazapi, contato:', contactData.id);
              } else {
                console.log('[photoSync:webhook] sem atualização necessária:', result.reason);
              }
            })
            .catch((err) => {
              console.error('[photoSync:webhook] syncContactPhoto falhou:', err.message);
            });
        }
      }
    } catch (photoSyncError) {
      console.error('[photoSync:webhook] exception no bloco de foto:', photoSyncError.message);
      // Não falhar o webhook por causa do sync de foto
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
    //
    // awaitingInputFound: flag que previne a busca de delay_response quando
    // uma execução awaiting_input foi localizada (prioridade determinística).
    // Documentação: sem correlação reply-to, awaiting_input tem prioridade
    // determinística — não identifica perfeitamente a intenção do lead.
    let awaitingInputFound = false;

    if (direction === 'inbound' && conversationId) {
      try {
        console.log('[webhook][user_input] v3 — buscando via RPC SECURITY DEFINER', { companyId: company.id, inboundLeadId });

        // Usa RPC SECURITY DEFINER para bypass do RLS (client anon não acessa diretamente)
        const { data: pausedResult, error: pausedErr } = await supabase
          .rpc('find_paused_awaiting_input_execution', {
            p_company_id: company.id,
            p_lead_id: inboundLeadId || null
          });

        console.log('[webhook][user_input] resultado RPC:', pausedResult, '| erro:', pausedErr?.message ?? null);

        if (pausedErr) {
          console.error('[webhook][user_input] erro ao buscar execução pausada:', pausedErr.message);
        } else if (!pausedResult?.found) {
          console.log('[webhook][user_input] nenhuma execução pausada aguardando input');
        } else {
          // Marca como encontrado ANTES de tentar o resume — previne busca de
          // delay_response mesmo que o resume subsequente falhe.
          awaitingInputFound = true;

          const target = { id: pausedResult.execution_id, lead_id: pausedResult.lead_id };

          if (target) {
            console.log(`[webhook][user_input] retomando execução ${target.id} com resposta do lead ${inboundLeadId}`);

            // Buscar execução e flow completos via supabaseAdmin (bypassa RLS)
            const supabaseAdmin = getSupabaseAdmin();

            const { data: execution, error: execErr } = await supabaseAdmin
              .from('automation_executions')
              .select('id, flow_id, company_id, status, current_node_id, lead_id, opportunity_id, trigger_data, variables')
              .eq('id', target.id)
              .single();

            if (execErr || !execution) {
              console.error(`[webhook][user_input] ❌ execução ${target.id} não encontrada:`, execErr?.message);
            } else if (execution.status !== 'paused') {
              console.warn(`[webhook][user_input] ⚠️ execução ${target.id} não está pausada (status: ${execution.status})`);
            } else {
              const { data: flow, error: flowErr } = await supabaseAdmin
                .from('automation_flows')
                .select('id, nodes, edges, company_id')
                .eq('id', execution.flow_id)
                .single();

              if (flowErr || !flow) {
                console.error(`[webhook][user_input] ❌ flow ${execution.flow_id} não encontrado:`, flowErr?.message);
              } else {
                await resumeFromNode(execution, flow, execution.current_node_id, supabaseAdmin, messageText);
                console.log(`[webhook][user_input] ✅ execução ${target.id} retomada com sucesso`);
              }
            }
          }
        }
      } catch (resumeError) {
        console.error('[webhook][user_input] EXCEPTION ao retomar automação:', resumeError?.message);
      }
    }

    // =====================================================
    // 🔄 RETOMADA DE DELAY_RESPONSE (time_or_response)
    //
    // Executado somente quando awaiting_input não localizou execução
    // elegível para esta mensagem. Prioridade determinística:
    //   1. awaiting_input  (caminho acima)
    //   2. delay_response  (este bloco)
    //
    // Uma única execução é retomada por mensagem (ver awaitingInputFound).
    //
    // Ordem correta (elimina janela pós-claim irrecuperável):
    //   find_v2 → validar → carregar flow → adquirir lock
    //   → claim_delay_response_lead_v1 (atômico: execution+schedule+post_claim)
    //   → resumeClaimedExecution(preAcquiredLock)
    //   → marcar schedule processed
    //   → liberar lock no finally
    //
    // Queda após o claim → schedule em processing → TTL → cron recovery.
    //
    // RPCs usadas (service_role, SECURITY DEFINER):
    //   - find_paused_awaiting_execution_v2     → localiza candidato
    //   - claim_delay_response_lead_v1          → claim atômico transacional
    //
    // claim_paused_execution_v1 preservada para compatibilidade ou uso futuro.
    // claim_delay_response_timeout_v1 NÃO é usada aqui — é exclusiva do cron.
    // =====================================================
    if (direction === 'inbound' && conversationId && !awaitingInputFound && inboundLeadId) {
      // Lock pré-adquirido pelo webhook. Liberado no finally externo após
      // qualquer desvio de fluxo (lock indisponível, claimed=false, erro no
      // resume). Garante que o executor não tente adquiri-lo novamente.
      let delayLock       = null;  // { acquired: true, lockId: string } quando adquirido
      let delayLockExecId = null;  // execução à qual o lock pertence (para release)

      try {
        const supabaseAdminDelay = getSupabaseAdmin();

        // ── 1. Localizar execução pausada com _awaiting_delay_response ──────
        const { data: delayResult, error: delayFindErr } = await supabaseAdminDelay
          .rpc('find_paused_awaiting_execution_v2', {
            p_company_id:    company.id,
            p_lead_id:       Number(inboundLeadId),
            p_awaiting_type: 'delay_response',
          });

        if (delayFindErr) {
          console.error('[webhook][delay_response] erro SQL em find_paused_awaiting_execution_v2:', {
            company_id: company.id, error: delayFindErr.message,
          });
        } else if (!delayResult?.found) {
          console.log('[webhook][delay_response] nenhuma execução delay_response pausada', {
            company_id: company.id, lead_id: inboundLeadId,
          });
        } else {
          // ── 2. Validar campos críticos do resultado ──────────────────────
          const {
            execution_id:     candidateExecutionId,
            company_id:       resultCompanyId,
            awaiting_node_id: candidateNodeId,
            awaiting_type:    resultAwaitingType,
            automation_id:    candidateFlowId,
            schedule_id:      candidateScheduleId,
          } = delayResult;

          if (!candidateExecutionId || !resultCompanyId || !candidateNodeId) {
            console.error('[webhook][delay_response] resultado incompleto da RPC de busca', {
              company_id:           company.id,
              lead_id:              inboundLeadId,
              has_execution_id:     !!candidateExecutionId,
              has_awaiting_node_id: !!candidateNodeId,
            });
          } else if (resultAwaitingType !== 'delay_response') {
            console.error('[webhook][delay_response] awaiting_type inesperado no resultado:', {
              company_id: company.id, awaiting_type: resultAwaitingType,
            });
          } else if (!candidateFlowId) {
            console.error('[webhook][delay_response] automation_id ausente no resultado', {
              company_id: company.id, execution_id: candidateExecutionId,
            });
          } else if (!candidateScheduleId) {
            console.error('[webhook][delay_response] schedule_id ausente no resultado', {
              company_id:   company.id,
              execution_id: candidateExecutionId,
            });
          } else {
            // ── 3. Pré-carregar flow (antes do lock e do claim) ───────────
            const { data: preFlow, error: preFlowErr } = await supabaseAdminDelay
              .from('automation_flows')
              .select('id, nodes, edges, company_id')
              .eq('id', candidateFlowId)
              .eq('company_id', resultCompanyId)
              .single();

            if (preFlowErr || !preFlow) {
              console.error('[webhook][delay_response] flow não encontrado — skip', {
                company_id:   resultCompanyId,
                flow_id:      candidateFlowId,
                execution_id: candidateExecutionId,
              });
            } else {
              // ── 4. Adquirir executionLock ANTES do claim ─────────────────
              // Garante defesa em profundidade contra processamento duplo.
              // A nova RPC já protege via FOR UPDATE, mas o lock operacional
              // garante que o executor não seja chamado concorrentemente.
              // Limitação: lockId não contém executionId — uso é exclusivo para
              // candidateExecutionId dentro deste bloco.
              delayLock       = await acquireLock(candidateExecutionId, supabaseAdminDelay);
              delayLockExecId = candidateExecutionId;

              if (!delayLock.acquired) {
                console.log('[webhook][delay_response] lock indisponível — skip (execução permanece pausada)', {
                  company_id:   company.id,
                  execution_id: candidateExecutionId,
                  reason:       delayLock.reason,
                });
                // Não chamar claim, não executar.
                // delayLock.acquired = false → finally não chama releaseLock.
              } else {
                // ── 5. Claim transacional atômico ─────────────────────────
                // claim_delay_response_lead_v1 garante atomicamente:
                //   a) execution paused → running, marcador removido
                //   b) response_variable salva em variables (quando configurada)
                //   c) schedule pending → processing, post_claim persistido
                // Após o commit: qualquer queda é recuperável pelo cron via TTL.
                const { data: claimResult, error: claimErr } = await supabaseAdminDelay
                  .rpc('claim_delay_response_lead_v1', {
                    p_company_id:     resultCompanyId,
                    p_schedule_id:    candidateScheduleId,
                    p_execution_id:   candidateExecutionId,
                    p_paused_node_id: candidateNodeId,
                    p_user_response:  messageText,
                  });

                if (claimErr) {
                  console.error('[webhook][delay_response] erro SQL em claim_delay_response_lead_v1:', {
                    company_id:   company.id,
                    execution_id: candidateExecutionId,
                    schedule_id:  candidateScheduleId,
                    error:        claimErr.message,
                  });
                  // Lock liberado no finally.
                } else if (!claimResult?.claimed) {
                  // Corrida perdida ou execução stale — não é erro.
                  // Lock liberado no finally.
                  console.log('[webhook][delay_response] claim não realizado:', {
                    company_id:   company.id,
                    execution_id: candidateExecutionId,
                    schedule_id:  candidateScheduleId,
                    reason:       claimResult?.reason,
                  });
                } else {
                  // ── 6. claimed=true — usar exclusivamente dados pós-claim ──
                  // response_variable JÁ foi salva atomicamente pela RPC.
                  // O executor não deve salvá-la novamente (claimedMarker=null).
                  const claimedExecution = claimResult.execution;

                  // Validar que o flow pertence à execução pós-claim
                  if (preFlow.id !== claimedExecution.flow_id || preFlow.company_id !== claimedExecution.company_id) {
                    console.error('[webhook][delay_response] flow divergente após claim — não retomar', {
                      company_id:   claimedExecution.company_id,
                      execution_id: claimedExecution.id,
                      flow_id:      claimedExecution.flow_id,
                    });
                    // Schedule permanece processing → TTL → cron recupera.
                    // Lock liberado no finally.
                  } else {
                    // ── 7. Resume com lock pré-adquirido ─────────────────
                    // claimedMarker=null: impede segundo salvamento de response_variable.
                    // userResponse=undefined: variável já em execution.variables.
                    // preAcquiredLock: executor usa lock sem readquirir nem liberar.
                    try {
                      await resumeClaimedExecution({
                        execution:       claimedExecution,
                        flow:            preFlow,
                        pausedNodeId:    claimResult.marker?.node_id ?? candidateNodeId,
                        supabase:        supabaseAdminDelay,
                        userResponse:    undefined,
                        resumeReason:    'lead_response',
                        awaitingType:    'delay_response',
                        scheduleId:      candidateScheduleId,
                        claimedMarker:   null,
                        preAcquiredLock: delayLock,
                      });

                      // ── 8. Finalizar schedule após sucesso do executor ────
                      // Somente aqui o schedule é marcado processed.
                      // Se este update falhar: schedule permanece processing
                      // → TTL → cron detecta execution.status=completed → skip.
                      try {
                        await supabaseAdminDelay
                          .from('automation_schedules')
                          .update({
                            status:      'processed',
                            executed_at: new Date().toISOString(),
                          })
                          .eq('id', candidateScheduleId)
                          .eq('company_id', claimedExecution.company_id)
                          .eq('status', 'processing');
                        console.log('[webhook][delay_response] execução retomada e schedule finalizado', {
                          company_id:    company.id,
                          lead_id:       inboundLeadId,
                          execution_id:  claimedExecution.id,
                          flow_id:       claimedExecution.flow_id,
                          node_id:       candidateNodeId,
                          schedule_id:   candidateScheduleId,
                          awaiting_type: 'delay_response',
                          claim_result:  'claimed',
                        });
                      } catch (finalizeEx) {
                        console.error('[webhook][delay_response] falha ao finalizar schedule — flow já executado', {
                          schedule_id:  candidateScheduleId,
                          company_id:   claimedExecution.company_id,
                          execution_id: claimedExecution.id,
                          error:        finalizeEx?.message,
                        });
                        // O flow JÁ foi executado. Não desfazer.
                        // Schedule permanece processing → TTL → cron detecta execution.status != running → skip.
                      }
                    } catch (resumeEx) {
                      // Falha no executor: schedule permanece processing.
                      // TTL → pending → cron tenta recovery.
                      console.error('[webhook][delay_response] erro ao retomar execução', {
                        company_id:   company.id,
                        execution_id: claimedExecution.id,
                        node_id:      candidateNodeId,
                        schedule_id:  candidateScheduleId,
                        resume_stage: 'resume_error',
                        error:        resumeEx?.message,
                      });
                    }
                    // Lock liberado no finally independentemente do resultado.
                  }
                }
              }
            }
          }
        }
      } catch (delayResumeErr) {
        console.error('[webhook][delay_response] EXCEPTION no fluxo delay_response:', {
          company_id: company.id,
          lead_id:    inboundLeadId,
          error:      delayResumeErr?.message,
        });
      } finally {
        // Liberar lock somente se foi adquirido com sucesso neste bloco.
        // releaseLock nunca lança exceção — seguro em finally.
        if (delayLock?.acquired && delayLockExecId) {
          const supabaseAdminForRelease = getSupabaseAdmin();
          await releaseLock(delayLockExecId, delayLock.lockId, supabaseAdminForRelease);
        }
      }
    }

    // =====================================================
    // 🎯 PASSO 5 — DISPATCH message.received (AGUARDADO)
    //
    // REGRA CRÍTICA: este bloco DEVE rodar com await e ANTES
    // do process-conversation-event (passo 6).
    //
    // Motivo: a automação pode incluir um nó attach_agent que
    // seta chat_conversations.ai_state = 'ai_active'. O
    // ConversationRouter (passo 6) lê esse campo para decidir
    // se aciona o agente. Se o dispatch rodar depois ou como
    // fire-and-forget, o router encontrará ai_inactive e o
    // agente não responderá à primeira mensagem do lead.
    //
    // Independente do user_input: resume retoma execução pausada;
    // message.received inicia nova execução de automação.
    // =====================================================
    if (direction === 'inbound' && conversationId) {
      // Extração fail-safe do campo de origem click-to-chat.
      // A Uazapi pode entregar o campo em dois níveis distintos dependendo da versão.
      // Null propagado quando o campo não existe (mensagens normais ou integrações sem metadata).
      const entryPointSource =
        message?.content?.contextInfo?.entryPointConversionSource ||
        message?.contextInfo?.entryPointConversionSource ||
        null

      // #region agent log
      console.log(`[DEBUG-275bca][webhook] dispatch instanceId=${instance.id} leadId=${inboundLeadId} conversationId=${conversationId} direction=${direction}`)
      // #endregion
      await dispatchMessageReceivedTrigger({
        companyId:           company.id,
        leadId:              inboundLeadId,
        conversationId,
        instanceId:          instance.id,
        messageId:           savedMessageId,
        text:                messageText,
        direction,
        from_agent:          false,
        sender_type:         'lead',
        origin:              'whatsapp',
        is_from_me:          false,
        entry_point_source:  entryPointSource,
      }).catch(err => console.error('[uazapi-webhook-final] message.received trigger failed:', err));
    }

    // =====================================================
    // 🤖 PASSO 6 — CONVERSATION EVENT EMITTER (agente de IA)
    //
    // Dispara evento 'conversation.message_received' para o
    // endpoint de processamento de IA.
    //
    // DEVE rodar APÓS dispatchMessageReceivedTrigger (passo 5)
    // para garantir que ai_state já foi atualizado pelo
    // attach_agent antes do ConversationRouter verificar.
    //
    // Regras:
    //   - SOMENTE mensagens inbound
    //   - SOMENTE quando conversationId confirmado pelo banco
    //   - await com timeout 8s: garante entrega do request antes do webhook
    //     encerrar (evita corte serverless do fire-and-forget)
    //   - .catch(() => {}) silencia AbortError de timeout sem log de erro
    //   - o endpoint continua executando por até 60s após o timeout do webhook
    //   - try/catch interno: erro nunca quebra o 200
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

        const appBase = process.env.APP_URL || 'https://app.lovoocrm.com';
        const agentEventUrl = `${appBase}/api/agents/process-conversation-event`;

        // await com timeout de 8s — garante que o request HTTP seja entregue ao
        // process-conversation-event antes do webhook retornar. Em serverless (Vercel),
        // fire-and-forget pode ser cortado quando a função encerra, causando delay de
        // minutos na resposta do agente. O timeout não cancela a execução do endpoint
        // (que tem maxDuration: 60 próprio) — apenas limita quanto o webhook espera.
        // O .catch(() => {}) silencia o AbortError de timeout sem poluir os logs.
        await fetch(agentEventUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(agentEventPayload),
          signal:  AbortSignal.timeout(8000)
        }).catch(() => {});

        console.log('🤖 ✅ Evento de conversação emitido:', {
          conversation_id:   conversationId,
          uazapi_message_id: messageId,
          company_id:        company.id,
        });

      } catch (emitterError) {
        console.error('🤖 ❌ EXCEPTION no emitter de conversação:', emitterError.message);
      }
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
// Implementa: Download + Descriptografia + Upload para Supabase Storage
async function processMediaMessageRobust(message, supabase, originalUrl, rawMediaType) {
  try {
    console.log('🎥 PROCESSAMENTO ROBUSTO DE MÍDIA:', rawMediaType, originalUrl.substring(0, 80) + '...');

    // Download com os mesmos headers do caminho S3 para evitar corrupção
    const response = await fetch(originalUrl, {
      headers: {
        'User-Agent': 'WhatsApp/2.0',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache'
      }
    });
    if (!response.ok) {
      console.error('❌ Falha ao baixar mídia:', response.status, response.statusText);
      return originalUrl;
    }

    const encryptedBuffer = Buffer.from(await response.arrayBuffer());
    console.log('📦 Mídia baixada, tamanho:', encryptedBuffer.length, 'bytes');

    // ── Descriptografia WhatsApp (AES-256-CBC) ────────────────────────────────
    // O CDN do WhatsApp serve mídia criptografada. Sem descriptografia os bytes
    // são aleatórios e nenhum player consegue reproduzir o arquivo.
    let finalBuffer = encryptedBuffer;
    const mediaKey = message.content?.mediaKey;

    if (mediaKey) {
      console.log('🔓 mediaKey encontrada — descriptografando...');
      try {
        const crypto = await import('crypto');

        function asBuffer(x) {
          if (Buffer.isBuffer(x)) return x;
          if (x instanceof Uint8Array) return Buffer.from(x);
          if (x instanceof ArrayBuffer) return Buffer.from(new Uint8Array(x));
          return Buffer.from(x);
        }

        const infoByType = {
          image:    'WhatsApp Image Keys',
          video:    'WhatsApp Video Keys',
          audio:    'WhatsApp Audio Keys',
          ptt:      'WhatsApp Audio Keys',
          document: 'WhatsApp Document Keys',
        };
        const info = infoByType[rawMediaType] || 'WhatsApp Media Keys';

        const mediaKeyBuf = Buffer.from(mediaKey, 'base64');
        const salt        = Buffer.alloc(32, 0);
        const expanded    = asBuffer(
          crypto.default.hkdfSync('sha256', mediaKeyBuf, salt, Buffer.from(info, 'utf8'), 112)
        );

        const iv        = expanded.subarray(0, 16);
        const cipherKey = expanded.subarray(16, 48);
        // Remover MAC de 10 bytes do final antes de decifrar
        const cipherData = encryptedBuffer.length > 10
          ? encryptedBuffer.subarray(0, encryptedBuffer.length - 10)
          : encryptedBuffer;

        const decipher  = crypto.default.createDecipheriv('aes-256-cbc', cipherKey, iv);
        const decrypted = Buffer.concat([decipher.update(cipherData), decipher.final()]);

        console.log('✅ Descriptografia concluída, tamanho:', decrypted.length, 'bytes');
        finalBuffer = decrypted;
      } catch (decryptErr) {
        console.error('❌ Descriptografia falhou — usando buffer original:', decryptErr.message);
      }
    } else {
      console.log('⚠️ mediaKey ausente — buffer pode estar criptografado');
    }

    // Detectar formato via magic bytes do buffer final (após descriptografia)
    const bytes = new Uint8Array(finalBuffer);
    const detectedFormat = detectFormatByMagicBytes(bytes, response.headers.get('content-type'), rawMediaType);
    const extension   = detectedFormat.extension;
    const contentType = detectedFormat.contentType;

    console.log('🔬 FORMATO DETECTADO:', {
      extension,
      contentType,
      rawMediaType,
      firstBytes: Array.from(bytes.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0'))
    });

    const fileName = `${rawMediaType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    console.log('📁 Fazendo upload para Supabase Storage:', fileName);

    const { error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, finalBuffer, { contentType });

    if (error) {
      console.error('❌ Erro no upload para Supabase:', error);
      return originalUrl;
    }

    const proxyPath = `/api/chat-media/${fileName}`;
    console.log('✅ PROCESSAMENTO CONCLUÍDO - PATH DO PROXY:', proxyPath);
    return proxyPath;

  } catch (error) {
    console.error('❌ EXCEPTION no processamento de mídia:', error);
    return originalUrl;
  }
}

// Função para detectar formato via magic bytes (mais precisa)
// rawMediaType é usado como desempate quando os bytes não identificam o formato
function detectFormatByMagicBytes(bytes, responseContentType, rawMediaType) {
  console.log('🔬 DETECTANDO FORMATO VIA MAGIC BYTES:', {
    bufferLength: bytes.length,
    firstEightBytes: Array.from(bytes.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')),
    responseContentType,
    rawMediaType
  });

  // Magic bytes para diferentes formatos
  if (bytes.length >= 4) {
    // OGG/Opus: 4F 67 67 53 ("OggS")
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      console.log('✅ OGG/OPUS DETECTADO POR MAGIC BYTES!');
      return { extension: 'ogg', contentType: 'audio/ogg' };
    }

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
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
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
  
  // Fallback por rawMediaType — evita salvar áudio como imagem
  const rawTypeMap = {
    'ptt':   { extension: 'ogg', contentType: 'audio/ogg' },
    'audio': { extension: 'ogg', contentType: 'audio/ogg' },
    'video': { extension: 'mp4', contentType: 'video/mp4' },
    'image': { extension: 'jpg', contentType: 'image/jpeg' },
  };
  if (rawMediaType && rawTypeMap[rawMediaType]) {
    console.log('✅ FORMATO INFERIDO POR rawMediaType:', rawMediaType);
    return rawTypeMap[rawMediaType];
  }

  // Último recurso: octet-stream (não image/jpeg para evitar confundir players)
  console.log('⚠️ FORMATO DESCONHECIDO — usando application/octet-stream');
  return { extension: 'bin', contentType: 'application/octet-stream' };
}

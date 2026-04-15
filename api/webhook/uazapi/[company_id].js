// Webhook Uazapi - BASEADO 100% NO WEBHOOK ANTIGO FUNCIONAL
// Endpoint: /api/webhook/uazapi/[company_id]
// CÓPIA EXATA DO uazapi-webhook-final.js + PROCESSAMENTO ROBUSTO DE MÍDIA

import { dispatchLeadCreatedTrigger }    from '../../lib/automation/dispatchLeadCreatedTrigger.js';
import { dispatchMessageReceivedTrigger } from '../../lib/automation/dispatchMessageReceivedTrigger.js';
import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { handleLeadReentry } from '../../lib/leads/handleLeadReentry.js';

export default async function handler(req, res) {
  console.error('🚀 WEBHOOK UAZAPI v2.0 - CACHE BUST ATIVO');
  console.error('⏰ TIMESTAMP:', new Date().toISOString());
  console.error('🔄 CACHE BUST ID:', '20251206-074647');

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
    console.error('📥 PAYLOAD RECEBIDO:', JSON.stringify(req.body, null, 2));
    console.error('📨 MESSAGE COMPLETO:', JSON.stringify(req.body?.message, null, 2));
    
    const result = await processMessage(req.body);
    
    if (result.success) {
      console.error('✅ SUCESSO COM CACHE BUST:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'WEBHOOK ATUALIZADO - CACHE INVALIDADO!',
        timestamp: new Date().toISOString(),
        version: 'v2.0-cache-bust'
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
    
    console.log('🔑 SUPABASE CONECTADO - WEBHOOK NOVO BASEADO NO ANTIGO');
    
    // Validações
    if (payload.EventType !== 'messages') {
      return { success: false, error: 'Event type inválido' };
    }
    
    if (!payload.message) {
      return { success: false, error: 'Mensagem não encontrada' };
    }
    
    const message = payload.message;

    // =====================================================
    // Direção / origem da mensagem (espelho do WhatsApp)
    // =====================================================

    const isFromMe = !!message.fromMe;
    const isFromApi = !!message.wasSentByApi;
    const isDeviceSent = !!message.deviceSent;

    // Manter comportamento de ignorar grupos
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

    const rawMessageType = (message.messageType || '').toLowerCase();
    const rawType = (message.type || '').toLowerCase();
    const rawMediaType = (message.mediaType || '').toLowerCase();

    // LOGS DETALHADOS DA DETECÇÃO DE MÍDIA
    console.error('🔍 ANÁLISE DETALHADA DA DETECÇÃO:');
    console.error('📊 VARIÁVEIS BÁSICAS:', {
      rawType: rawType,
      rawMediaType: rawMediaType,
      rawMessageType: rawMessageType
    });

    const isTextMessage =
      rawMessageType === 'conversation' ||
      rawMessageType === 'extendedtextmessage';

    // DETECÇÃO ROBUSTA DE MÍDIA - MÚLTIPLOS FORMATOS
    const condition1 = (rawType === 'media' && !!rawMediaType);
    const condition2 = (rawMessageType.includes('message') && rawMessageType !== 'conversation' && rawMessageType !== 'extendedtextmessage');
    const condition3 = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url));
    
    console.error('🎯 CONDIÇÕES DE DETECÇÃO:', {
      'condition1 (rawType === media && rawMediaType)': condition1,
      'condition2 (messageType includes message)': condition2,
      'condition3 (message.content object with URL)': condition3
    });
    
    const isMediaMessage = condition1 || condition2 || condition3;
    
    console.error('🎯 RESULTADO DETECÇÃO:', { isTextMessage, isMediaMessage });

    if (!isTextMessage && !isMediaMessage) {
      return { success: false, error: 'Tipo não suportado' };
    }
    
    // Extrair dados
    // Para inbound, priorizar sender_pn (número de quem está falando com a empresa)
    // Para outbound (painel/celular), priorizar chatid/wa_chatid/phone (número do lead)
    let rawPhone;

    if (direction === 'outbound') {
      // Outbound: usar sempre o número do chat/contato (lead), nunca o número do owner/sender
      rawPhone =
        message.chatid ||
        payload.chat?.wa_chatid ||
        payload.chat?.phone ||
        message.sender_pn ||
        message.sender;
    } else {
      // Inbound: manter comportamento atual, priorizando quem enviou a mensagem
      rawPhone =
        message.sender_pn ||
        message.chatid ||
        payload.chat?.wa_chatid ||
        payload.chat?.phone ||
        message.sender;
    }

    // Remover qualquer sufixo @... (ex: 5511992195126@s.whatsapp.net)
    // e caracteres não numéricos (ex: +55 11 99219-5126)
    const phoneNumber = rawPhone
      .replace(/@.*$/, '')
      .replace(/\D/g, '');

    // Nome temporário - será corrigido após buscar company
    const tempSenderName = message.senderName || payload.chat?.name || `Contato ${phoneNumber}`;

    let messageText = message.text || '';
    let mediaUrl = null;

    if (!messageText && typeof message.content === 'string') {
      messageText = message.content;
    }

    // 🎬 PROCESSAMENTO DE MÍDIA ANTES DO RPC - CORREÇÃO CRÍTICA
    let finalMediaUrl = null;
    
    if (isMediaMessage) {
      console.error('🎥 PROCESSAMENTO DE MÍDIA INICIADO:', { rawMessageType, rawType, rawMediaType });
      
      const originalUrl = (message.content && typeof message.content === 'object' && (message.content.URL || message.content.url)) || null;
      
      console.error('🔗 URL DE MÍDIA ENCONTRADA:', originalUrl ? originalUrl.substring(0, 100) + '...' : 'NENHUMA URL');
      
      if (originalUrl) {
        console.error('🎬 PROCESSANDO MÍDIA ANTES DO RPC:', { mediaUrl: originalUrl.substring(0, 80) + '...' });
        
        // MIGRAÇÃO PARA AWS S3 - MESMO PADRÃO DO ENVIO
        if (message && message.id && originalUrl.includes('whatsapp.net')) {
          try {
            console.error('🔓 DESCRIPTOGRAFANDO URL VIA UAZAPI:', message.id);
            const uazapiResponse = await fetch('https://lovoo.uazapi.com/message/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: message.id })
            });
            
            if (uazapiResponse.ok) {
              const uazapiData = await uazapiResponse.json();
              if (uazapiData.fileURL) {
                console.error('✅ URL DESCRIPTOGRAFADA OBTIDA VIA UAZAPI');
                
                // MIGRAÇÃO AWS S3: Download e upload para S3
                console.error('🚀 AWS S3: Fazendo download da mídia descriptografada...');
                const mediaResponse = await fetch(uazapiData.fileURL);
                if (mediaResponse.ok) {
                  const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
                  console.error('📦 AWS S3: Mídia baixada, tamanho:', mediaBuffer.length, 'bytes');
                  
                  // Detectar formato e gerar nome do arquivo
                  const { S3Storage } = await import('../../../src/services/aws/s3Storage');
                  const contentType = S3Storage.detectContentType(mediaBuffer, 'media');
                  const extension = contentType.split('/')[1] || 'bin';
                  const fileName = `whatsapp_${Date.now()}_${message.id.substring(0, 8)}.${extension}`;
                  
                  console.error('🔬 AWS S3: Formato detectado:', { contentType, extension, fileName });
                  
                  // Upload para AWS S3
                  console.error('☁️ AWS S3: Fazendo upload para S3...');
                  const s3Result = await S3Storage.uploadToS3({
                    companyId: company.id,
                    buffer: mediaBuffer,
                    originalFileName: fileName,
                    contentType: contentType,
                    source: 'whatsapp',
                    messageId: message.id
                  });
                  
                  if (s3Result.success) {
                    console.error('✅ AWS S3: Upload concluído com sucesso!');
                    
                    // Gerar signed URL permanente
                    console.error('🔗 AWS S3: Gerando signed URL...');
                    const signedUrlResult = await S3Storage.generateSignedUrl(
                      company.id, 
                      s3Result.data.s3Key,
                      { expiresIn: 86400 } // 24 horas
                    );
                    
                    if (signedUrlResult.success) {
                      finalMediaUrl = signedUrlResult.data;
                      console.error('🎯 AWS S3: URL permanente gerada:', finalMediaUrl.substring(0, 100) + '...');
                    } else {
                      console.error('❌ AWS S3: Erro ao gerar signed URL:', signedUrlResult.error);
                      finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
                    }
                  } else {
                    console.error('❌ AWS S3: Erro no upload:', s3Result.error);
                    finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
                  }
                } else {
                  console.error('❌ AWS S3: Erro ao baixar mídia descriptografada');
                  finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
                }
              } else {
                console.error('⚠️ UAZAPI NÃO RETORNOU fileURL - usando fallback Supabase');
                finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
              }
            } else {
              console.error('⚠️ ERRO NA DESCRIPTOGRAFIA UAZAPI - usando fallback Supabase');
              finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
            }
          } catch (decryptError) {
            console.error('❌ ERRO NA DESCRIPTOGRAFIA/AWS S3:', decryptError);
            console.error('🔄 FALLBACK: usando processamento Supabase');
            finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
          }
        } else {
          console.error('🚀 USANDO FALLBACK SUPABASE STORAGE...');
          finalMediaUrl = await processMediaMessageRobust(message, supabase, originalUrl, rawMediaType);
        }
        
        console.error('✅ MÍDIA PROCESSADA - URL FINAL:', finalMediaUrl ? 'SUCESSO' : 'FALHOU');
      } else {
        console.error('❌ NENHUMA URL DE MÍDIA ENCONTRADA');
        finalMediaUrl = null;
      }
    } else {
      console.error('⚠️ MENSAGEM NÃO É MÍDIA - PULANDO PROCESSAMENTO');
    }
    
    // Usar URL processada para o RPC
    mediaUrl = finalMediaUrl;
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    const instanceName = payload.instanceName;
    
    console.error('📞 DADOS:', { phoneNumber, tempSenderName, instanceName });
    
    // Buscar instância
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, company_id, provider_token, companies(id, name, api_key)')
      .eq('provider_instance_id', instanceName)
      .eq('status', 'connected')
      .single();
    
    if (instanceError || !instance) {
      return { success: false, error: 'Instância não encontrada: ' + instanceName };
    }
    
    const company = instance.companies;
    console.log('🏢 EMPRESA:', company.name);
    
    // =====================================================
    // BUSCAR NOME DO LEAD NO CADASTRO (FONTE DA VERDADE)
    // =====================================================
    // Agora que temos company, buscar nome correto do lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('name')
      .eq('phone', phoneNumber)
      .eq('company_id', company.id)
      .is('deleted_at', null)
      .single();

    // Fallback robusto: cadastro → API → chat → genérico
    const senderName = existingLead?.name || 
                       tempSenderName;
    
    console.log('👤 NOME RESOLVIDO:', { 
      leadName: existingLead?.name, 
      tempName: tempSenderName, 
      finalName: senderName 
    });
    
    // USAR FUNÇÃO SECURITY DEFINER PARA PROCESSAR MENSAGEM COMPLETA
    console.log('🔄 USANDO FUNÇÃO SECURITY DEFINER PARA PROCESSAMENTO SEGURO');
    console.error('📎 MÍDIA URL FINAL PARA RPC:', mediaUrl ? mediaUrl.substring(0, 100) + '...' : 'NULL');
    
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
    const isNewContact = webhookResult?.lead_created || false;

    // =====================================================
    // SINCRONIZAÇÃO DE FOTO VIA imagePreview DO PAYLOAD
    // =====================================================
    // Usa a foto que já vem direto no webhook (sem chamada extra à API Uazapi).
    // Executado em fire-and-forget — não bloqueia a resposta 200.
    try {
      const imagePreview = payload.chat?.imagePreview;
      const hasWhatsAppCdnPreview = isWhatsAppCdnPhoto(imagePreview);

      if (hasWhatsAppCdnPreview) {
        console.log('📸 imagePreview detectado — verificando necessidade de sync:', phoneNumber);

        // Throttle: só prossegue se a foto precisar ser atualizada
        shouldSyncPhoto(supabase, company.id, phoneNumber, isNewContact)
          .then(async (needsSync) => {
            if (!needsSync) {
              console.log('📸 Sync ignorado pelo throttle:', phoneNumber);
              return;
            }

            const stableUrl = await downloadAndStoreContactAvatar({
              supabase,
              profileUrl: imagePreview,
              companyId: company.id,
              phoneNumber,
            });

            // Só atualiza banco se obteve URL estável do Storage
            if (!stableUrl) {
              console.log('📸 Download falhou — banco não atualizado:', phoneNumber);
              return;
            }

            const { error: photoUpdateError } = await supabase
              .from('chat_contacts')
              .update({
                profile_picture_url: stableUrl,
                photo_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('company_id', company.id)
              .eq('phone_number', phoneNumber);

            if (photoUpdateError) {
              console.error('❌ Erro ao atualizar foto do contato:', photoUpdateError.message);
            } else {
              console.log('📸 ✅ Foto salva no Storage permanente:', phoneNumber);
            }
          })
          .catch((syncError) => {
            console.error('❌ Erro no sync de foto (fire-and-forget):', syncError.message);
          });
      } else {
        // Sem imagePreview fresco no payload — verificar se URL atual no banco é CDN e migrar
        // (cobre mensagens de texto sem campo imagePreview no payload Uazapi)
        shouldSyncPhoto(supabase, company.id, phoneNumber, isNewContact)
          .then(async (needsSync) => {
            if (!needsSync) return;

            const { data: contactRow } = await supabase
              .from('chat_contacts')
              .select('profile_picture_url')
              .eq('company_id', company.id)
              .eq('phone_number', phoneNumber)
              .single();

            const existingCdnUrl = contactRow?.profile_picture_url;
            if (!existingCdnUrl || !isWhatsAppCdnPhoto(existingCdnUrl)) {
              console.log('📸 URL no banco não é CDN ou ausente — nada a migrar:', phoneNumber);
              return;
            }

            console.log('📸 URL CDN no banco detectada sem imagePreview — tentando migrar:', phoneNumber);

            const stableUrl = await downloadAndStoreContactAvatar({
              supabase,
              profileUrl: existingCdnUrl,
              companyId: company.id,
              phoneNumber,
            });

            if (!stableUrl) {
              console.log('📸 Download da URL do banco falhou (pode ter expirado):', phoneNumber);
              return;
            }

            const { error: photoUpdateError } = await supabase
              .from('chat_contacts')
              .update({
                profile_picture_url: stableUrl,
                photo_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('company_id', company.id)
              .eq('phone_number', phoneNumber);

            if (photoUpdateError) {
              console.error('❌ Erro ao atualizar foto (fallback sem imagePreview):', photoUpdateError.message);
            } else {
              console.log('📸 ✅ Foto migrada via URL do banco (sem imagePreview):', phoneNumber);
            }
          })
          .catch((syncError) => {
            console.error('❌ Erro no sync de foto (fallback sem imagePreview):', syncError.message);
          });
      }
    } catch (syncInitError) {
      console.error('❌ ERRO AO INICIAR SYNC DE FOTO:', syncInitError.message);
      // Não interrompe o fluxo principal
    }
    
    console.log('✅ MENSAGEM PROCESSADA VIA FUNÇÃO SEGURA:', savedMessageId);

    // Download automático da mídia inbound via Uazapi (message/download)
    if (isMediaMessage && mediaUrl) {
      try {
        await downloadAndStoreMedia({
          supabase,
          baseUrl: payload.BaseUrl,
          token: payload.token,
          chatMessageId: savedMessageId,
          messageId,
          mediaType: rawMediaType, // Passar tipo de mídia correto
        });
      } catch (mediaError) {
        console.error('⚠️ Erro ao processar mídia inbound (message/download):', mediaError);
        // Não falha o webhook
      }
    }
    
    // 🎯 CRIAR LEAD + OPORTUNIDADE AUTOMATICAMENTE (INBOUND + OUTBOUND DEVICE)
    let leadId = null;
    if (direction === 'inbound' || source === 'device') {
      try {
        console.log('🔍 CRIANDO/VERIFICANDO LEAD VIA create_lead_from_whatsapp_safe...');
        console.log('📍 Empresa:', company.id, '-', company.name, '| Direção:', direction, '| Source:', source);

        // Para outbound device: usar payload.chat?.name (nome do contato na agenda)
        // Para inbound: usar senderName (pushName do WhatsApp)
        const contactName = source === 'device' && direction === 'outbound'
          ? (payload.chat?.name || `Contato ${phoneNumber}`)
          : (senderName || 'Lead WhatsApp');

        // create_lead_from_whatsapp_safe: cria lead + oportunidade + posição no funil padrão
        // Se lead já existe, retorna o existente sem duplicar
        const { data: rpcResult, error: leadError } = await supabase
          .rpc('create_lead_from_whatsapp_safe', {
            p_company_id: company.id,
            p_phone: phoneNumber,
            p_name: contactName
          });

        if (leadError) {
          console.error('⚠️ ERRO AO CRIAR LEAD (create_lead_from_whatsapp_safe):', leadError.message);
          // NÃO FALHA - sistema continua funcionando
        } else if (rpcResult && rpcResult.success) {
          leadId = rpcResult.lead_id;
          const wasCreated = rpcResult.created;
          console.log(wasCreated ? '🆕 NOVO LEAD CRIADO:' : '👤 LEAD JÁ EXISTIA:', leadId);
          if (wasCreated && rpcResult.opportunity_id) {
            console.log('✅ OPORTUNIDADE CRIADA:', rpcResult.opportunity_id);
          }
          // Disparar automação apenas para leads recém-criados (fire-and-forget)
          if (wasCreated && leadId) {
            dispatchLeadCreatedTrigger({ companyId: company.id, leadId, source: 'whatsapp' })
              .catch(err => console.error('[webhook/uazapi] automation trigger failed:', err));
          }
          // Registrar reentrada quando lead já existia (fire-and-forget)
          if (!wasCreated && leadId) {
            const supabaseAdmin = getSupabaseAdmin();
            handleLeadReentry({
              newLeadId: leadId,      // mesmo lead — sem lead duplicado novo criado
              existingLeadId: leadId, // reentrada direta pelo WhatsApp
              companyId: company.id,
              source: 'whatsapp',
              externalEventId: payload?.data?.key?.id || payload?.data?.messageId || null,
              originChannel: 'whatsapp',
              metadata: { phone: phoneNumber, contact_name: contactName },
              supabase: supabaseAdmin,
            }).catch(err => console.error('[webhook/uazapi] handleLeadReentry failed:', err));
          }

          // Vincular lead_id à conversa (apenas se ainda não vinculado)
          if (conversationId && leadId) {
            const { error: linkError } = await supabase
              .from('chat_conversations')
              .update({ lead_id: leadId })
              .eq('id', conversationId)
              .is('lead_id', null);
            if (linkError) {
              console.error('⚠️ ERRO AO VINCULAR LEAD NA CONVERSA:', linkError.message);
            } else {
              console.log('🔗 LEAD VINCULADO À CONVERSA:', conversationId);
            }
          }
        } else {
          console.error('⚠️ RPC RETORNOU ERRO:', rpcResult?.error || 'Erro desconhecido');
        }
      } catch (leadException) {
        console.error('⚠️ EXCEPTION AO PROCESSAR LEAD:', leadException.message);
        // NÃO FALHA - sistema continua funcionando
      }

      // 🔔 CANCELAMENTO AUTOMÁTICO DE MENSAGENS AGENDADAS
      // Quando lead responde, cancelar mensagens agendadas se configurado
      // 🔥 WEBHOOK VERSION: 2026-03-02-17:50 - AUTO-CANCEL ENABLED
      try {
        console.log('🔥 WEBHOOK AUTO-CANCEL VERSION: 2026-03-02-17:50 [company_id]');
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

      // 🎯 DISPATCH message.received — aciona automações de mensagem recebida (fire-and-forget)
      if (conversationId) {
        dispatchMessageReceivedTrigger({
          companyId:      company.id,
          leadId:         leadId || null,
          conversationId,
          instanceId:     instance.id,
          messageId:      savedMessageId,
          text:           messageText,
        }).catch(err => console.error('[webhook/uazapi/company_id] message.received trigger failed:', err));
      }
    }
    
    return { 
      success: true, 
      message_id: savedMessageId,
      contact_id: contactId,
      conversation_id: conversationId,
      lead_id: leadId
    };
    
  } catch (error) {
    console.error('❌ EXCEPTION:', error);
    return { success: false, error: error.message };
  }
}

// ... (rest of the code remains the same)

async function downloadAndStoreMedia({
  supabase,
  baseUrl,
  token,
  chatMessageId,
  messageId,
}) {
  try {
    console.log(' Solicitando download de mídia via Uazapi /message/download...', { baseUrl, messageId });

    const url = `${baseUrl.replace(/\/$/, '')}/message/download`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token,
      },
      body: JSON.stringify({
        id: messageId,
        return_base64: false,
        generate_mp3: false,
        return_link: true,
        transcribe: false,
        download_quoted: false,
      }),
    });

    if (!response.ok) {
      console.error(' Falha ao chamar /message/download na Uazapi:', response.status, response.statusText);
      return;
    }

    const data = await response.json();
    const publicUrl = data.fileURL || data.fileUrl || data.url;
    if (!publicUrl) {
      console.error(' Resposta de /message/download sem fileURL:', data);
      return;
    }

    console.log(' URL de mídia retornada pela Uazapi:', publicUrl);

    const { error: updateError } = await supabase
      .from('chat_messages')
      .update({ media_url: publicUrl })
  } catch (error) {
    console.error('[downloadAndStoreContactAvatar] EXCEPTION:', error);
    return null;
  }
}

// =====================================================
// UTILITÁRIO: NORMALIZAÇÃO DE TELEFONE
// =====================================================
function normalizePhone(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '');
}

// =====================================================
// FUNÇÃO PARA VERIFICAÇÃO INTELIGENTE DE SINCRONIZAÇÃO
// =====================================================
function isWhatsAppCdnPhoto(url) {
  return url && (
    url.includes('pps.whatsapp.net') ||
    url.includes('mmg.whatsapp.net')
  );
}

async function shouldSyncPhoto(supabase, companyId, phoneNumber, isNewContact = false) {
  try {
    console.log('[shouldSyncPhoto] Verificando necessidade de sincronização:', {
      companyId,
      phoneNumber,
      isNewContact
    });

    // 1. CONTATO NOVO: sempre sincronizar
    if (isNewContact) {
      console.log('[shouldSyncPhoto] Contato novo - sincronizar');
      return true;
    }

    // 2. BUSCAR DADOS ATUAIS DO CONTATO (query otimizada)
    const { data: contact, error } = await supabase
      .from('chat_contacts')
      .select('profile_picture_url, updated_at, photo_updated_at')
      .eq('company_id', companyId)
      .eq('phone_number', phoneNumber)
      .single();

    if (error || !contact) {
      console.log('[shouldSyncPhoto] Contato não encontrado ou erro na query - sincronizar por segurança');
      return true;
    }

    const currentUrl = contact.profile_picture_url;

    // 3. SEM FOTO: sincronizar para tentar obter
    if (!currentUrl) {
      console.log('[shouldSyncPhoto] Sem foto - sincronizar');
      return true;
    }

    // 4. URL TEMPORÁRIA DO CDN WHATSAPP: migrar para Storage
    if (isWhatsAppCdnPhoto(currentUrl)) {
      console.log('[shouldSyncPhoto] URL temporária do WhatsApp CDN - migrar para Storage');
      return true;
    }

    // A partir daqui a URL já é estável (Storage). Aplicar throttle de 24h.
    const lastUpdate = new Date(contact.photo_updated_at || contact.updated_at);
    const today = new Date().toDateString();
    const lastUpdateDate = lastUpdate.toDateString();

    if (today === lastUpdateDate) {
      console.log('[shouldSyncPhoto] URL estável e já sincronizado hoje (' + lastUpdateDate + ') - pular');
      return false;
    }

    // 5. PRIMEIRA INTERAÇÃO DO DIA COM URL ESTÁVEL: atualizar
    console.log('[shouldSyncPhoto] Primeira interação do dia (última: ' + lastUpdateDate + ') - sincronizar');
    return true;

  } catch (error) {
    console.error('[shouldSyncPhoto] EXCEPTION na verificação:', error);
    return true;
  }
}

// =====================================================
// FUNÇÃO PARA DOWNLOAD E ARMAZENAMENTO NO SUPABASE STORAGE
// =====================================================
// Implementada em: 2025-11-27 - Corrigir sistema de fotos
// Backup criado: uazapi-webhook-final.js.backup-YYYYMMDD-HHMMSS
async function downloadAndStoreContactAvatar({
  supabase,
  profileUrl,
  companyId,
  phoneNumber,
}) {
  try {
    console.log('[downloadAndStoreContactAvatar] Iniciando download da foto:', {
      profileUrl: profileUrl?.substring(0, 80) + '...',
      companyId,
      phoneNumber
    });

    // Validar parâmetros obrigatórios
    if (!profileUrl || !companyId || !phoneNumber) {
      console.log('[downloadAndStoreContactAvatar] Parâmetros insuficientes, abortando');
      return null;
    }

    // 1. Fazer download da imagem da URL temporária
    const response = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LovooCRM/1.0)',
      },
    });

    if (!response.ok) {
      console.error('[downloadAndStoreContactAvatar] Falha no download:', response.status, response.statusText);
      return null;
    }

    // 2. Converter para buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    console.log('[downloadAndStoreContactAvatar] Download concluído, tamanho:', buffer.length, 'bytes');

    // 3. Definir nome estável do arquivo no Storage
    // Formato: avatars/{companyId}/{phone_normalizado}.jpg
    // upsert:true garante que só existe um arquivo por contato (sem acumulação)
    const cleanPhone = normalizePhone(phoneNumber);
    const fileName = `avatars/${companyId}/${cleanPhone}.jpg`;

    console.log('[downloadAndStoreContactAvatar] Fazendo upload para Storage:', fileName);

    // 4. Upload para Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('contact-avatars')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('[downloadAndStoreContactAvatar] Erro no upload:', uploadError);
      return null;
    }

    console.log('[downloadAndStoreContactAvatar] Upload concluído:', uploadData?.path);

    // 5. Obter URL pública estável
    const { data: { publicUrl } } = supabase.storage
      .from('contact-avatars')
      .getPublicUrl(fileName);

    console.log('[downloadAndStoreContactAvatar] URL estável gerada:', publicUrl?.substring(0, 80) + '...');

    return publicUrl;

  } catch (error) {
    console.error('❌ [downloadAndStoreContactAvatar] EXCEPTION COMPLETA:', {
      message: error.message,
      stack: error.stack,
      profileUrl: profileUrl?.substring(0, 80) + '...',
      companyId,
      phoneNumber
    });
    return null;
  }
}

// Sincronizar foto de perfil do contato usando Uazapi v2
async function syncContactProfilePictureFromUazapi({
  supabase,
  baseUrl,
  token,
  instanceName,
  companyId,
  phoneNumber,
}) {
  try {
    console.error('🔍 [syncContactProfilePictureFromUazapi] INICIANDO SINCRONIZAÇÃO');
    console.error('🔍 [syncContactProfilePictureFromUazapi] Parâmetros recebidos:', {
      hasSupabase: !!supabase,
      baseUrl,
      hasToken: !!token,
      tokenLength: token?.length,
      instanceName,
      companyId,
      phoneNumber
    });
    
    if (!token || !instanceName || !companyId || !phoneNumber) {
      console.error('❌ [syncContactProfilePictureFromUazapi] DADOS INSUFICIENTES:', {
        hasToken: !!token,
        hasInstanceName: !!instanceName,
        hasCompanyId: !!companyId,
        hasPhoneNumber: !!phoneNumber
      });
      return;
    }

    // Usar endpoint oficial da Uazapi para buscar nome e imagem do contato
    const url = `https://api.uazapi.com/chat/GetNameAndImageURL/${instanceName}`;

    console.error('📡 [syncContactProfilePictureFromUazapi] Chamando API Uazapi:', {
      url,
      phoneNumber,
      method: 'POST',
      hasApiKey: !!token
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Conforme documentação: usar header apikey
        apikey: token,
      },
      body: JSON.stringify({ phone: phoneNumber }),
    });

    console.error('📡 [syncContactProfilePictureFromUazapi] Resposta HTTP:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [syncContactProfilePictureFromUazapi] FALHA HTTP:', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      return;
    }

    const data = await response.json();
    console.error('📦 [syncContactProfilePictureFromUazapi] Dados recebidos da API:', {
      success: data?.success,
      hasData: !!data?.data,
      hasProfilePictureUrl: !!data?.data?.profilePictureUrl,
      profilePictureUrl: data?.data?.profilePictureUrl?.substring(0, 100) + '...',
      fullResponse: JSON.stringify(data)
    });
    
    const profileUrl = data?.data?.profilePictureUrl;

    if (!data?.success || !profileUrl) {
      console.error('⚠️ [syncContactProfilePictureFromUazapi] Resposta sem profilePictureUrl:', {
        success: data?.success,
        hasProfileUrl: !!profileUrl,
        dataKeys: Object.keys(data || {}),
        fullData: JSON.stringify(data)
      });
      return;
    }

    console.error('✅ [syncContactProfilePictureFromUazapi] URL de foto obtida da Uazapi:', profileUrl.substring(0, 80) + '...');

    // Baixar avatar da Uazapi e armazenar em Storage proprio para obter URL estavel
    console.error('📥 [syncContactProfilePictureFromUazapi] Iniciando download e armazenamento no Storage...');
    const stableAvatarUrl = await downloadAndStoreContactAvatar({
      supabase,
      profileUrl,
      companyId,
      phoneNumber,
    });

    console.error('📥 [syncContactProfilePictureFromUazapi] Resultado do download/upload:', {
      hasStableUrl: !!stableAvatarUrl,
      stableUrl: stableAvatarUrl?.substring(0, 100) + '...',
      willUseFallback: !stableAvatarUrl
    });

    const finalUrl = stableAvatarUrl || profileUrl;

    console.error('💾 [syncContactProfilePictureFromUazapi] Atualizando banco de dados:', {
      finalUrl: finalUrl.substring(0, 100) + '...',
      isStorageUrl: finalUrl.includes('supabase.co/storage'),
      isWhatsAppUrl: finalUrl.includes('pps.whatsapp.net'),
      companyId,
      phoneNumber
    });

    const { error: updateError } = await supabase
      .from('chat_contacts')
      .update({ profile_picture_url: finalUrl, photo_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('phone_number', phoneNumber);

    if (updateError) {
      console.error('❌ [syncContactProfilePictureFromUazapi] ERRO ao atualizar chat_contacts:', {
        error: updateError.message,
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint
      });
      return;
    }

    console.error('🎉 [syncContactProfilePictureFromUazapi] SUCESSO - Foto sincronizada:', {
      phoneNumber,
      finalUrl: finalUrl.substring(0, 100) + '...',
      isStorageUrl: finalUrl.includes('supabase.co/storage')
    });
  } catch (error) {
    console.error('❌ [syncContactProfilePictureFromUazapi] EXCEPTION COMPLETA:', {
      message: error.message,
      stack: error.stack,
      phoneNumber,
      companyId
    });
  }
}

// =====================================================
// FUNÇÃO ROBUSTA PARA PROCESSAMENTO DE MÍDIA
// =====================================================
// Implementada em: 2025-12-05 - Correção definitiva de vídeos recebidos
// Download automático de URLs externas + Upload para Supabase Storage
async function processMediaMessageRobust(message, supabase, originalUrl, rawMediaType) {
  try {
    console.log('🎥 PROCESSAMENTO ROBUSTO DE MÍDIA:', rawMediaType, originalUrl.substring(0, 80) + '...');
    
    // Download da mídia externa (WhatsApp CDN)
    const response = await fetch(originalUrl);
    if (!response.ok) {
      console.error('❌ Falha ao baixar mídia:', response.status, response.statusText);
      return originalUrl; // Fallback para URL original
    }
    
    const mediaBuffer = await response.arrayBuffer();
    console.log('📦 Mídia baixada, tamanho:', mediaBuffer.byteLength, 'bytes');
    
    // Determinar extensão baseada no tipo de mídia
    const extension = getFileExtensionRobust(rawMediaType);
    const fileName = `${rawMediaType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    console.log('📁 Fazendo upload para Supabase Storage:', fileName);
    
    // Upload para Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, mediaBuffer, {
        contentType: getContentTypeRobust(rawMediaType)
      });
    
    if (error) {
      console.error('❌ Erro no upload para Supabase:', error);
      return originalUrl; // Fallback para URL original
    }
    
    // Retornar URL pública estável
    const { data: publicUrl } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName);
    
    console.log('✅ PROCESSAMENTO CONCLUÍDO - URL INTERNA:', publicUrl.publicUrl.substring(0, 80) + '...');
    return publicUrl.publicUrl;
    
  } catch (error) {
    console.error('❌ EXCEPTION no processamento de mídia:', error);
    return originalUrl; // Fallback para URL original
  }
}

// Função para determinar extensão do arquivo baseada no tipo de mídia
function getFileExtensionRobust(mediaType) {
  const typeMap = {
    'video': 'mp4',
    'image': 'jpg', 
    'audio': 'ogg',
    'ptt': 'ogg',
    'document': 'pdf'
  };
  
  return typeMap[mediaType] || 'bin';
}

// Função para determinar content type baseado no tipo de mídia
function getContentTypeRobust(mediaType) {
  const typeMap = {
    'video': 'video/mp4',
    'image': 'image/jpeg',
    'audio': 'audio/ogg', 
    'ptt': 'audio/ogg',
    'document': 'application/pdf'
  };
  
  return typeMap[mediaType] || 'application/octet-stream';
}

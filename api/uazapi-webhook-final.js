// Webhook Uazapi - NOME COMPLETAMENTE NOVO PARA EVITAR CACHE
// Endpoint: /api/uazapi-webhook-final
// SOLUÇÃO DEFINITIVA PARA PROBLEMA DE CACHE DO VERCEL

export default async function handler(req, res) {
  console.log('🎯 WEBHOOK UAZAPI FINAL - NOVO ARQUIVO SEM CACHE');
  console.log('Timestamp:', new Date().toISOString());

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
    
    console.log('🔑 SUPABASE CONECTADO - ARQUIVO NOVO');
    
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

    const isTextMessage =
      rawMessageType === 'conversation' ||
      rawMessageType === 'extendedtextmessage';

    const isMediaMessage =
      rawType === 'media' && !!rawMediaType;

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

    if (isMediaMessage && message.content && typeof message.content === 'object') {
      mediaUrl = message.content.URL || message.content.url || null;
    }
    const messageId = message.id;
    const timestamp = message.messageTimestamp;
    const instanceName = payload.instanceName;
    
    console.log('📞 DADOS:', { phoneNumber, tempSenderName, instanceName });
    
    // Buscar instância
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
    
    // Buscar/criar contato
    let contactId;
    const { data: existingContact } = await supabase
      .from('chat_contacts')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('company_id', company.id)
      .single();
    
    if (existingContact) {
      contactId = existingContact.id;
      console.log('👤 CONTATO EXISTENTE:', contactId);
    } else {
      // USAR NOME CORRETO DA COLUNA
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

      // Sincronizar foto de perfil do contato via Uazapi em background
      try {
        syncContactProfilePictureFromUazapi({
          supabase,
          baseUrl: payload.BaseUrl,
          token: payload.token,
          instanceName,
          companyId: company.id,
          phoneNumber,
        }).catch((syncError) => {
          console.error('⚠️ Erro ao sincronizar foto do contato (async):', syncError);
        });
      } catch (syncInitError) {
        console.error('⚠️ Erro ao iniciar sync de foto do contato:', syncInitError);
      }
    }
    
    // Buscar/criar conversa
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
      
      // Atualizar contact_name se estiver vazio
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
    
    // Verificar duplicata
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
    
    // Salvar mensagem
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
        media_url: mediaUrl,
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

    // Download automático da mídia inbound via Uazapi (message/download)
    if (isMediaMessage && mediaUrl) {
      try {
        await downloadAndStoreMedia({
          supabase,
          baseUrl: payload.BaseUrl,
          token: payload.token,
          chatMessageId: savedMessage.id,
          messageId,
        });
      } catch (mediaError) {
        console.error('⚠️ Erro ao processar mídia inbound (message/download):', mediaError);
        // Não falha o webhook
      }
    }
    
    // 🎯 CRIAR LEAD AUTOMATICAMENTE (PADRÃO API DE LEADS) APENAS PARA MENSAGENS INBOUND
    let leadId = null;
    if (direction === 'inbound') {
      try {
        console.log('🔍 VERIFICANDO SE LEAD JÁ EXISTE NA EMPRESA DA INSTÂNCIA...');
        console.log('📍 Empresa da instância:', company.id, '-', company.name);

        // Normalizar telefone para busca mais eficiente
        const phoneVariations = [
          phoneNumber,                    // 5511999198369
          `+55${phoneNumber}`,           // +555511999198369
          phoneNumber.substring(2),       // 11999198369
          `+55${phoneNumber.substring(2)}` // +5511999198369
        ];
        
        console.log('📞 Variações de telefone para busca:', phoneVariations);
        
        // Verificar se já existe lead APENAS na empresa da instância (isolamento total)
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, phone, name')
          .eq('company_id', company.id)  // ISOLAMENTO: apenas na empresa da instância
          .in('phone', phoneVariations)
          .is('deleted_at', null)        // IGNORAR leads deletados (soft delete)
          .limit(1)
          .single();
        
        if (existingLead) {
          leadId = existingLead.id;
          console.log('👤 LEAD JÁ EXISTE NA EMPRESA DA INSTÂNCIA:', leadId);
          console.log('📋 Dados do lead encontrado:', existingLead);
        } else {
          console.log('🚫 NENHUM LEAD ENCONTRADO NA EMPRESA DA INSTÂNCIA');
          console.log('📍 Criando novo lead na empresa:', company.name);
          console.log('🆕 CRIANDO NOVO LEAD (RPC API)...');
          
          // USAR EXATAMENTE O MESMO RPC DA API DE LEADS QUE FUNCIONA
          const leadData = {
            api_key: company.api_key, // Usar api_key real da empresa
            name: senderName || 'Lead WhatsApp',
            email: null,
            phone: phoneNumber,
            interest: null,
            company_name: null,
            company_cnpj: null,
            company_email: null,
            visitor_id: null
          };
          
          // Usar RPC que bypassa trigger e captura exceções
          const { data: rpcResult, error: leadError } = await supabase
            .rpc('public_create_lead_webhook', { 
              lead_data: {
                ...leadData,
                company_id: company.id // Adicionar company_id para o RPC
              }
            });
          
          if (leadError) {
            console.error('⚠️ ERRO AO CRIAR LEAD (RPC):', leadError.message);
            // NÃO FALHA - apenas loga o erro
          } else if (rpcResult && rpcResult.success) {
            leadId = rpcResult.lead_id;
            console.log('🎉 NOVO LEAD CRIADO (RPC API):', leadId);
          } else {
            console.error('⚠️ RPC RETORNOU ERRO:', rpcResult?.error || 'Erro desconhecido');
          }
        }
      } catch (leadException) {
        console.error('⚠️ EXCEPTION AO PROCESSAR LEAD:', leadException.message);
        // NÃO FALHA - sistema continua funcionando
      }
    }
    
    return { 
      success: true, 
      message_id: savedMessage.id,
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
    if (!token || !instanceName || !companyId || !phoneNumber) {
      console.log('[syncContactProfilePictureFromUazapi] Dados insuficientes para sincronizar foto, abortando.');
      return;
    }

    // Usar endpoint oficial da Uazapi para buscar nome e imagem do contato
    const url = `https://api.uazapi.com/chat/GetNameAndImageURL/${instanceName}`;

    console.log('[syncContactProfilePictureFromUazapi] Chamando Uazapi para foto do contato...', {
      url,
      phoneNumber,
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

    if (!response.ok) {
      console.error('[syncContactProfilePictureFromUazapi] Falha HTTP ao buscar foto do contato:', response.status, response.statusText);
      return;
    }

    const data = await response.json();
    const profileUrl = data?.data?.profilePictureUrl;

    if (!data?.success || !profileUrl) {
      console.log('[syncContactProfilePictureFromUazapi] Resposta sem profilePictureUrl util:', data);
      return;
    }

    console.log('[syncContactProfilePictureFromUazapi] URL de foto obtida da Uazapi:', profileUrl.substring(0, 80) + '...');

    // Baixar avatar da Uazapi e armazenar em Storage proprio para obter URL estavel
    const stableAvatarUrl = await downloadAndStoreContactAvatar({
      supabase,
      profileUrl,
      companyId,
      phoneNumber,
    });

    const finalUrl = stableAvatarUrl || profileUrl;

    const { error: updateError } = await supabase
      .from('chat_contacts')
      .update({ profile_picture_url: finalUrl, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('phone_number', phoneNumber);

    if (updateError) {
      console.error('[syncContactProfilePictureFromUazapi] Erro ao atualizar profile_picture_url em chat_contacts:', updateError);
      return;
    }

    console.log('[syncContactProfilePictureFromUazapi] profile_picture_url sincronizada com sucesso para', phoneNumber);
  } catch (error) {
    console.error('[syncContactProfilePictureFromUazapi] EXCEPTION:', error);
  }
}

// ... (rest of the code remains the same)

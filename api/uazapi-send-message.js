// =====================================================
// UAZAPI SEND MESSAGE - PROCESSAMENTO ASSÍNCRONO
// =====================================================
// REFATORADO: 23/03/2026
// Objetivo: Eliminar timeout SQL causado por HTTP síncrono
// Estratégia: Separar preparação (SQL rápido) de envio (HTTP lento)
// =====================================================

import { createClient } from '@supabase/supabase-js';

// =====================================================
// CONFIGURAÇÕES SUPABASE
// =====================================================
const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

const supabase = createClient(supabaseUrl, supabaseKey);

// =====================================================
// CONFIGURAÇÕES UAZAPI
// =====================================================
const UAZAPI_CONFIG = {
  BASE_URL: 'https://lovoo.uazapi.com',
  TIMEOUT: 30000,
  ENDPOINTS: {
    SEND_TEXT: '/send/text',
    SEND_MEDIA: '/send/media'
  }
};

// =====================================================
// FUNÇÃO PRINCIPAL DO ENDPOINT
// =====================================================
export default async function handler(req, res) {
  // Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: 'Método não permitido. Use POST.'
    });
    return;
  }

  try {
    console.log('🚀 UAZAPI SEND MESSAGE - Processamento Assíncrono v2.0');
    console.log('📋 Payload recebido:', req.body);

    const { message_id, company_id } = req.body;

    // Validar parâmetros obrigatórios
    if (!message_id || !company_id) {
      console.error('❌ Parâmetros obrigatórios ausentes');
      res.status(400).json({
        success: false,
        error: 'message_id e company_id são obrigatórios'
      });
      return;
    }

    // FASE 1: Preparar mensagem (SQL RÁPIDO - sem HTTP)
    console.log('⚡ FASE 1: Preparando mensagem (SQL rápido)...');
    const { data: messageData, error: prepareError } = await supabase.rpc('prepare_message_for_sending', {
      p_message_id: message_id,
      p_company_id: company_id
    });

    if (prepareError) {
      console.error('❌ Erro ao preparar mensagem:', prepareError);
      res.status(500).json({
        success: false,
        error: 'Erro ao preparar mensagem',
        details: prepareError.message
      });
      return;
    }

    if (!messageData.success) {
      console.error('❌ Validação falhou:', messageData.error);
      res.status(400).json({
        success: false,
        error: messageData.error
      });
      return;
    }

    console.log('✅ Mensagem preparada:', {
      message_id: messageData.message_id,
      type: messageData.message_type,
      phone: messageData.phone
    });

    // RESPOSTA IMEDIATA ao cliente (não aguarda HTTP)
    res.status(200).json({
      success: true,
      message: 'Mensagem em processamento',
      message_id: message_id,
      status: 'sending',
      timestamp: new Date().toISOString()
    });

    // FASE 2: Enviar via Uazapi (ASSÍNCRONO - não bloqueia resposta)
    console.log('🚀 FASE 2: Enviando via Uazapi (assíncrono)...');
    sendToUazapiAsync(messageData).catch(error => {
      console.error('💥 Erro no envio assíncrono:', error);
    });

  } catch (error) {
    console.error('💥 Erro inesperado no endpoint:', error);
    
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// =====================================================
// FUNÇÕES AUXILIARES ISOLADAS
// =====================================================

/**
 * Enviar mensagem para Uazapi de forma assíncrona
 * Não bloqueia a resposta HTTP ao cliente
 */
async function sendToUazapiAsync(messageData) {
  const startTime = Date.now();
  
  try {
    console.log('📤 Iniciando envio assíncrono para Uazapi...');
    console.log('🔍 DEBUG - messageData recebido:', {
      message_id: messageData.message_id,
      message_type: messageData.message_type,
      phone: messageData.phone,
      has_content: !!messageData.content,
      has_token: !!messageData.provider_token,
      content_length: messageData.content?.length || 0
    });
    
    const { 
      message_id, 
      message_type, 
      content, 
      media_url, 
      phone, 
      provider_token 
    } = messageData;

    // Validações críticas
    if (!provider_token) {
      throw new Error('Token do Uazapi não encontrado');
    }
    if (!phone) {
      throw new Error('Telefone não encontrado');
    }
    if (!content && !media_url) {
      throw new Error('Conteúdo ou mídia não encontrado');
    }

    // Determinar endpoint e payload
    let endpoint, payload;
    
    if (message_type === 'text') {
      endpoint = `${UAZAPI_CONFIG.BASE_URL}${UAZAPI_CONFIG.ENDPOINTS.SEND_TEXT}`;
      payload = {
        number: phone,
        text: content,
        delay: 1000,
        linkPreview: true
      };
    } else {
      endpoint = `${UAZAPI_CONFIG.BASE_URL}${UAZAPI_CONFIG.ENDPOINTS.SEND_MEDIA}`;
      payload = {
        number: phone,
        type: message_type,
        file: media_url,
        text: content || '',
        delay: 1000
      };

      // Adicionar nome do documento se for documento
      if (message_type === 'document' && media_url) {
        payload.docName = extractFileName(media_url);
      }
    }

    console.log('🌐 Fazendo requisição HTTP para Uazapi:', {
      endpoint,
      phone,
      type: message_type,
      payload_size: JSON.stringify(payload).length
    });

    // Fazer requisição HTTP para Uazapi com timeout
    // ⚠️ IMPORTANTE: Vercel tem limite de 10s para funções serverless
    // Reduzindo timeout para 8s para garantir que temos tempo de atualizar status
    const SAFE_TIMEOUT = 8000; // 8 segundos
    console.log(`⏱️ Iniciando fetch com timeout de ${SAFE_TIMEOUT}ms...`);
    
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': provider_token
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SAFE_TIMEOUT)
      });

      const elapsed = Date.now() - startTime;
      console.log(`⏱️ Fetch concluído em ${elapsed}ms - Status: ${response.status}`);
    } catch (fetchError) {
      const elapsed = Date.now() - startTime;
      
      if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
        console.error(`⏱️ TIMEOUT após ${elapsed}ms - Uazapi não respondeu a tempo!`);
        throw new Error(`Timeout: Uazapi não respondeu em ${SAFE_TIMEOUT}ms`);
      }
      
      console.error('💥 Erro no fetch:', {
        name: fetchError.name,
        message: fetchError.message,
        elapsed_ms: elapsed
      });
      throw fetchError;
    }

    console.log('📥 Parseando resposta JSON...');
    const responseData = await response.json();
    console.log('📥 Resposta parseada:', responseData);

    if (response.ok) {
      console.log('✅ Uazapi respondeu com sucesso:', responseData);
      
      // Atualizar status para 'sent'
      const uazapiMessageId = responseData.messageid || responseData.messageId;
      
      console.log('💾 Atualizando status para SENT no banco...');
      const { data: updateResult, error: updateError } = await supabase.rpc('update_message_status', {
        p_message_id: message_id,
        p_status: 'sent',
        p_uazapi_message_id: uazapiMessageId
      });

      if (updateError) {
        console.error('❌ Erro ao atualizar status:', updateError);
        throw updateError;
      }

      console.log('✅ Status atualizado para SENT:', message_id, updateResult);
    } else {
      console.error('❌ Uazapi retornou erro:', {
        status: response.status,
        statusText: response.statusText,
        data: responseData
      });
      
      // Atualizar status para 'failed'
      console.log('💾 Atualizando status para FAILED no banco...');
      await supabase.rpc('update_message_status', {
        p_message_id: message_id,
        p_status: 'failed',
        p_error_message: JSON.stringify(responseData)
      });

      console.log('❌ Status atualizado para FAILED:', message_id);
    }

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('💥 Erro no envio assíncrono:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      elapsed_ms: elapsed,
      message_id: messageData.message_id
    });
    
    // Atualizar status para 'failed'
    try {
      console.log('💾 Tentando atualizar status para FAILED após exceção...');
      const { error: updateError } = await supabase.rpc('update_message_status', {
        p_message_id: messageData.message_id,
        p_status: 'failed',
        p_error_message: `${error.name}: ${error.message}`
      });
      
      if (updateError) {
        console.error('❌ Erro ao atualizar status:', updateError);
      } else {
        console.log('✅ Status atualizado para FAILED após exceção:', messageData.message_id);
      }
    } catch (updateError) {
      console.error('💥 Erro ao atualizar status após falha:', {
        message: updateError.message,
        stack: updateError.stack
      });
    }
  }
}

/**
 * Formatar número de telefone para Uazapi
 */
function formatPhoneForUazapi(phone) {
  // Remove caracteres não numéricos
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Garantir formato internacional
  if (cleanPhone.startsWith('55')) {
    return cleanPhone;
  } else if (cleanPhone.startsWith('11') || cleanPhone.startsWith('21')) {
    return `55${cleanPhone}`;
  } else {
    return `5511${cleanPhone}`;
  }
}

/**
 * Extrair nome do arquivo da URL
 */
function extractFileName(url) {
  if (!url) return 'arquivo';
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const fileName = pathname.split('/').pop();
    return fileName || 'arquivo';
  } catch {
    return 'arquivo';
  }
}

/**
 * Mapear tipo de mensagem para Uazapi
 */
function mapMessageTypeToUazapi(messageType) {
  const mapping = {
    'text': 'text',
    'image': 'image',
    'document': 'document',
    'audio': 'audio',
    'video': 'video'
  };
  
  return mapping[messageType] || 'text';
}

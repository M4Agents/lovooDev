// =====================================================
// UAZAPI SEND MESSAGE - ENDPOINT ISOLADO
// =====================================================
// Endpoint isolado para envio de mensagens via Uazapi
// Segue o mesmo padrão do webhook de recebimento
// Mantém 100% de integridade do sistema existente

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
    console.log('🚀 UAZAPI SEND MESSAGE - Iniciando processamento...');
    console.log('📋 Payload recebido:', req.body);

    const { message_id, company_id } = req.body;

    if (!message_id || !company_id) {
      console.error('❌ Parâmetros obrigatórios ausentes');
      res.status(400).json({
        success: false,
        error: 'message_id e company_id são obrigatórios'
      });
      return;
    }

    // ETAPA 1: Preparar mensagem (SQL rápido, sem HTTP)
    console.log('🔄 Preparando mensagem para envio...');
    const { data: prepareResult, error: prepareError } = await supabase.rpc('prepare_message_for_sending', {
      p_message_id: message_id,
      p_company_id: company_id
    });

    if (prepareError || !prepareResult?.success) {
      console.error('❌ Erro ao preparar mensagem:', prepareError || prepareResult);
      res.status(500).json({
        success: false,
        error: 'Erro ao preparar mensagem',
        details: prepareError?.message || prepareResult?.error
      });
      return;
    }

    console.log('✅ Mensagem preparada:', prepareResult);

    // ETAPA 2: Enviar via HTTP no Node.js (não no SQL)
    const messageData = prepareResult;
    const endpoint = messageData.message_type === 'text' 
      ? `${UAZAPI_CONFIG.BASE_URL}${UAZAPI_CONFIG.ENDPOINTS.SEND_TEXT}`
      : `${UAZAPI_CONFIG.BASE_URL}${UAZAPI_CONFIG.ENDPOINTS.SEND_MEDIA}`;

    // replyid só é incluído se a mensagem original tiver uazapi_message_id
    const replyId = messageData.reply_to_uazapi_message_id || null;

    let payload;
    if (messageData.message_type === 'text') {
      payload = {
        number: messageData.phone,
        text: messageData.content,
        delay: 1000,
        linkPreview: true,
        ...(replyId ? { replyid: replyId } : {})
      };
    } else {
      payload = {
        number: messageData.phone,
        type: messageData.message_type,
        file: messageData.media_url,
        text: messageData.content || '',
        delay: 1000,
        ...(replyId ? { replyid: replyId } : {})
      };
      
      if (messageData.message_type === 'document' && messageData.media_url) {
        payload.docName = extractFileName(messageData.media_url);
      }
    }

    if (replyId) {
      console.log('[send-message] reply incluído no payload Uazapi:', { replyId });
    }

    console.log('📤 Enviando para Uazapi:', { endpoint, payload });

    const uazapiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': messageData.provider_token
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UAZAPI_CONFIG.TIMEOUT)
    });

    const uazapiData = await uazapiResponse.json();
    console.log('📥 Resposta Uazapi:', { status: uazapiResponse.status, data: uazapiData });

    // ETAPA 3: Atualizar status da mensagem
    if (uazapiResponse.ok) {
      const { error: updateError } = await supabase.rpc('update_message_status', {
        p_message_id: message_id,
        p_status: 'sent',
        p_uazapi_message_id: uazapiData.messageid || null,
        p_error_message: null
      });

      if (updateError) {
        console.error('⚠️ Erro ao atualizar status (mensagem enviada):', updateError);
      }

      res.status(200).json({
        success: true,
        message: 'Mensagem enviada com sucesso',
        data: {
          message_id,
          uazapi_message_id: uazapiData.messageid,
          phone: messageData.phone,
          instance_name: messageData.instance_name
        },
        timestamp: new Date().toISOString()
      });
    } else {
      const { error: updateError } = await supabase.rpc('update_message_status', {
        p_message_id: message_id,
        p_status: 'failed',
        p_uazapi_message_id: null,
        p_error_message: `HTTP ${uazapiResponse.status}: ${JSON.stringify(uazapiData)}`
      });

      if (updateError) {
        console.error('⚠️ Erro ao atualizar status (falha):', updateError);
      }

      res.status(500).json({
        success: false,
        error: 'Falha no envio via Uazapi',
        details: {
          http_status: uazapiResponse.status,
          response: uazapiData
        }
      });
    }

  } catch (error) {
    console.error('💥 Erro inesperado no endpoint:', error);
    
    const { message_id } = req.body;
    if (message_id) {
      try {
        await supabase.rpc('update_message_status', {
          p_message_id: message_id,
          p_status: 'failed',
          p_uazapi_message_id: null,
          p_error_message: error.message
        });
      } catch (updateErr) {
        console.error('⚠️ Erro ao atualizar status (exception):', updateErr);
      }
    }
    
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

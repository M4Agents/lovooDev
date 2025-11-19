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
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY2NDg1MDMsImV4cCI6MjAzMjIyNDUwM30.f1qVXhFaOCIaOZQlhEGQNBMOGvQIyJHGKGCzJUqCKYNJFI';

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

    // Validar parâmetros obrigatórios
    if (!message_id || !company_id) {
      console.error('❌ Parâmetros obrigatórios ausentes');
      res.status(400).json({
        success: false,
        error: 'message_id e company_id são obrigatórios'
      });
      return;
    }

    // Processar envio via função SQL isolada
    console.log('🔄 Chamando função SQL para envio...');
    const { data: result, error: sqlError } = await supabase.rpc('send_message_via_uazapi', {
      p_message_id: message_id,
      p_company_id: company_id
    });

    if (sqlError) {
      console.error('❌ Erro na função SQL:', sqlError);
      res.status(500).json({
        success: false,
        error: 'Erro interno ao processar envio',
        details: sqlError.message
      });
      return;
    }

    console.log('✅ Resultado do envio:', result);

    // Resposta de sucesso
    res.status(200).json({
      success: true,
      message: 'Processamento de envio concluído',
      data: result,
      timestamp: new Date().toISOString()
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

// =====================================================
// WEBHOOK ENDPOINT - UAZAPI MESSAGES
// =====================================================
// Endpoint específico para receber MENSAGENS do Uazapi
// SEPARADO do endpoint de conexão de instâncias existente

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

// Tipos para mensagens Uazapi (formato real capturado)
interface UazapiMessagePayload {
  EventType: string;
  message: {
    messageType: string;
    text?: string;
    content?: string;
    sender: string;
    senderName?: string;
    id: string;
    messageTimestamp: number;
    fromMe: boolean;
    isGroup: boolean;
    wasSentByApi: boolean;
    chatid?: string;
  };
  owner: string;
  token: string;
  chat?: any;
  instanceName?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log('🚀 WEBHOOK UAZAPI MESSAGES - ENDPOINT ESPECÍFICO PARA MENSAGENS');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);

  // Apenas aceitar POST
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Método não permitido. Use POST.' 
    });
  }

  try {
    console.log('📥 PAYLOAD UAZAPI MESSAGES RECEBIDO:');
    console.log(JSON.stringify(req.body, null, 2));

    const payload: UazapiMessagePayload = req.body;

    // Validar payload básico
    if (!payload.EventType || !payload.message) {
      console.error('Payload inválido - faltam campos obrigatórios');
      return res.status(400).json({
        success: false,
        error: 'Payload inválido - EventType e message são obrigatórios'
      });
    }

    // Processar via RPC que já funciona
    console.log('📞 CHAMANDO RPC process_uazapi_webhook_real...');
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    });

    if (error) {
      console.error('❌ Erro no RPC:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao processar mensagem',
        details: error.message
      });
    }

    if (data && data.success) {
      console.log('✅ Mensagem processada com sucesso:', data);
      return res.status(200).json({
        success: true,
        message: 'Mensagem processada com sucesso',
        message_id: data.message_id || 'processed',
        processed_at: new Date().toISOString(),
        data: data
      });
    } else {
      console.log('⚠️ RPC retornou sem sucesso:', data);
      return res.status(200).json({
        success: false,
        message: 'Mensagem não processada (filtrada ou erro)',
        reason: data?.error || 'Filtrada pelo sistema',
        processed_at: new Date().toISOString(),
        data: data
      });
    }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Unknown error',
      processed_at: new Date().toISOString()
    });
  }
}

// Configuração para aceitar payloads de mensagens
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

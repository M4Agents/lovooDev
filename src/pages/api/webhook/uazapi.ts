// =====================================================
// WEBHOOK ENDPOINT - UAZAPI
// =====================================================
// Endpoint para receber webhooks do Uazapi

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

// Tipos para webhook Uazapi
interface UazapiWebhookPayload {
  event: string;
  instance: {
    id: string;
    name: string;
    status: string;
    qrcode?: string;
    paircode?: string;
    connected?: boolean;
    loggedIn?: boolean;
    profileName?: string;
    phoneNumber?: string;
  };
  data?: any;
  timestamp?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Apenas aceitar POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    console.log('[Webhook Uazapi] Received:', {
      headers: req.headers,
      body: req.body,
      method: req.method
    });

    const payload: UazapiWebhookPayload = req.body;

    // Validar payload básico
    if (!payload.event || !payload.instance) {
      console.error('[Webhook Uazapi] Payload inválido:', payload);
      return res.status(400).json({
        success: false,
        error: 'Payload inválido'
      });
    }

    const { event, instance } = payload;
    console.log('[Webhook Uazapi] Processing event:', event, 'for instance:', instance.name);

    // Processar webhook via RPC function
    const { data, error } = await supabase.rpc('process_uazapi_webhook', {
      p_instance_name: instance.name,
      p_event_type: event,
      p_data: {
        qrcode: instance.qrcode,
        paircode: instance.paircode,
        status: instance.status,
        connected: instance.connected,
        loggedIn: instance.loggedIn,
        profileName: instance.profileName,
        phoneNumber: instance.phoneNumber,
        timestamp: payload.timestamp || new Date().toISOString()
      }
    });

    if (error) {
      console.error('[Webhook Uazapi] RPC Error:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao processar webhook',
        details: error.message
      });
    }

    console.log('[Webhook Uazapi] Processed successfully:', data);

    // Resposta de sucesso
    return res.status(200).json({
      success: true,
      message: 'Webhook processado com sucesso',
      event,
      instance_name: instance.name,
      processed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Webhook Uazapi] Unexpected error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Configuração para aceitar payloads maiores (QR Codes podem ser grandes)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

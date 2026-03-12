// =====================================================
// EDGE FUNCTION - UAZAPI QR CODE (BASEADA NA REFERÊNCIA FUNCIONAL)
// =====================================================
// Implementação baseada em projeto anterior comprovadamente funcional

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

// Configuração Uazapi
const UAZAPI_BASE_URL = 'https://lovoo.uazapi.com';
const ADMIN_TOKEN = 'Qz8m6fc3Gcfc0jKAdZbCPaHRYa2nCGpOapTNJT5J4C2km6GdQB';

interface ConnectQRCodeRequest {
  temp_instance_id: string;
  phone?: string; // Opcional - se não informar, gera QR Code
}

interface UazapiConnectResponse {
  qrcode?: string;
  paircode?: string;
  status?: string;
  connected?: boolean;
  loggedIn?: boolean;
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
    const { temp_instance_id, phone }: ConnectQRCodeRequest = req.body;

    if (!temp_instance_id) {
      return res.status(400).json({
        success: false,
        error: 'temp_instance_id é obrigatório'
      });
    }

    console.log('[Connect QRCode] Iniciando para:', {
      temp_instance_id,
      hasPhone: !!phone,
      timestamp: new Date().toISOString()
    });

    // =====================================================
    // 1. BUSCAR INSTÂNCIA NO BANCO (BASEADO NA REFERÊNCIA)
    // =====================================================
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_temp_instances')
      .select('uazapi_token, uazapi_instance_id, instance_name, company_id')
      .eq('temp_instance_id', temp_instance_id)
      .single();

    if (instanceError || !instance) {
      console.error('[Connect QRCode] Instância não encontrada:', instanceError);
      return res.status(404).json({
        success: false,
        error: 'Instância temporária não encontrada'
      });
    }

    if (!instance.uazapi_token) {
      console.error('[Connect QRCode] Token da instância não encontrado');
      return res.status(400).json({
        success: false,
        error: 'Token da instância não encontrado'
      });
    }

    console.log('[Connect QRCode] Instância encontrada:', {
      uazapi_instance_id: instance.uazapi_instance_id,
      instance_name: instance.instance_name,
      tokenPrefix: instance.uazapi_token.substring(0, 8) + '...'
    });

    // =====================================================
    // 2. CHAMADA PARA UAZAPI - HEADERS CORRETOS (REFERÊNCIA)
    // =====================================================
    const connectStartTime = Date.now();
    
    const connectResponse = await fetch(`${UAZAPI_BASE_URL}/instance/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instance.uazapi_token,  // ✅ TOKEN DA INSTÂNCIA (NÃO ADMIN)
      },
      body: JSON.stringify({
        phone: phone || undefined,  // ✅ UNDEFINED GERA QR CODE
      }),
    });

    const connectDuration = Date.now() - connectStartTime;

    console.log('[Connect QRCode] Resposta Uazapi:', {
      status: connectResponse.status,
      statusText: connectResponse.statusText,
      duration_ms: connectDuration,
      headers: Object.fromEntries(connectResponse.headers.entries())
    });

    if (!connectResponse.ok) {
      const errorText = await connectResponse.text();
      console.error('[Connect QRCode] Erro Uazapi:', {
        status: connectResponse.status,
        error: errorText
      });
      
      return res.status(500).json({
        success: false,
        error: `Erro Uazapi: ${connectResponse.status} - ${errorText}`,
        debug_info: {
          uazapi_status: connectResponse.status,
          duration_ms: connectDuration
        }
      });
    }

    // =====================================================
    // 3. PROCESSAR RESPOSTA (BASEADO NA REFERÊNCIA)
    // =====================================================
    const result: UazapiConnectResponse = await connectResponse.json();
    
    console.log('[Connect QRCode] Resultado Uazapi:', {
      hasQrcode: !!result.qrcode,
      hasPaircode: !!result.paircode,
      status: result.status,
      connected: result.connected,
      loggedIn: result.loggedIn,
      qrcodeLength: result.qrcode?.length || 0
    });

    // =====================================================
    // 4. ATUALIZAR BANCO (BASEADO NA REFERÊNCIA)
    // =====================================================
    const { error: updateError } = await supabase
      .from('whatsapp_temp_instances')
      .update({
        status: 'connecting',
        qrcode: result.qrcode || null,
        paircode: result.paircode || null,
        updated_at: new Date().toISOString(),
      })
      .eq('temp_instance_id', temp_instance_id);

    if (updateError) {
      console.error('[Connect QRCode] Erro ao atualizar banco:', updateError);
      // Não falhar por erro de banco, QR Code foi gerado
    }

    // =====================================================
    // 5. RESPOSTA FINAL (BASEADO NA REFERÊNCIA)
    // =====================================================
    const response = {
      success: true,
      qrCode: result.qrcode || null,
      pairCode: result.paircode || null,
      status: result.status || 'connecting',
      message: phone 
        ? 'Código de pareamento gerado. Use no WhatsApp do celular.' 
        : 'QR Code gerado. Escaneie com o WhatsApp do celular.',
      connectionMethod: phone ? 'paircode' : 'qrcode',
      debug_info: {
        temp_instance_id,
        uazapi_instance_id: instance.uazapi_instance_id,
        duration_ms: connectDuration,
        approach: 'reference_based_functional',
        headers_used: 'token_instance_not_admin',
        body_sent: phone ? { phone } : { phone: undefined }
      }
    };

    console.log('[Connect QRCode] Sucesso:', {
      hasQrCode: !!response.qrCode,
      connectionMethod: response.connectionMethod,
      duration_ms: connectDuration
    });

    return res.status(200).json(response);

  } catch (error) {
    console.error('[Connect QRCode] Erro inesperado:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Unknown error',
      debug_info: {
        approach: 'reference_based_functional',
        error_type: error instanceof Error ? error.constructor.name : typeof error
      }
    });
  }
}

// Configuração para aceitar payloads maiores
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

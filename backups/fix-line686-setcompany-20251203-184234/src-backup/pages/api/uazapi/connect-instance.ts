// =====================================================
// EDGE FUNCTION - UAZAPI /instance/connect (WEBHOOK 100%)
// =====================================================
// Chama /instance/connect sem limitação de timeout do PostgreSQL

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabase';

// Tipos para a requisição
interface ConnectInstanceRequest {
  tempInstanceId: string;
  instanceToken: string;
  uazapiInstanceId: string;
}

// Função para extrair QR Code de múltiplos campos
function extractQRCode(data: any): string | null {
  return data.qrcode || 
         data.instance?.qrcode || 
         data.data?.qrcode || 
         data.data?.base64 || 
         data.base64 || 
         null;
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

  const startTime = Date.now();
  
  try {
    console.log('[Connect Instance] Received request:', {
      body: req.body,
      timestamp: new Date().toISOString()
    });

    const { tempInstanceId, instanceToken, uazapiInstanceId }: ConnectInstanceRequest = req.body;

    // Validar parâmetros
    if (!tempInstanceId || !instanceToken || !uazapiInstanceId) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetros obrigatórios: tempInstanceId, instanceToken, uazapiInstanceId'
      });
    }

    // Configurar timeout de 180 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log('[Connect Instance] Timeout após 180s para:', tempInstanceId);
    }, 180000); // 180 segundos

    try {
      console.log('[Connect Instance] Chamando /instance/connect para:', {
        tempInstanceId,
        uazapiInstanceId,
        tokenPrefix: instanceToken.substring(0, 8) + '...'
      });

      // Chamar /instance/connect conforme especificação
      const response = await fetch("https://lovoo.uazapi.com/instance/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "token": instanceToken, // Token da instância
          "User-Agent": "LovoCRM-EdgeFunction/1.0"
        },
        body: JSON.stringify({}), // Body vazio conforme especificação
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;
      console.log('[Connect Instance] Resposta recebida:', {
        status: response.status,
        duration: `${duration}ms`,
        tempInstanceId
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[Connect Instance] Dados da resposta:', {
          hasQrcode: !!(data.qrcode || data.instance?.qrcode || data.data?.qrcode),
          status: data.status,
          keys: Object.keys(data),
          tempInstanceId
        });

        // Buscar QR Code nos múltiplos campos
        const qrcode = extractQRCode(data);

        if (qrcode && qrcode.length > 0) {
          console.log('[Connect Instance] QR Code encontrado, atualizando banco:', {
            qrcodeLength: qrcode.length,
            tempInstanceId
          });

          // Atualizar instância temporária com QR Code
          const { error: updateError } = await supabase.rpc('update_temp_instance_qrcode', {
            p_temp_instance_id: tempInstanceId,
            p_qrcode: qrcode,
            p_status: 'ready'
          });

          if (updateError) {
            console.error('[Connect Instance] Erro ao atualizar banco:', updateError);
            return res.status(500).json({
              success: false,
              error: 'Erro ao salvar QR Code no banco',
              details: updateError.message
            });
          }

          return res.status(200).json({
            success: true,
            qrcode,
            status: 'ready',
            source: 'immediate_connect_response',
            duration: `${duration}ms`,
            tempInstanceId
          });
        } else {
          console.log('[Connect Instance] QR Code não encontrado na resposta, aguardando webhook:', {
            responseData: data,
            tempInstanceId
          });

          // Atualizar status para aguardar webhook
          await supabase.rpc('update_temp_instance_status', {
            p_temp_instance_id: tempInstanceId,
            p_status: 'connecting',
            p_message: 'QR Code será enviado via webhook'
          });

          return res.status(200).json({
            success: true,
            message: 'QR Code será gerado via webhook',
            status: 'connecting',
            source: 'webhook_pending',
            duration: `${duration}ms`,
            tempInstanceId
          });
        }
      } else {
        const errorText = await response.text();
        console.error('[Connect Instance] Erro HTTP:', {
          status: response.status,
          error: errorText,
          tempInstanceId
        });

        // Atualizar status para erro
        await supabase.rpc('update_temp_instance_status', {
          p_temp_instance_id: tempInstanceId,
          p_status: 'error',
          p_message: `Erro HTTP ${response.status}: ${errorText}`
        });

        return res.status(200).json({
          success: true,
          message: 'Erro no connect, aguardando webhook como fallback',
          status: 'connecting',
          source: 'webhook_fallback',
          error: `HTTP ${response.status}`,
          duration: `${duration}ms`,
          tempInstanceId
        });
      }

    } catch (fetchError) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      console.error('[Connect Instance] Erro na requisição:', {
        error: fetchError,
        duration: `${duration}ms`,
        tempInstanceId
      });

      // Atualizar para aguardar webhook
      await supabase.rpc('update_temp_instance_status', {
        p_temp_instance_id: tempInstanceId,
        p_status: 'connecting',
        p_message: 'Timeout no connect, aguardando webhook'
      });

      return res.status(200).json({
        success: true,
        message: 'Timeout no connect, aguardando webhook',
        status: 'connecting',
        source: 'webhook_fallback_timeout',
        duration: `${duration}ms`,
        tempInstanceId
      });
    }

  } catch (error) {
    console.error('[Connect Instance] Erro geral:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Configuração para aceitar payloads e timeout maior
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    responseLimit: false,
  },
};

// =====================================================
// EDGE FUNCTION: WHATSAPP LIFE GET QR CODE
// =====================================================
// Função isolada para obter QR Code das instâncias (Anti-CORS)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =====================================================
// CONFIGURAÇÕES SEGURAS
// =====================================================
const UAZAPI_CONFIG = {
  BASE_URL: Deno.env.get('UAZAPI_BASE_URL') || 'https://lovoo.uazapi.com',
  TIMEOUT: 30000,
};

// =====================================================
// TIPOS
// =====================================================
interface GetQRCodeRequest {
  instance_id: string;
}

interface UazapiQRResponse {
  success: boolean;
  data?: {
    qrcode: string;
    paircode?: string;
  };
  error?: string;
}

// =====================================================
// FUNÇÃO PRINCIPAL
// =====================================================
serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verificar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header missing');
    }

    // Inicializar Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse do body
    const { instance_id }: GetQRCodeRequest = await req.json();

    if (!instance_id) {
      throw new Error('instance_id é obrigatório');
    }

    console.log(`[WhatsApp Life] Obtendo QR Code para instância: ${instance_id}`);

    // 1. Buscar instância no banco
    const { data: instance, error: instanceError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, provider_instance_id, provider_token, status, qr_code, qr_expires_at')
      .eq('id', instance_id)
      .single();

    if (instanceError || !instance) {
      throw new Error('Instância não encontrada');
    }

    // 2. Verificar se a instância está no status correto
    if (instance.status === 'connected') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Instância já está conectada',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!instance.provider_instance_id || !instance.provider_token) {
      throw new Error('Instância não configurada no provider');
    }

    // 3. Verificar se QR Code ainda é válido (5 minutos)
    const now = new Date();
    const expiresAt = instance.qr_expires_at ? new Date(instance.qr_expires_at) : null;
    
    if (instance.qr_code && expiresAt && expiresAt > now) {
      console.log(`[WhatsApp Life] QR Code ainda válido para instância: ${instance_id}`);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            qrcode: instance.qr_code,
            expires_at: instance.qr_expires_at,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 4. Obter novo QR Code do Uazapi
    const qrResponse = await fetch(
      `${UAZAPI_CONFIG.BASE_URL}/instance/${instance.provider_instance_id}/qrcode`,
      {
        method: 'GET',
        headers: {
          'token': instance.provider_token,
        },
        signal: AbortSignal.timeout(UAZAPI_CONFIG.TIMEOUT),
      }
    );

    const qrData: UazapiQRResponse = await qrResponse.json();

    if (!qrResponse.ok || !qrData.success || !qrData.data?.qrcode) {
      throw new Error(`Erro ao obter QR Code: ${qrData.error || 'QR Code não disponível'}`);
    }

    // 5. Atualizar QR Code no banco
    const expirationTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos
    
    await supabase.rpc('update_whatsapp_life_instance_status', {
      p_instance_id: instance_id,
      p_status: 'qr_pending',
      p_qr_code: qrData.data.qrcode,
    });

    console.log(`[WhatsApp Life] QR Code atualizado para instância: ${instance_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          qrcode: qrData.data.qrcode,
          paircode: qrData.data.paircode,
          expires_at: expirationTime.toISOString(),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[WhatsApp Life] Erro ao obter QR Code:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro interno do servidor',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// =====================================================
// EDGE FUNCTION: WHATSAPP LIFE CREATE INSTANCE
// =====================================================
// Função isolada para criar instâncias Uazapi (Anti-CORS)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =====================================================
// CONFIGURAÇÕES SEGURAS (SERVIDOR APENAS)
// =====================================================
const UAZAPI_CONFIG = {
  BASE_URL: Deno.env.get('UAZAPI_BASE_URL') || 'https://lovoo.uazapi.com',
  ADMIN_TOKEN: Deno.env.get('UAZAPI_ADMIN_TOKEN'),
  TIMEOUT: 30000,
};

// =====================================================
// TIPOS
// =====================================================
interface CreateInstanceRequest {
  company_id: string;
  instance_name: string;
}

interface UazapiCreateResponse {
  success: boolean;
  data?: {
    id: string;
    name: string;
    token: string;
    status: string;
  };
  error?: string;
}

// =====================================================
// FUNÇÃO PRINCIPAL
// =====================================================
serve(async (req: Request) => {
  // CORS Headers
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
    const { company_id, instance_name }: CreateInstanceRequest = await req.json();

    if (!company_id || !instance_name) {
      throw new Error('company_id e instance_name são obrigatórios');
    }

    console.log(`[WhatsApp Life] Criando instância: ${instance_name} para empresa: ${company_id}`);

    // 1. Verificar limites do plano
    const { data: planCheck, error: planError } = await supabase.rpc(
      'check_whatsapp_life_plan_limit',
      { p_company_id: company_id }
    );

    if (planError || !planCheck?.canAdd) {
      return new Response(
        JSON.stringify({
          success: false,
          error: planCheck?.error || 'Limite de instâncias atingido',
          planInfo: planCheck,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Criar instância no banco primeiro
    const { data: dbResult, error: dbError } = await supabase.rpc(
      'create_whatsapp_life_instance',
      {
        p_company_id: company_id,
        p_instance_name: instance_name,
      }
    );

    if (dbError || !dbResult?.success) {
      throw new Error(dbResult?.error || 'Erro ao criar instância no banco');
    }

    const instanceId = dbResult.instanceId;

    // 3. Criar instância no Uazapi
    const uazapiName = `${company_id}_${instance_name}_${instanceId.slice(-8)}`;
    
    const uazapiResponse = await fetch(`${UAZAPI_CONFIG.BASE_URL}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'admintoken': UAZAPI_CONFIG.ADMIN_TOKEN!,
      },
      body: JSON.stringify({ name: uazapiName }),
      signal: AbortSignal.timeout(UAZAPI_CONFIG.TIMEOUT),
    });

    const uazapiData: UazapiCreateResponse = await uazapiResponse.json();

    if (!uazapiResponse.ok || !uazapiData.success || !uazapiData.data) {
      // Remover instância do banco se falhou no Uazapi
      await supabase.rpc('delete_whatsapp_life_instance', {
        p_instance_id: instanceId,
      });

      throw new Error(`Erro no Uazapi: ${uazapiData.error || 'Resposta inválida'}`);
    }

    // 4. Atualizar instância com dados do Uazapi
    await supabase.rpc('update_whatsapp_life_instance_status', {
      p_instance_id: instanceId,
      p_status: 'qr_pending',
      p_provider_instance_id: uazapiData.data.id,
      p_provider_token: uazapiData.data.token,
    });

    // 5. Buscar instância atualizada
    const { data: finalInstance } = await supabase
      .from('whatsapp_life_instances')
      .select('*')
      .eq('id', instanceId)
      .single();

    console.log(`[WhatsApp Life] Instância criada com sucesso: ${instanceId}`);

    return new Response(
      JSON.stringify({
        success: true,
        instanceId,
        message: 'Instância criada com sucesso',
        data: finalInstance,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[WhatsApp Life] Erro ao criar instância:', error);
    
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

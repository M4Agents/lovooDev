// =====================================================
// EDGE FUNCTION - WEBHOOK UAZAPI REAL FORMAT
// =====================================================
// Endpoint HTTP PÚBLICO para receber webhooks da Uazapi no formato real
// URL: https://[project].supabase.co/functions/v1/webhook-uazapi

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// =====================================================
// CONFIGURAÇÕES
// =====================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// =====================================================
// FUNÇÃO PRINCIPAL
// =====================================================

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validar método
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Inicializar cliente Supabase com service role key (bypass RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Ler payload
    let payload: any
    try {
      payload = await req.json()
    } catch (error) {
      console.error('Error parsing JSON:', error)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Log do webhook recebido
    console.log('Webhook received:', {
      event: payload.event,
      instance_id: payload.instance_id,
      timestamp: new Date().toISOString()
    })

    // Processar webhook via RPC com formato real
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    })

    if (error) {
      console.error('Error processing webhook:', error)
      return new Response(
        JSON.stringify({ 
          error: 'Error processing webhook', 
          details: error.message 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Log do resultado
    console.log('Webhook processed:', data)

    // Resposta de sucesso
    return new Response(
      JSON.stringify(data),
      { 
        status: data.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

/* =====================================================
 * DOCUMENTAÇÃO DA EDGE FUNCTION
 * =====================================================
 * 
 * Esta Edge Function recebe webhooks da Uazapi e processa:
 * 
 * 1. EVENTOS SUPORTADOS:
 *    - messages: Novas mensagens recebidas
 *    - messages_update: Atualizações de status
 *    - connection: Status da instância
 * 
 * 2. VALIDAÇÕES:
 *    - Método POST obrigatório
 *    - JSON válido obrigatório
 *    - Instância deve existir no sistema
 *    - Apenas mensagens recebidas (fromMe: false)
 * 
 * 3. PROCESSAMENTO:
 *    - Auto-cadastro de contatos
 *    - Criação/atualização de conversas
 *    - Salvamento de mensagens
 *    - Log completo para auditoria
 * 
 * 4. SEGURANÇA:
 *    - Prevenção de loops (ignora wasSentByApi)
 *    - Validação de instância
 *    - Rate limiting via Supabase
 *    - Logs detalhados
 * 
 * 5. URL DE CONFIGURAÇÃO:
 *    https://[project].supabase.co/functions/v1/webhook-uazapi
 * 
 * ===================================================== */

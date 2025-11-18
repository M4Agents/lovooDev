// =====================================================
// WEBHOOK SIMPLES - UAZAPI (SEM AUTENTICAÇÃO)
// =====================================================
// Endpoint HTTP PÚBLICO para receber webhooks da Uazapi

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Log da requisição recebida
  console.log('=== WEBHOOK RECEBIDO ===')
  console.log('Method:', req.method)
  console.log('URL:', req.url)
  console.log('Headers:', Object.fromEntries(req.headers.entries()))

  try {
    // Só aceita POST
    if (req.method !== 'POST') {
      console.log('❌ Método não permitido:', req.method)
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Ler payload
    const payload = await req.json()
    console.log('📦 Payload recebido:', JSON.stringify(payload, null, 2))

    // Inicializar Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Processar via RPC
    console.log('🔄 Processando via RPC...')
    const { data, error } = await supabase.rpc('process_uazapi_webhook', {
      p_payload: payload
    })

    if (error) {
      console.error('❌ Erro no RPC:', error)
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Error processing webhook', 
          details: error.message 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('✅ Processado com sucesso:', data)

    // Resposta de sucesso
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook processed successfully',
        data: data
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('💥 Erro inesperado:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
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

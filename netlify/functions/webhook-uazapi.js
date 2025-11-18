// =====================================================
// NETLIFY FUNCTION - WEBHOOK UAZAPI
// =====================================================
// Função pública que recebe webhooks da Uazapi e processa no Supabase

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: 'OK'
    };
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('=== WEBHOOK NETLIFY RECEBIDO ===');
    console.log('Body:', event.body);

    // Parse payload
    const payload = JSON.parse(event.body);
    console.log('Payload parsed:', JSON.stringify(payload, null, 2));

    // Initialize Supabase with service role key
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Process via RPC
    console.log('Processando via RPC...');
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    });

    if (error) {
      console.error('Erro no RPC:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false,
          error: 'Error processing webhook', 
          details: error.message 
        })
      };
    }

    console.log('Processado com sucesso:', data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Webhook processed successfully via Netlify',
        data: data
      })
    };

  } catch (error) {
    console.error('Erro inesperado:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Internal server error', 
        details: error.message 
      })
    };
  }
};

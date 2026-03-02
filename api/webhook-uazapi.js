// Webhook Ultra-Simples para Uazapi - BASEADO NO PADRÃO webhook-lead.js QUE FUNCIONA 100%
// Endpoint: /api/webhook-uazapi
// Método: POST com payload Uazapi
// Padrão EXATO do webhook-lead que funciona perfeitamente

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK UAZAPI INICIADO - BASEADO NO PADRÃO WEBHOOK-LEAD QUE FUNCIONA');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);

  // Set CORS headers (EXATO do webhook-lead que funciona)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - retornando 200');
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    console.log('📥 PAYLOAD UAZAPI RECEBIDO:', req.body);
    console.log('📊 PAYLOAD DETALHADO:');
    console.log('- Tipo do payload:', typeof req.body);
    console.log('- Keys do payload:', Object.keys(req.body || {}));
    console.log('- Valores do payload:', JSON.stringify(req.body, null, 2));
    
    const payload = req.body;
    
    // Validação básica (similar ao webhook-lead)
    if (!payload) {
      console.error('Missing payload:', req.body);
      res.status(400).json({ error: 'Payload is required' });
      return;
    }
    
    console.log('Uazapi webhook received data:', payload);
    
    // Process data using SAME pattern as webhook-lead (RPC + anon key)
    const result = await processUazapiMessage(payload);
    
    if (result.success) {
      console.log('SUCCESS: Uazapi message processed:', result.message_id || 'processed');
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id || 'processed',
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('INFO: Uazapi message not processed (filtered or error):', result.error);
      // Sempre responder 200 para Uazapi (como N8N)
      res.status(200).json({ 
        success: false, 
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in Uazapi webhook:', error);
    // Sempre responder 200 para Uazapi (como N8N)
    res.status(200).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function processUazapiMessage(payload) {
  try {
    // Use EXACT same Supabase connection as webhook-lead (that works 100%)
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    // Using SAME anon key that works in webhook-lead
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔑 USANDO MESMA CHAVE ANON + RPC DO WEBHOOK-LEAD QUE FUNCIONA');
    console.log('Processando webhook Uazapi payload:', payload.EventType);
    
    // Use SAME RPC pattern as webhook-lead (that works 100%)
    console.log('📞 CHAMANDO RPC process_uazapi_webhook_real...');
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    });
    
    if (error) {
      console.error('Erro no RPC:', error);
      return { success: false, error: error.message };
    }
    
    if (data && data.success) {
      console.log('✅ RPC processou com sucesso:', data);
      return { 
        success: true, 
        message_id: data.message_id || 'processed',
        data: data
      };
    } else {
      console.log('⚠️ RPC retornou sem sucesso (filtrado):', data);
      return { 
        success: false, 
        error: data?.error || 'Message filtered or not processed',
        data: data
      };
    }
    
  } catch (error) {
    console.error('Exception in processUazapiMessage:', error);
    return { success: false, error: error.message };
  }
}

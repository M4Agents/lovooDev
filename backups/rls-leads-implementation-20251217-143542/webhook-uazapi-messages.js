// Webhook Uazapi Messages - Vercel Functions
// Baseado no padrão /api/webhook-lead.js que funciona 100%
// Endpoint: /api/webhook-uazapi-messages
// Método: POST com payload real da Uazapi

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK UAZAPI MESSAGES - VERCEL FUNCTIONS');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);

  // Set CORS headers (mesmo padrão que funciona)
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
    res.status(405).json({ 
      success: false, 
      error: 'Método não permitido. Use POST.' 
    });
    return;
  }
  
  try {
    console.log('📥 PAYLOAD UAZAPI MESSAGES RECEBIDO:');
    console.log(JSON.stringify(req.body, null, 2));
    
    // Processar via função que já funciona
    const result = await processUazapiMessages(req.body);
    
    if (result.success) {
      console.log('✅ SUCCESS: Mensagem processada:', result.message_id);
      res.status(200).json({ 
        success: true, 
        message_id: result.message_id,
        message: 'Webhook processado com sucesso!' 
      });
    } else {
      console.error('❌ ERROR: Falha ao processar:', result.error);
      res.status(200).json({ 
        success: false, 
        error: result.error,
        message: 'Erro processado, mas webhook funcionou'
      });
    }
    
  } catch (error) {
    console.error('❌ ERROR: Exception in webhook:', error);
    res.status(200).json({ 
      success: false, 
      error: 'Erro interno processado',
      message: 'Webhook recebido mas com erro interno'
    });
  }
}

async function processUazapiMessages(payload) {
  try {
    console.log('🔧 PROCESSANDO PAYLOAD UAZAPI MESSAGES');
    
    // Use the Supabase client (mesmo padrão webhook-lead que funciona)
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    // Usando chave anon (mesmo padrão webhook-lead que funciona)
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔑 USANDO CHAVE ANON - MESMO PADRÃO WEBHOOK-LEAD');
    
    // Usar RPC que já funciona para processar payload real
    console.log('📞 CHAMANDO RPC process_uazapi_webhook_real...');
    const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
      p_payload: payload
    });
    
    if (error) {
      console.error('❌ Erro no RPC:', error);
      return { success: false, error: 'RPC Error: ' + error.message };
    }
    
    if (data && data.success) {
      console.log('✅ RPC processou com sucesso:', data);
      return { 
        success: true, 
        message_id: data.message_id || 'processed',
        data: data
      };
    } else {
      console.log('⚠️ RPC retornou sem sucesso:', data);
      return { 
        success: false, 
        error: data?.error || 'RPC processing failed',
        data: data
      };
    }
    
  } catch (error) {
    console.error('❌ Exception in processUazapiMessages:', error);
    return { success: false, error: error.message };
  }
}

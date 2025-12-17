// Webhook Ultra-Simples Uazapi - Estilo N8N que funciona 100%
// Baseado exatamente no modelo N8N: recebe qualquer coisa e responde 200

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK UAZAPI ULTRA-SIMPLES - ESTILO N8N');
  console.log('Timestamp:', new Date().toISOString());
  
  // CORS headers básicos
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // OPTIONS sempre responde 200
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    console.log('📥 PAYLOAD RECEBIDO (QUALQUER MÉTODO):');
    console.log('Method:', req.method);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    // Se tem payload, tenta processar
    if (req.body && req.body.EventType === 'messages') {
      console.log('📞 Tentando processar via RPC...');
      
      try {
        // Importa Supabase dinamicamente
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          'https://etzdsywunlpbgxkphuil.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
        );
        
        const { data, error } = await supabase.rpc('process_uazapi_webhook_real', {
          p_payload: req.body
        });
        
        if (data && data.success) {
          console.log('✅ RPC processou com sucesso:', data);
        } else {
          console.log('⚠️ RPC não processou:', data?.error || 'Sem erro específico');
        }
      } catch (rpcError) {
        console.error('❌ Erro no RPC:', rpcError);
      }
    }
    
    // SEMPRE responde 200 (como N8N)
    res.status(200).json({
      success: true,
      message: 'Webhook recebido com sucesso!',
      timestamp: new Date().toISOString(),
      method: req.method,
      hasBody: !!req.body
    });
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
    
    // Mesmo com erro, responde 200 (como N8N)
    res.status(200).json({
      success: false,
      message: 'Webhook recebido mas com erro',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

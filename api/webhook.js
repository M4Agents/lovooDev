// Webhook endpoint para conversões
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const apiUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
  
  try {
    let data;
    
    // Aceitar tanto GET quanto POST
    if (req.method === 'GET') {
      data = req.query;
    } else if (req.method === 'POST') {
      data = req.body;
    } else {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    const { tracking_code, session_id, ...formData } = data;
    
    if (!tracking_code) {
      return res.status(400).json({ 
        success: false, 
        error: 'tracking_code is required' 
      });
    }
    
    console.log('Webhook received:', { tracking_code, session_id, formData });
    
    // Chamar função RPC para processar conversão
    const response = await fetch(`${apiUrl}/rest/v1/rpc/process_conversion_webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
      },
      body: JSON.stringify({
        tracking_code_param: tracking_code,
        form_data_param: formData,
        visitor_session_id_param: session_id || null
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase error:', response.status, errorText);
      return res.status(500).json({ 
        success: false, 
        error: 'Database error',
        details: errorText
      });
    }
    
    const result = await response.json();
    console.log('Conversion processed:', result);
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message
    });
  }
}

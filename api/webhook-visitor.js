// Webhook para receber dados de visitantes via POST (sem CORS)
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    const { tracking_code, session_id, user_agent, device_type, screen_resolution, referrer } = req.body;
    
    if (!tracking_code) {
      res.status(400).json({ error: 'tracking_code is required' });
      return;
    }
    
    console.log('Webhook received visitor data:', { tracking_code, session_id, device_type });
    
    // Process data using direct SQL execution
    const result = await createVisitorDirectSQL({
      tracking_code,
      session_id: session_id || `webhook_${Date.now()}`,
      user_agent: user_agent || 'Webhook Tracking',
      device_type: device_type || 'unknown',
      screen_resolution: screen_resolution || '1920x1080',
      referrer: referrer || 'direct'
    });
    
    if (result.success) {
      console.log('SUCCESS: Visitor created via webhook:', result.visitor_id);
      res.status(200).json({ success: true, visitor_id: result.visitor_id });
    } else {
      console.error('ERROR: Webhook visitor creation failed:', result.error);
      res.status(500).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function createVisitorDirectSQL(params) {
  try {
    // Use the Supabase client with direct SQL execution
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Execute the function directly
    const { data, error } = await supabase.rpc('public_create_visitor', {
      tracking_code_text: params.tracking_code,
      session_id_text: params.session_id,
      user_agent_text: params.user_agent,
      device_type_text: params.device_type,
      screen_resolution_text: params.screen_resolution,
      referrer_text: params.referrer
    });
    
    if (error) {
      console.error('Supabase RPC error:', error);
      return { success: false, error: error.message };
    }
    
    if (data && data.success) {
      return { success: true, visitor_id: data.visitor_id };
    } else {
      return { success: false, error: 'Function returned false' };
    }
    
  } catch (error) {
    console.error('Exception in createVisitorDirectSQL:', error);
    return { success: false, error: error.message };
  }
}

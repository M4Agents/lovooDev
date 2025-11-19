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
    console.log('Webhook received raw body:', req.body);
    console.log('Webhook received headers:', req.headers);
    
    const { tracking_code, session_id, visitor_id, user_agent, device_type, screen_resolution, referrer, timezone, language } = req.body;
    
    if (!tracking_code) {
      console.error('Missing tracking_code in payload:', req.body);
      res.status(400).json({ error: 'tracking_code is required' });
      return;
    }
    
    console.log('Webhook received visitor data:', { tracking_code, session_id, device_type, user_agent });
    
    // Process data using direct SQL execution
    const result = await createVisitorDirectSQL({
      tracking_code,
      session_id: session_id || `webhook_${Date.now()}`,
      visitor_id: visitor_id || null,
      user_agent: user_agent || 'Webhook Tracking',
      device_type: device_type || 'unknown',
      screen_resolution: screen_resolution || '1920x1080',
      referrer: referrer || 'direct',
      timezone: timezone || null,
      language: language || null
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
    
    // Generate UUID for session_id if not valid
    let sessionId = params.session_id;
    if (!sessionId || !isValidUUID(sessionId)) {
      sessionId = generateUUID();
    }
    
    // Execute the enhanced function with remarketing data
    const { data, error } = await supabase.rpc('public_create_visitor_enhanced', {
      tracking_code_text: params.tracking_code,
      session_id_text: sessionId,
      visitor_id_text: params.visitor_id,
      user_agent_text: params.user_agent,
      device_type_text: params.device_type,
      screen_resolution_text: params.screen_resolution,
      referrer_text: params.referrer,
      timezone_text: params.timezone,
      language_text: params.language
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

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

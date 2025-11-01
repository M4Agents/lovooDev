// Webhook para receber dados de conversão de formulários
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
    console.log('Conversion webhook received:', req.body);
    console.log('Conversion webhook headers:', req.headers);
    
    const { 
      tracking_code, 
      visitor_id, 
      session_id,
      form_data,
      page_url,
      user_agent,
      device_type,
      referrer
    } = req.body;
    
    if (!tracking_code) {
      console.error('Missing tracking_code in conversion payload:', req.body);
      res.status(400).json({ error: 'tracking_code is required' });
      return;
    }
    
    if (!form_data) {
      console.error('Missing form_data in conversion payload:', req.body);
      res.status(400).json({ error: 'form_data is required' });
      return;
    }
    
    console.log('Processing conversion:', { 
      tracking_code, 
      visitor_id, 
      form_data: Object.keys(form_data) 
    });
    
    // Process conversion using direct SQL execution
    const result = await createConversionDirectSQL({
      tracking_code,
      visitor_id: visitor_id || null,
      session_id: session_id || null,
      form_data,
      page_url: page_url || null,
      user_agent: user_agent || 'Webhook Conversion',
      device_type: device_type || 'unknown',
      referrer: referrer || 'direct'
    });
    
    if (result.success) {
      console.log('SUCCESS: Conversion created via webhook:', result.conversion_id);
      res.status(200).json({ 
        success: true, 
        conversion_id: result.conversion_id,
        message: 'Conversion registered successfully'
      });
    } else {
      console.error('ERROR: Webhook conversion creation failed:', result.error);
      res.status(500).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in conversion webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function createConversionDirectSQL(params) {
  try {
    // Use the Supabase client with direct SQL execution
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find landing page by tracking code
    const { data: landingPage, error: landingError } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('tracking_code', params.tracking_code)
      .single();
    
    if (landingError || !landingPage) {
      console.error('Landing page not found for tracking code:', params.tracking_code);
      return { success: false, error: 'Invalid tracking code' };
    }
    
    // Generate UUID for conversion if not valid
    let sessionId = params.session_id;
    if (!sessionId || !isValidUUID(sessionId)) {
      sessionId = generateUUID();
    }
    
    let visitorId = params.visitor_id;
    if (!visitorId || !isValidUUID(visitorId)) {
      visitorId = null; // Allow null visitor_id for anonymous conversions
    }
    
    // Create conversion record
    const conversionData = {
      id: generateUUID(),
      landing_page_id: landingPage.id,
      visitor_id: visitorId,
      session_id: sessionId,
      form_data: params.form_data,
      page_url: params.page_url,
      behavior_summary: {
        user_agent: params.user_agent,
        device_type: params.device_type,
        referrer: params.referrer,
        converted_at: new Date().toISOString()
      },
      converted_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('conversions')
      .insert([conversionData])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase conversion insert error:', error);
      return { success: false, error: error.message };
    }
    
    console.log('Conversion created successfully:', data.id);
    return { success: true, conversion_id: data.id };
    
  } catch (error) {
    console.error('Exception in createConversionDirectSQL:', error);
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

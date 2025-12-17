// Endpoint para coletar dados via GET (sem CORS)
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const { query } = req;
  
  // Process data in background
  if (query.tracking_code) {
    processVisitorData(query).catch(err => 
      console.error('Background processing error:', err)
    );
  }
  
  // Return success response
  res.status(200).json({ success: true, message: 'Data received' });
}

async function processVisitorData(params) {
  const apiUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
  const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
  
  try {
    console.log('Processing visitor data via server-side:', params);
    
    // Use the function that we know works
    const response = await fetch(`${apiUrl}/rest/v1/rpc/public_create_visitor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        tracking_code_text: params.tracking_code,
        session_id_text: params.session_id || `server_${Date.now()}`,
        user_agent_text: params.user_agent || 'Server-Side Tracking',
        device_type_text: params.device_type || 'unknown',
        screen_resolution_text: params.screen_resolution || '1920x1080',
        referrer_text: params.referrer || 'direct'
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('SUCCESS: Visitor created via server-side public_create_visitor:', result);
      return result;
    } else {
      const error = await response.text();
      console.error('ERROR: Server-side visitor creation failed:', response.status, error);
      
      // Fallback: Try direct table insert with service role
      return await tryDirectInsert(params, apiUrl);
    }
    
  } catch (error) {
    console.error('ERROR: Exception in server-side processing:', error);
    // Fallback: Try direct insert
    return await tryDirectInsert(params, apiUrl);
  }
}

async function tryDirectInsert(params, apiUrl) {
  try {
    console.log('Attempting direct table insert as fallback...');
    
    // Get service role key for direct insert
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.error('No service role key available for direct insert');
      return null;
    }
    
    // First get landing page ID
    const pageResponse = await fetch(`${apiUrl}/rest/v1/landing_pages?tracking_code=eq.${params.tracking_code}&select=id`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    
    if (!pageResponse.ok) {
      console.error('Failed to get landing page:', await pageResponse.text());
      return null;
    }
    
    const pages = await pageResponse.json();
    if (pages.length === 0) {
      console.error('Landing page not found for tracking code:', params.tracking_code);
      return null;
    }
    
    const landingPageId = pages[0].id;
    
    // Direct insert into visitors table
    const insertResponse = await fetch(`${apiUrl}/rest/v1/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        landing_page_id: landingPageId,
        session_id: params.session_id || `server_${Date.now()}`,
        user_agent: params.user_agent || 'Server-Side Tracking',
        device_type: params.device_type || 'unknown',
        screen_resolution: params.screen_resolution || '1920x1080',
        referrer: params.referrer || 'direct',
        created_at: new Date().toISOString()
      })
    });
    
    if (insertResponse.ok) {
      const result = await insertResponse.json();
      console.log('SUCCESS: Direct insert worked:', result[0]?.id);
      return result;
    } else {
      const error = await insertResponse.text();
      console.error('ERROR: Direct insert failed:', insertResponse.status, error);
      return null;
    }
    
  } catch (error) {
    console.error('ERROR: Exception in direct insert:', error);
    return null;
  }
}

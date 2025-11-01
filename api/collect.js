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
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
  
  try {
    console.log('Processing visitor data:', params);
    
    // First, get landing page ID from tracking code
    let landingPageId = null;
    
    if (params.tracking_code) {
      const pageResponse = await fetch(`${apiUrl}/rest/v1/landing_pages?tracking_code=eq.${params.tracking_code}&select=id`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      if (pageResponse.ok) {
        const pages = await pageResponse.json();
        if (pages.length > 0) {
          landingPageId = pages[0].id;
        }
      }
    }
    
    if (!landingPageId) {
      console.error('Landing page not found for tracking code:', params.tracking_code);
      return;
    }
    
    // Insert directly into visitors table (server-side, no CORS)
    const response = await fetch(`${apiUrl}/rest/v1/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        landing_page_id: landingPageId,
        session_id: params.session_id || null,
        user_agent: params.user_agent || 'Unknown',
        device_type: params.device_type || 'unknown',
        screen_resolution: params.screen_resolution || null,
        referrer: params.referrer || null,
        created_at: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Visitor created successfully via server-side approach:', result[0]?.id);
    } else {
      const error = await response.text();
      console.error('Error creating visitor:', error);
    }
    
  } catch (error) {
    console.error('Error in server-side processing:', error);
  }
}

// Vercel Function para processar tracking
// Deploy: vercel --prod

const PIXEL_GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
]);

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
  
  const { query } = req;
  
  // Process tracking data in background
  if (query.action) {
    processTracking(query).catch(err => 
      console.error('Background tracking error:', err)
    );
  }
  
  // Always return pixel immediately
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(PIXEL_GIF);
}

async function processTracking(params) {
  const action = params.action;
  const apiUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
  const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
  
  try {
    if (action === 'sync_visitor' && params.tracking_code) {
      console.log('Processing visitor:', params.tracking_code);
      
      // Get landing page ID
      const pageResponse = await fetch(`${apiUrl}/rest/v1/rpc/get_landing_page_by_tracking_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey
        },
        body: JSON.stringify({
          tracking_code_param: params.tracking_code
        })
      });
      
      if (pageResponse.ok) {
        const pages = await pageResponse.json();
        if (pages.length > 0) {
          // Create visitor
          const visitorResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_visitor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': apiKey
            },
            body: JSON.stringify({
              landing_page_id_param: pages[0].id,
              session_id_param: params.session_id,
              user_agent_param: params.user_agent,
              device_type_param: params.device_type,
              screen_resolution_param: params.screen_resolution,
              referrer_param: params.referrer
            })
          });
          
          if (visitorResponse.ok) {
            console.log('Visitor created successfully');
          } else {
            console.error('Error creating visitor:', await visitorResponse.text());
          }
        }
      }
    }
    
    else if (action === 'sync_event' && params.visitor_id) {
      console.log('Processing event:', params.event_type);
      
      const eventResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_behavior_event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey
        },
        body: JSON.stringify({
          visitor_id_param: params.visitor_id,
          event_type_param: params.event_type,
          event_data_param: params.event_data ? JSON.parse(params.event_data) : {},
          coordinates_param: params.coordinates ? JSON.parse(params.coordinates) : null,
          element_selector_param: params.element_selector,
          section_param: params.section
        })
      });
      
      if (eventResponse.ok) {
        console.log('Event created successfully');
      } else {
        console.error('Error creating event:', await eventResponse.text());
      }
    }
    
    else if (action === 'sync_conversion' && params.visitor_id) {
      console.log('Processing conversion:', params.visitor_id);
      
      // Get landing page ID first
      const pageResponse = await fetch(`${apiUrl}/rest/v1/rpc/get_landing_page_by_tracking_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey
        },
        body: JSON.stringify({
          tracking_code_param: params.tracking_code
        })
      });
      
      if (pageResponse.ok) {
        const pages = await pageResponse.json();
        if (pages.length > 0) {
          const conversionResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_conversion`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': apiKey
            },
            body: JSON.stringify({
              visitor_id_param: params.visitor_id,
              landing_page_id_param: pages[0].id,
              form_data_param: params.form_data ? JSON.parse(params.form_data) : {},
              behavior_summary_param: params.behavior_summary ? JSON.parse(params.behavior_summary) : {},
              engagement_score_param: params.engagement_score ? parseFloat(params.engagement_score) : 0,
              time_to_convert_param: params.time_to_convert ? parseInt(params.time_to_convert) : 0
            })
          });
          
          if (conversionResponse.ok) {
            console.log('Conversion created successfully');
          } else {
            console.error('Error creating conversion:', await conversionResponse.text());
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error processing tracking:', error);
  }
}

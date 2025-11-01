// Netlify Function para tracking sem CORS
// Deploy: https://app.netlify.com/

const PIXEL_GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
]);

exports.handler = async (event, context) => {
  const { queryStringParameters } = event;
  
  // Always return pixel (no CORS)
  const headers = {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  };
  
  // Process tracking in background
  if (queryStringParameters && queryStringParameters.action) {
    processTracking(queryStringParameters);
  }
  
  return {
    statusCode: 200,
    headers,
    body: PIXEL_GIF.toString('base64'),
    isBase64Encoded: true
  };
};

async function processTracking(params) {
  const action = params.action;
  
  if (action === 'sync_visitor') {
    console.log('Visitor tracking:', params);
    
    // Call Supabase RPC from server-side (no CORS)
    try {
      const response = await fetch('https://etzdsywunlpbgxkphuil.supabase.co/rest/v1/rpc/get_landing_page_by_tracking_code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
        },
        body: JSON.stringify({
          tracking_code_param: params.tracking_code
        })
      });
      
      if (response.ok) {
        const pages = await response.json();
        if (pages.length > 0) {
          // Create visitor
          await fetch('https://etzdsywunlpbgxkphuil.supabase.co/rest/v1/rpc/create_visitor', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
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
          
          console.log('Visitor created successfully');
        }
      }
    } catch (error) {
      console.error('Error creating visitor:', error);
    }
  }
  
  // Handle events and conversions similarly...
}

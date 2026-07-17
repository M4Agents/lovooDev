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

  if (query.action) {
    try {
      await processTracking(query);
    } catch (err) {
      console.error('[track] Processing error:', sanitizeError(err));
    }
  }

  // Always return pixel after processing completes
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(PIXEL_GIF);
}

async function processTracking(params) {
  const action = params.action;
  const apiUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Endpoint público de tracking — anon key é suficiente (todas as RPCs são SECURITY DEFINER públicas)
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!apiUrl || !apiKey) {
    console.error('[track] Missing Supabase environment variables');
    return;
  }

  try {
    // Handle queue actions (fallback method)
    if (action && action.startsWith('queue_')) {
      const queueType = action.replace('queue_', '');

      // Prepare data object from URL parameters
      const data = {};
      Object.keys(params).forEach((key) => {
        if (key !== 'action') {
          data[key] = params[key];
        }
      });

      // Visit: tracking_queue não roteia para RPC canônica sem alteração de schema.
      // Chama canônica diretamente para não cair depois em public_create_visitor.
      if (queueType === 'visitor') {
        if (data.tracking_code) {
          await createCanonicalVisit(data, apiUrl, apiKey);
        }
        return;
      }

      console.log(`Fallback tracking received: ${queueType}`);

      // Try to insert into tracking_queue
      try {
        const queueResponse = await fetch(`${apiUrl}/rest/v1/tracking_queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify({
            action: queueType,
            data: data,
          }),
        });

        if (queueResponse.ok) {
          console.log(`Successfully queued ${queueType} via fallback`);
        } else {
          console.error(`Error queueing ${queueType}:`, queueResponse.status);
          await processDirectly(queueType, data, apiUrl, apiKey);
        }
      } catch (error) {
        console.error(`Queue insert failed, processing directly:`, sanitizeError(error));
        await processDirectly(queueType, data, apiUrl, apiKey);
      }

      return;
    }

    if (action === 'sync_visitor' && params.tracking_code) {
      await createCanonicalVisit(params, apiUrl, apiKey);
    } else if (action === 'sync_event' && params.visitor_id) {
      console.log('Processing event:', params.event_type);

      const eventResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_behavior_event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          visitor_id_param: params.visitor_id,
          event_type_param: params.event_type,
          event_data_param: params.event_data ? JSON.parse(params.event_data) : {},
          coordinates_param: params.coordinates ? JSON.parse(params.coordinates) : null,
          element_selector_param: params.element_selector,
          section_param: params.section,
        }),
      });

      if (eventResponse.ok) {
        console.log('Event created successfully');
      } else {
        console.error('Error creating event:', eventResponse.status);
      }
    } else if (action === 'sync_conversion' && params.visitor_id) {
      console.log('Processing conversion');

      // Get landing page ID first
      const pageResponse = await fetch(`${apiUrl}/rest/v1/rpc/get_landing_page_by_tracking_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          tracking_code_param: params.tracking_code,
        }),
      });

      if (pageResponse.ok) {
        const pages = await pageResponse.json();
        if (pages.length > 0) {
          const conversionResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_conversion`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
            },
            body: JSON.stringify({
              visitor_id_param: params.visitor_id,
              landing_page_id_param: pages[0].id,
              form_data_param: params.form_data ? JSON.parse(params.form_data) : {},
              behavior_summary_param: params.behavior_summary
                ? JSON.parse(params.behavior_summary)
                : {},
              engagement_score_param: params.engagement_score
                ? parseFloat(params.engagement_score)
                : 0,
              time_to_convert_param: params.time_to_convert
                ? parseInt(params.time_to_convert)
                : 0,
            }),
          });

          if (conversionResponse.ok) {
            console.log('Conversion created successfully');
          } else {
            console.error('Error creating conversion:', conversionResponse.status);
          }
        }
      }
    }
  } catch (error) {
    console.error('[track] Error processing tracking:', sanitizeError(error));
  }
}

async function processDirectly(type, data, apiUrl, apiKey) {
  try {
    if (type === 'visitor' && data.tracking_code) {
      await createCanonicalVisit(data, apiUrl, apiKey);
      return;
    }

    if (type === 'event' && data.visitor_id) {
      const eventResponse = await fetch(`${apiUrl}/rest/v1/rpc/create_behavior_event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        body: JSON.stringify({
          visitor_id_param: data.visitor_id,
          event_type_param: data.event_type,
          event_data_param: data.event_data ? JSON.parse(data.event_data) : {},
          coordinates_param: data.coordinates ? JSON.parse(data.coordinates) : null,
          element_selector_param: data.element_selector,
          section_param: data.section,
        }),
      });

      if (eventResponse.ok) {
        console.log('Event created successfully via direct processing');
      } else {
        console.error('Error creating event:', eventResponse.status);
      }
    }
  } catch (error) {
    console.error('[track] Error in direct processing:', sanitizeError(error));
  }
}

async function createCanonicalVisit(params, apiUrl, apiKey) {
  if (!params?.tracking_code) {
    return null;
  }

  const payload = {
    p_tracking_code: params.tracking_code,
    p_persistent_visitor_id: resolveUuidOrGenerate(params.visitor_id),
    p_session_id: resolveUuidOrGenerate(params.session_id),
    p_user_agent: params.user_agent ?? null,
    p_device_type: normalizeDeviceType(params.device_type),
    p_screen_resolution: params.screen_resolution ?? null,
    p_referrer: params.referrer ?? null,
    p_timezone: params.timezone ?? null,
    p_language: params.language ?? null,
  };

  try {
    const response = await fetch(`${apiUrl}/rest/v1/rpc/public_create_tracking_visit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('[track] Visit RPC HTTP error:', response.status);
      return null;
    }

    const raw = await response.json();
    const result = Array.isArray(raw) ? raw[0] : raw;

    if (result?.success === true) {
      console.log('[track] Visit created:', result.visit_id);
      return result;
    }

    console.error('[track] Visit RPC failed:', result?.error_code || 'UNKNOWN_ERROR');
    return result ?? null;
  } catch (error) {
    console.error('[track] Visit RPC exception:', sanitizeError(error));
    return null;
  }
}

function resolveUuidOrGenerate(value) {
  return isValidUUID(value) ? value : generateUUID();
}

function normalizeDeviceType(value) {
  if (value === 'desktop' || value === 'mobile' || value === 'tablet') {
    return value;
  }
  return null;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUUID(str) {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str
  );
}

function sanitizeError(error) {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error.slice(0, 200);
  if (error instanceof Error) return (error.message || 'Error').slice(0, 200);
  return 'unknown';
}

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

  if (query.tracking_code) {
    try {
      await processVisitorData(query);
    } catch (err) {
      console.error('[collect] Processing error:', sanitizeError(err));
    }
  }

  // Return success response
  res.status(200).json({ success: true, message: 'Data received' });
}

async function processVisitorData(params) {
  const apiUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!apiUrl || !apiKey) {
    console.error('[collect] Missing Supabase environment variables');
    return null;
  }

  const payload = buildCanonicalVisitPayload(params);

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
      console.error('[collect] RPC HTTP error:', response.status);
      return null;
    }

    const raw = await response.json();
    const result = Array.isArray(raw) ? raw[0] : raw;

    if (result?.success === true) {
      console.log('[collect] Visit created:', result.visit_id);
      return result;
    }

    console.error('[collect] RPC failed:', result?.error_code || 'UNKNOWN_ERROR');
    return result ?? null;
  } catch (error) {
    console.error('[collect] RPC exception:', sanitizeError(error));
    return null;
  }
}

function buildCanonicalVisitPayload(params) {
  return {
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

// Webhook para receber dados de visitantes via POST (sem CORS)
const INVALID_TRACKING_HTTP_CODES = new Set([
  'INVALID_TRACKING_CODE',
  'LANDING_PAGE_NOT_FOUND',
  'LANDING_PAGE_INACTIVE',
]);

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
    const {
      tracking_code,
      session_id,
      visitor_id,
      user_agent,
      device_type,
      screen_resolution,
      referrer,
      timezone,
      language,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
    } = req.body || {};

    if (!tracking_code) {
      console.error('[webhook-visitor] Missing tracking_code');
      res.status(400).json({ error: 'tracking_code is required' });
      return;
    }

    const result = await createCanonicalVisit({
      tracking_code,
      session_id,
      visitor_id,
      user_agent,
      device_type,
      screen_resolution,
      referrer,
      timezone,
      language,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
    });

    if (result.success) {
      console.log('[webhook-visitor] Visit created:', result.visitor_id);
      res.status(200).json({ success: true, visitor_id: result.visitor_id });
    } else {
      const errorCode = typeof result.error === 'string' ? result.error : 'TRACKING_VISIT_FAILED';
      console.error('[webhook-visitor] Visit failed:', errorCode);
      if (INVALID_TRACKING_HTTP_CODES.has(errorCode)) {
        res.status(404).json({ success: false, error: 'Invalid tracking code' });
      } else {
        res.status(500).json({ success: false, error: 'Tracking visit failed' });
      }
    }
  } catch (error) {
    console.error('[webhook-visitor] Exception:', sanitizeError(error));
    res.status(500).json({ success: false, error: 'Tracking visit failed' });
  }
}

async function createCanonicalVisit(params) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[webhook-visitor] Missing Supabase environment variables');
    return { success: false, error: 'TRACKING_VISIT_FAILED' };
  }

  const payload = {
    p_tracking_code: params.tracking_code,
    p_persistent_visitor_id: isValidUUID(params.visitor_id)
      ? params.visitor_id
      : generateUUID(),
    p_session_id: isValidUUID(params.session_id) ? params.session_id : generateUUID(),
    p_user_agent: params.user_agent ?? null,
    p_device_type: normalizeDeviceType(params.device_type),
    p_screen_resolution: params.screen_resolution ?? null,
    p_referrer: params.referrer ?? null,
    p_timezone: params.timezone ?? null,
    p_language: params.language ?? null,
    p_utm_source: sanitizeUtm(params.utm_source, 255),
    p_utm_medium: sanitizeUtm(params.utm_medium, 100),
    p_utm_campaign: sanitizeUtm(params.utm_campaign, 255),
    p_utm_content: sanitizeUtm(params.utm_content, 255),
    p_utm_term: sanitizeUtm(params.utm_term, 255),
  };

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc('public_create_tracking_visit', payload);

    if (error) {
      console.error('[webhook-visitor] RPC client error');
      return { success: false, error: 'TRACKING_VISIT_FAILED' };
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (result?.success === true && result.visit_id) {
      return { success: true, visitor_id: result.visit_id };
    }

    const errorCode =
      typeof result?.error_code === 'string' && result.error_code
        ? result.error_code
        : 'TRACKING_VISIT_FAILED';

    console.error('[webhook-visitor] Visit failed:', errorCode);
    return { success: false, error: errorCode };
  } catch (error) {
    console.error('[webhook-visitor] RPC exception:', sanitizeError(error));
    return { success: false, error: 'TRACKING_VISIT_FAILED' };
  }
}

function normalizeDeviceType(value) {
  if (value === 'desktop' || value === 'mobile' || value === 'tablet') {
    return value;
  }
  return null;
}

function sanitizeUtm(value, maxLen) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.slice(0, maxLen);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUUID(str) {
  if (typeof str !== 'string') return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function sanitizeError(error) {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error.slice(0, 200);
  if (error instanceof Error) return (error.message || 'Error').slice(0, 200);
  return 'unknown';
}

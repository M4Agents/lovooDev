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

  // Normalize action for branch only (arrays: first value wins)
  const action = Array.isArray(query.action)
    ? query.action[0]
    : typeof query.action === 'string'
      ? query.action
      : undefined;

  // Legacy behavior must never create visits
  if (action === 'event') {
    try {
      await processLegacyBehaviorEvent(query);
    } catch (err) {
      console.error('[collect] LEGACY_COLLECT_EVENT_FAILED error_code=rpc_client');
      console.error('[collect] Processing error:', sanitizeError(err));
    }

    res.status(200).json({ success: true, message: 'Data received' });
    return;
  }

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

async function processLegacyBehaviorEvent(params) {
  const trackingCode =
    typeof params.tracking_code === 'string' ? params.tracking_code.trim() : '';
  if (!trackingCode) {
    console.log('[collect] LEGACY_COLLECT_EVENT_IGNORED reason=missing_tracking_code');
    return null;
  }

  const persistentVisitorId =
    typeof params.visitor_id === 'string' ? params.visitor_id.trim() : '';
  if (!persistentVisitorId) {
    console.log(
      '[collect] LEGACY_COLLECT_EVENT_IGNORED reason=missing_persistent_visitor_id'
    );
    return null;
  }
  if (!isValidUUID(persistentVisitorId)) {
    console.log(
      '[collect] LEGACY_COLLECT_EVENT_IGNORED reason=invalid_persistent_visitor_id'
    );
    return null;
  }

  const eventType =
    typeof params.event_type === 'string' ? params.event_type.trim() : '';
  if (!eventType) {
    console.log('[collect] LEGACY_COLLECT_EVENT_IGNORED reason=missing_event_type');
    return null;
  }

  let sessionId = null;
  if (typeof params.session_id === 'string' && params.session_id.trim() !== '') {
    const trimmedSession = params.session_id.trim();
    if (!isValidUUID(trimmedSession)) {
      console.log('[collect] LEGACY_COLLECT_EVENT_IGNORED reason=invalid_session_id');
      return null;
    }
    sessionId = trimmedSession;
  }

  const eventData = buildLegacyEventData(params);
  const pageUrl = resolveLegacyPageUrl(params, eventData);

  const apiUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!apiUrl || !apiKey) {
    console.error('[collect] LEGACY_COLLECT_EVENT_FAILED error_code=rpc_client');
    console.error('[collect] Missing Supabase environment variables');
    return null;
  }

  const payload = {
    p_tracking_code: trackingCode,
    p_persistent_visitor_id: persistentVisitorId,
    p_session_id: sessionId,
    p_event_type: eventType,
    p_event_data: eventData,
    p_page_url: pageUrl,
  };

  try {
    const response = await fetch(
      `${apiUrl}/rest/v1/rpc/public_create_tracking_behavior_event`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.error('[collect] LEGACY_COLLECT_EVENT_FAILED error_code=rpc_http');
      return null;
    }

    const raw = await response.json();
    const result = Array.isArray(raw) ? raw[0] : raw;

    if (result?.success === true && result.event_id) {
      console.log('[collect] LEGACY_COLLECT_EVENT status=routed');
      return result;
    }

    const errorCode = mapLegacyRpcErrorCode(result?.error_code);
    console.error(`[collect] LEGACY_COLLECT_EVENT_FAILED error_code=${errorCode}`);
    return result ?? null;
  } catch (error) {
    console.error('[collect] LEGACY_COLLECT_EVENT_FAILED error_code=rpc_client');
    console.error('[collect] Processing error:', sanitizeError(error));
    return null;
  }
}

function buildLegacyEventData(params) {
  let eventData = safeParseJsonObject(params.event_data);

  const coordinates = safeParseJsonValue(params.coordinates);
  if (coordinates !== undefined && eventData.coordinates === undefined) {
    eventData = { ...eventData, coordinates };
  }

  if (
    typeof params.element_selector === 'string' &&
    params.element_selector &&
    eventData.element_selector === undefined
  ) {
    eventData = { ...eventData, element_selector: params.element_selector };
  }

  if (typeof params.section === 'string' && params.section && eventData.section === undefined) {
    eventData = { ...eventData, section: params.section };
  }

  return eventData;
}

function resolveLegacyPageUrl(params, eventData) {
  if (typeof params.page_url === 'string' && params.page_url.trim() !== '') {
    return params.page_url.trim();
  }
  if (eventData && typeof eventData.url === 'string' && eventData.url.trim() !== '') {
    return eventData.url.trim();
  }
  if (typeof params.url === 'string' && params.url.trim() !== '') {
    return params.url.trim();
  }
  return null;
}

function mapLegacyRpcErrorCode(code) {
  if (typeof code !== 'string' || !code) {
    return 'rpc_error';
  }
  if (code === 'INVALID_TRACKING_CODE') return 'invalid_tracking_code';
  if (code === 'VISIT_NOT_FOUND') return 'visit_not_found';
  if (code === 'INVALID_PERSISTENT_VISITOR_ID') return 'invalid_persistent_visitor_id';
  if (code === 'INVALID_SESSION_ID') return 'invalid_session_id';
  if (code === 'INVALID_EVENT_TYPE') return 'rpc_error';
  if (code === 'INVALID_EVENT_DATA') return 'rpc_error';
  return 'rpc_error';
}

function safeParseJsonObject(value) {
  if (value == null || value === '') {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function safeParseJsonValue(value) {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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
    p_utm_source: sanitizeUtm(params.utm_source, 255),
    p_utm_medium: sanitizeUtm(params.utm_medium, 100),
    p_utm_campaign: sanitizeUtm(params.utm_campaign, 255),
    p_utm_content: sanitizeUtm(params.utm_content, 255),
    p_utm_term: sanitizeUtm(params.utm_term, 255),
  };
}

function sanitizeUtm(value, maxLen) {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const str = String(raw).trim();
  if (!str) return null;
  return str.slice(0, maxLen);
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

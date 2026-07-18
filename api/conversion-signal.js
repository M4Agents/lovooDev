// Pixel → Lovoo conversion signal (does not create leads)
function applyCors(req, res) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  // Reflect LP origin (required when browser sends credentials); fallback *
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body || {};
    const tracking_code = typeof body.tracking_code === 'string' ? body.tracking_code.trim() : '';
    const visitor_id = typeof body.visitor_id === 'string' ? body.visitor_id.trim() : '';
    const session_id = typeof body.session_id === 'string' ? body.session_id.trim() : null;
    const phone = pickString(body, ['phone', 'whatsapp', 'telefone', 'tel', 'celular']);
    const email = pickString(body, ['email', 'e-mail']);
    const name = pickString(body, ['name', 'nome', 'full_name', 'fullname']);

    if (!tracking_code || !visitor_id) {
      res.status(400).json({ success: false, error: 'tracking_code and visitor_id are required' });
      return;
    }

    if (!phone && !email) {
      res.status(400).json({ success: false, error: 'phone or email is required' });
      return;
    }

    const result = await createConversionSignal({
      tracking_code,
      visitor_id,
      session_id,
      phone,
      email,
      name,
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        signal_id: result.signal_id,
        linked_lead_id: result.linked_lead_id || null,
      });
      return;
    }

    const code = result.error || 'SIGNAL_FAILED';
    if (
      code === 'INVALID_TRACKING_CODE' ||
      code === 'LANDING_PAGE_NOT_FOUND' ||
      code === 'LANDING_PAGE_INACTIVE'
    ) {
      res.status(404).json({ success: false, error: code });
      return;
    }
    if (code === 'MISSING_CONTACT' || code === 'INVALID_PERSISTENT_VISITOR_ID') {
      res.status(400).json({ success: false, error: code });
      return;
    }
    res.status(500).json({ success: false, error: 'SIGNAL_FAILED' });
  } catch (error) {
    console.error('[conversion-signal] Exception:', sanitizeError(error));
    res.status(500).json({ success: false, error: 'SIGNAL_FAILED' });
  }
}

async function createConversionSignal(params) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[conversion-signal] Missing Supabase environment variables');
    return { success: false, error: 'SIGNAL_FAILED' };
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc('public_create_conversion_signal', {
      p_tracking_code: params.tracking_code,
      p_persistent_visitor_id: params.visitor_id,
      p_session_id: params.session_id,
      p_phone: params.phone,
      p_email: params.email,
      p_name: params.name,
    });

    if (error) {
      console.error('[conversion-signal] RPC client error');
      return { success: false, error: 'SIGNAL_FAILED' };
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.success === true && result.signal_id) {
      console.log('[conversion-signal] stored', {
        signal_id: result.signal_id,
        linked_lead_id: result.linked_lead_id || null,
      });
      return {
        success: true,
        signal_id: result.signal_id,
        linked_lead_id: result.linked_lead_id || null,
      };
    }

    return {
      success: false,
      error:
        typeof result?.error_code === 'string' && result.error_code
          ? result.error_code
          : 'SIGNAL_FAILED',
    };
  } catch (error) {
    console.error('[conversion-signal] RPC exception:', sanitizeError(error));
    return { success: false, error: 'SIGNAL_FAILED' };
  }
}

function pickString(body, keys) {
  for (const key of keys) {
    const val = body[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  // case-insensitive key match
  const entries = Object.entries(body || {});
  for (const want of keys) {
    const found = entries.find(([k, v]) => String(k).toLowerCase() === want && typeof v === 'string' && v.trim());
    if (found) return found[1].trim();
  }
  return null;
}

function sanitizeError(error) {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error.slice(0, 200);
  if (error instanceof Error) return (error.message || 'Error').slice(0, 200);
  return 'unknown';
}

// Chamadas HTTP da sessão de QR. O corpo remoto não é repassado ao cliente.

export function webhookUrl(env) {
  const configured = typeof env.UAZAPI_WEBHOOK_URL === 'string' ? env.UAZAPI_WEBHOOK_URL.trim() : '';
  if (configured) return configured;
  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;
}

export function readQr(payload) {
  if (!payload || typeof payload !== 'object') return { qrcode: null, paircode: null };
  const record = payload;
  return {
    qrcode: record.qrcode || record.base64 || record.instance?.qrcode || record.instance?.base64 || record.data?.qrcode || record.data?.base64 || null,
    paircode: record.paircode || record.instance?.paircode || record.data?.paircode || null,
  };
}

export async function postJson(fetchImpl, url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

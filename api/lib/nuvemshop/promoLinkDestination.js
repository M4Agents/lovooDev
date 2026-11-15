// Caminho de destino do link promocional.
// Query e fragmento são removidos. A URL absoluta só vale se o host for da própria loja.
// A decodificação tem limite e precisa coincidir com nuvemshop_promo_destination_safe.

const MAX_PATH = 200;
const DECODE_LIMIT = 5;

function fail(message) {
  return { ok: false, error: { status: 400, code: 'validation_error', message, field: 'destination_path' } };
}

function hasAmbiguousPercent(value) {
  return /%(?![0-9A-Fa-f]{2})/.test(value);
}

function layerBlocked(value) {
  return value.includes('\\')
    || value.includes('//')
    || value.split('/').includes('..')
    || /[?#*]/.test(value);
}

function decodeLayers(value) {
  let current = value;
  for (let round = 0; round < DECODE_LIMIT; round += 1) {
    if (layerBlocked(current)) return null;
    if (!current.includes('%')) return current;
    if (hasAmbiguousPercent(current)) return null;
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return null;
    current = next;
  }
  if (current.includes('%') || layerBlocked(current)) return null;
  return current;
}

function cleanPath(raw) {
  const cut = raw.search(/[?#]/);
  const sliced = cut >= 0 ? raw.slice(0, cut) : raw;
  const path = decodeLayers(sliced);
  if (path == null) return null;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function pathAllowed(path) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return false;
  if (path.length > MAX_PATH) return false;
  return !layerBlocked(path);
}

function pathFromAbsolute(raw) {
  const match = /^https:\/\/[^/?#\\]+([^?#]*)/i.exec(raw);
  if (!match) return null;
  const path = match[1] || '/';
  return path.startsWith('/') ? path : null;
}

export function normalizePromoDestination(value, allowedHosts = []) {
  if (typeof value !== 'string') return fail('Informe o destino na loja.');
  const raw = value.trim();
  if (!raw) return fail('Informe o destino na loja.');
  if (raw.includes('\\') || /^javascript:/i.test(raw) || /^data:/i.test(raw)) {
    return fail('O destino precisa ser uma página da própria loja.');
  }
  if (raw.startsWith('//')) return fail('O destino precisa ser uma página da própria loja.');

  if (/^https?:\/\//i.test(raw)) {
    if (!raw.toLowerCase().startsWith('https://')) {
      return fail('O destino precisa ser uma página da própria loja.');
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      return fail('O destino precisa ser uma página da própria loja.');
    }
    const host = url.hostname.toLowerCase();
    const allowed = allowedHosts.map((item) => String(item).toLowerCase());
    if (!allowed.includes(host)) return fail('O destino precisa ser uma página da própria loja.');
    const rawPath = pathFromAbsolute(raw);
    const path = rawPath == null ? null : cleanPath(rawPath);
    if (!pathAllowed(path)) return fail('O destino precisa ser uma página da própria loja.');
    return { ok: true, path };
  }

  if (!raw.startsWith('/')) return fail('Informe um caminho da loja, começando com /.');
  const path = cleanPath(raw);
  if (!pathAllowed(path)) return fail('O destino precisa ser uma página da própria loja.');
  return { ok: true, path };
}

export function buildPromoDiscountUrl(origin, couponCode, destinationPath) {
  const base = String(origin).replace(/\/$/, '');
  const code = encodeURIComponent(couponCode);
  const path = encodeURI(destinationPath);
  return `${base}/discount/${code}?redirect_to=${path}`;
}

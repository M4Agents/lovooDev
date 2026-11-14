// =============================================================================
// GET/POST /api/nuvemshop/welcome-popup/public
//
// A empresa vem da conexão ativa da loja. company_id do navegador é recusado.
// Sem campanha publicada, a resposta continua 409 e não revela cupom.
// CORS ecoa só a origem já aceita na campanha, em qualquer retorno posterior.
// Origem ausente ou recusada não recebe eco. Vary acumula Origin sem apagar o restante.
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { hashRateKey, handleWelcomePublic } from '../../lib/nuvemshop/welcomePublic.js';
import { signupPayloadHash } from '../../lib/nuvemshop/welcomeSignup.js';
import { publicSignupClosed } from '../../lib/nuvemshop/welcomePopupAccess.js';

const buckets = new Map();

function applyAuthorizedCors(res, origin) {
  if (typeof origin !== 'string' || !origin.startsWith('https://') || origin.includes('*')) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const current = typeof res.getHeader === 'function' ? res.getHeader('Vary') : undefined;
  const values = (current == null ? [] : (Array.isArray(current) ? current : [current]))
    .flatMap((item) => String(item).split(','))
    .map((part) => part.trim())
    .filter(Boolean);
  if (!values.some((part) => part.toLowerCase() === 'origin')) values.push('Origin');
  res.setHeader('Vary', values.join(', '));
}

function blocked(res) {
  const closed = publicSignupClosed({ enabled: false });
  return res.status(closed.status).json({
    error: closed.message,
    code: closed.code,
    coupon_revealed: false,
    redirect: false,
  });
}

function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return String(forwarded ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
}

function adapt(admin, req) {
  const ip = clientIp(req);
  return {
    from: (...args) => admin.from(...args),
    rateBuckets: buckets,
    async commitSignup(input) {
      const { data, error } = await admin.rpc('nuvemshop_welcome_commit_signup', {
        p_payload: {
          ...input,
          payloadHash: input.payloadHash ?? signupPayloadHash(input),
          ipHash: ip ? hashRateKey(['ip', input.storeId, ip]) : null,
        },
      });
      if (error || !data) return null;
      return data;
    },
  };
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return blocked(res);
  }

  try {
    const result = await handleWelcomePublic(req, adapt(admin, req));
    if (result.origin) applyAuthorizedCors(res, result.origin);
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(503).json({
      error: 'O cadastro não está disponível agora.',
      code: 'signup_unavailable',
      coupon_revealed: false,
      redirect: false,
    });
  }
}

// =============================================================================
// GET/POST /api/nuvemshop/welcome-popup/public
//
// A empresa vem da conexão ativa da loja. company_id do navegador é recusado.
// Sem campanha publicada, a resposta continua 409 e não revela cupom.
// CORS apenas ecoa uma origem já autorizada; não autentica a requisição.
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { hashRateKey, handleWelcomePublic } from '../../lib/nuvemshop/welcomePublic.js';
import { signupPayloadHash } from '../../lib/nuvemshop/welcomeSignup.js';
import { publicSignupClosed } from '../../lib/nuvemshop/welcomePopupAccess.js';

const buckets = new Map();

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
    async dispatch(committed) {
      try {
        const [{ createExecution, processFlowAsync }, { matchesTriggerConditions }, { processWelcomeAutomationJobs }] = await Promise.all([
          import('../../lib/automation/executor.js'),
          import('../../lib/automation/triggerEvaluator.js'),
          import('../../lib/nuvemshop/welcomeAutomationWorker.js'),
        ]);
        await processWelcomeAutomationJobs({
          supabase: admin,
          signupId: committed.signup?.id ?? null,
          createExecution,
          processFlowAsync,
          matchesTriggerConditions,
        });
      } catch {
        // O cron retoma o trabalho que já foi gravado com a concessão.
      }
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
    if (result.origin) {
      res.setHeader('Access-Control-Allow-Origin', result.origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
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

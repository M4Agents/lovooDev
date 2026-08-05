// =============================================================================
// cronGuard — garante que cron jobs só executem no ambiente de produção.
//
// Adicione CRON_ENABLED=true SOMENTE no projeto Vercel de produção (loovocrm).
// O projeto de desenvolvimento (lovooDev) NÃO deve ter esta variável.
//
// Uso em cada handler:
//   import { cronGuard } from '../lib/cronGuard.js';
//   export default async function handler(req, res) {
//     if (!cronGuard(req, res)) return;
//     // ...
//   }
// =============================================================================

export function cronGuard(req, res) {
  if (process.env.CRON_ENABLED !== 'true') {
    console.info(JSON.stringify({
      level:   'info',
      event:   'cron_skipped_not_production',
      cron:    req.url,
      vercel_env: process.env.VERCEL_ENV ?? 'unknown',
    }));
    res.status(200).json({ ok: true, skipped: true, reason: 'CRON_ENABLED not set — dev environment' });
    return false;
  }
  return true;
}

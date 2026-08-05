// =============================================================================
// GET /api/nuvemshop/admin/diagnostics
// Endpoint TEMPORÁRIO de diagnóstico — remover após resolver o problema.
// Requer autenticação de admin para evitar exposição de dados sensíveis.
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const svc = getSupabaseAdmin();
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token obrigatório' });

  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

  // Verificar se é admin da plataforma
  const { data: adminCheck } = await svc.rpc('auth_user_is_platform_admin');
  if (!adminCheck) return res.status(403).json({ error: 'Acesso negado' });

  const { data: pendingEvents } = await svc
    .from('nuvemshop_webhook_events')
    .select('id, topic, status, attempts, next_attempt_at')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .limit(5);

  return res.status(200).json({
    env: {
      CRON_ENABLED:    process.env.CRON_ENABLED ?? '(não definida)',
      VERCEL_ENV:      process.env.VERCEL_ENV ?? '(não definida)',
      NODE_ENV:        process.env.NODE_ENV ?? '(não definida)',
      HAS_TOKEN_KEY:   !!process.env.NUVEMSHOP_TOKEN_ENC_KEY_V1,
      HAS_SUPABASE_URL: !!process.env.SUPABASE_URL,
    },
    pending_events_ready: pendingEvents?.length ?? 0,
    sample_events: pendingEvents?.map(e => ({ id: e.id, topic: e.topic, attempts: e.attempts })) ?? [],
  });
}

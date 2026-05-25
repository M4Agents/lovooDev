// =============================================================================
// GET /api/instagram/data-deletion/status?code=<confirmation_code>
//
// Status page pública para solicitações de exclusão de dados.
// Exigida pelo protocolo de Data Deletion da Meta.
//
// Query params:
//   code — confirmation_code retornado pelo POST /data-deletion
//
// Resposta (sem PII):
//   {
//     confirmation_code,
//     status,           // 'received' | 'completed' | 'not_found'
//     requested_at      // ISO timestamp da criação
//   }
//
// 404 se código inválido ou não encontrado.
//
// SEGURANÇA:
//   - Sem JWT — endpoint público (Meta precisa verificar sem autenticação)
//   - Sem dados pessoais na resposta (sem instagram_user_id, sem company_id)
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = req.query?.code ?? '';

  if (!code || typeof code !== 'string' || code.length < 10) {
    return res.status(400).json({ error: 'code inválido' });
  }

  const svc = getSupabaseAdmin();

  const { data: record, error: fetchErr } = await svc
    .from('instagram_data_deletion_requests')
    .select('confirmation_code, status, created_at')
    .eq('confirmation_code', code)
    .maybeSingle();

  if (fetchErr) {
    console.error('[data-deletion/status] fetch error:', fetchErr.message);
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!record) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.status(200).json({
    confirmation_code: record.confirmation_code,
    status:            record.status,
    requested_at:      record.created_at,
  });
}

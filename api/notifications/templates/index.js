// =============================================================================
// GET /api/notifications/templates
//
// Lista todos os templates de notificação da empresa pai para o painel admin.
//
// AUTENTICAÇÃO: Authorization: Bearer <JWT>
// AUTORIZAÇÃO:  super_admin ou system_admin da empresa pai (PARENT_COMPANY_ID)
//
// RESPOSTA (200):
//   {
//     "ok": true,
//     "templates": [
//       {
//         "id":            "<uuid>",
//         "event_type":    "trial_alert",
//         "event_subtype": "3d",
//         "channel":       "email",
//         "name":          "...",
//         "subject":       "...",
//         "body":          "...",
//         "is_active":     true
//       }
//     ]
//   }
//
// REGRAS:
//   - Somente templates do PARENT_COMPANY_ID são retornados
//   - Retorna ativos e inativos (admin precisa gerenciar ambos)
//   - Ordenados por event_type, event_subtype, channel (previsível)
//   - Sem lógica de envio ou dedup
// =============================================================================

import { assertNotificationsAdmin, PARENT_COMPANY_ID } from '../../lib/notifications/auth.js'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Autenticação e autorização ─────────────────────────────────────────────
  const auth = await assertNotificationsAdmin(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const { supabase } = auth

  // ── Listar templates da empresa pai ───────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from('notification_templates')
      .select('id, event_type, event_subtype, channel, name, subject, body, is_active')
      .eq('company_id', PARENT_COMPANY_ID)
      .order('event_type',    { ascending: true })
      .order('event_subtype', { ascending: true, nullsFirst: true })
      .order('channel',       { ascending: true })

    if (error) {
      console.error('[notifications/templates GET] Erro ao listar templates:', error.message)
      return res.status(500).json({ ok: false, error: 'Erro ao buscar templates' })
    }

    return res.status(200).json({ ok: true, templates: data ?? [] })
  } catch (err) {
    console.error('[notifications/templates GET] Erro interno:', err?.message)
    return res.status(500).json({ ok: false, error: 'Erro interno ao buscar templates' })
  }
}

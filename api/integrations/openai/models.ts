// =====================================================
// GET /api/integrations/openai/models
// Lista modelos chat disponíveis (OpenAI models.list) — sessão JWT + gestão Pai
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { listOpenAIChatModelIds } from '../../lib/openai/gate.js'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Método não permitido' })
    return
  }

  const auth = await assertCanManageOpenAIIntegration(req)
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.message })
    return
  }

  const result = await listOpenAIChatModelIds()
  if (!result.ok) {
    res.status(502).json({
      ok: false,
      error: 'Não foi possível listar os modelos disponíveis. Tente novamente mais tarde.',
    })
    return
  }

  res.status(200).json({ ok: true, models: result.models })
}

// =====================================================
// POST /api/integrations/openai/test
// Teste de conexão via api/lib/openai/gate.ts (sessão JWT apenas)
// Resposta de erro genérica — sem mensagens brutas da API OpenAI
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth'
import { runOpenAIConnectionTest } from '../../lib/openai/gate'

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método não permitido' })
    return
  }

  const auth = await assertCanManageOpenAIIntegration(req)
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.message })
    return
  }

  const result = await runOpenAIConnectionTest(auth.supabase)
  if (result.ok) {
    res.status(200).json({ ok: true })
    return
  }

  res.status(502).json({
    ok: false,
    error: 'Não foi possível verificar a conexão com o serviço de IA. Tente novamente mais tarde.',
  })
}

// =====================================================
// POST /api/integrations/elevenlabs/test
// Validação leve: GET /v1/user na API ElevenLabs (chave só no servidor)
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { isElevenLabsApiKeyConfigured } from '../../lib/elevenlabs/config.js'

const ELEVENLABS_USER_URL = 'https://api.elevenlabs.io/v1/user'

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

  const key = process.env.ELEVENLABS_API_KEY?.trim()
  if (!key || !isElevenLabsApiKeyConfigured()) {
    res.status(502).json({
      ok: false,
      error: 'Chave da API ElevenLabs não configurada no servidor.',
    })
    return
  }

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 25_000)

  try {
    const r = await fetch(ELEVENLABS_USER_URL, {
      method: 'GET',
      headers: {
        'xi-api-key': key,
        Accept: 'application/json',
      },
      signal: ac.signal,
    })
    clearTimeout(t)

    if (r.ok) {
      res.status(200).json({ ok: true })
      return
    }

    res.status(502).json({
      ok: false,
      error: 'Não foi possível verificar a conexão com a ElevenLabs. Tente novamente mais tarde.',
    })
  } catch {
    clearTimeout(t)
    res.status(502).json({
      ok: false,
      error: 'Não foi possível verificar a conexão com a ElevenLabs. Tente novamente mais tarde.',
    })
  }
}

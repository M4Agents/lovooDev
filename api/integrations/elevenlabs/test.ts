// =====================================================
// POST /api/integrations/elevenlabs/test
// Validação leve: GET /v1/user na API ElevenLabs (chave só no servidor)
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { getElevenLabsApiKey, isElevenLabsApiKeyConfigured } from '../../lib/elevenlabs/config.js'

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

  const key = getElevenLabsApiKey()
  if (!key || !isElevenLabsApiKeyConfigured()) {
    res.status(502).json({
      ok: false,
      error: 'Chave da API ElevenLabs não configurada no servidor (ELEVENLABS_API_KEY ou XI_API_KEY).',
    })
    return
  }

  // #region agent log
  console.log(
    JSON.stringify({
      hypothesisId: 'H3-key-shape',
      message: 'elevenlabs_key_meta',
      data: { keyLength: key.length },
      timestamp: Date.now(),
    })
  )
  // #endregion

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

    if (r.status === 401) {
      res.status(401).json({
        ok: false,
        error:
          'A ElevenLabs recusou a chave (401). Na Vercel, cole o valor sem aspas; no painel ElevenLabs (Developers → API Keys) confira se a chave não foi revogada e gere uma nova se necessário. A variável ELEVENLABS_API_KEY deve ser a mesma chave exibida ao criar (não o nome do segredo).',
      })
      return
    }

    res.status(502).json({
      ok: false,
      error: 'Não foi possível verificar a conexão com a ElevenLabs. Tente novamente mais tarde.',
    })
  } catch (e) {
    clearTimeout(t)
    // #region agent log
    console.log(
      JSON.stringify({
        hypothesisId: 'H2-fetch-throw',
        message: 'elevenlabs_test_fetch_error',
        data: { name: e instanceof Error ? e.name : 'unknown' },
        timestamp: Date.now(),
      })
    )
    // #endregion
    res.status(502).json({
      ok: false,
      error: 'Não foi possível verificar a conexão com a ElevenLabs. Tente novamente mais tarde.',
    })
  }
}

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

    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f28051' },
      body: JSON.stringify({
        sessionId: 'f28051',
        hypothesisId: 'H1-elevenlabs-http',
        location: 'elevenlabs/test.ts:afterFetch',
        message: 'elevenlabs_v1_user_status',
        data: { status: r.status, ok: r.ok },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    console.log(
      JSON.stringify({
        hypothesisId: 'H1-elevenlabs-http',
        message: 'elevenlabs_v1_user_status',
        data: { status: r.status, ok: r.ok },
        timestamp: Date.now(),
      })
    )
    // #endregion

    if (r.ok) {
      res.status(200).json({ ok: true })
      return
    }

    if (r.status === 401) {
      res.status(401).json({
        ok: false,
        error:
          'A ElevenLabs recusou a chave (401). Confira se a chave está correta e ativa no painel ElevenLabs e se ELEVENLABS_API_KEY (ou XI_API_KEY) na Vercel corresponde a esse projeto.',
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

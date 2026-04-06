// =====================================================
// GET /api/integrations/elevenlabs/voices
// Lista primeira página de vozes (page_size=100) via API ElevenLabs v2
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { fetchParentElevenLabsSettings } from '../../lib/elevenlabs/settingsDb.js'
import { getElevenLabsApiKey, isElevenLabsApiKeyConfigured } from '../../lib/elevenlabs/config.js'

const ELEVENLABS_VOICES_URL =
  'https://api.elevenlabs.io/v2/voices?page_size=100&sort=name&sort_direction=asc'

export type ElevenLabsVoiceDTO = {
  voice_id: string
  name: string
  category?: string
}

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

  const key = getElevenLabsApiKey()
  if (!key || !isElevenLabsApiKeyConfigured()) {
    res.status(502).json({
      ok: false,
      error: 'Chave da API ElevenLabs não configurada no servidor (ELEVENLABS_API_KEY ou XI_API_KEY).',
    })
    return
  }

  const settings = await fetchParentElevenLabsSettings(auth.supabase)
  const timeoutMs = Math.min(Math.max(settings.timeout_ms, 1000), 600_000)

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)

  try {
    const r = await fetch(ELEVENLABS_VOICES_URL, {
      method: 'GET',
      headers: {
        'xi-api-key': key,
        Accept: 'application/json',
      },
      signal: ac.signal,
    })
    clearTimeout(t)

    const json = (await r.json().catch(() => null)) as {
      voices?: Array<{
        voice_id?: unknown
        name?: unknown
        category?: unknown
      }>
    } | null

    if (!r.ok) {
      if (r.status === 401) {
        res.status(401).json({
          ok: false,
          error:
            'A ElevenLabs recusou a chave (401). Verifique ELEVENLABS_API_KEY na Vercel e se a chave não foi revogada.',
        })
        return
      }
      res.status(502).json({
        ok: false,
        error: 'Não foi possível listar as vozes na ElevenLabs. Tente novamente mais tarde.',
      })
      return
    }

    const raw = Array.isArray(json?.voices) ? json.voices : []
    const voices: ElevenLabsVoiceDTO[] = raw
      .map((v) => {
        const voice_id = typeof v.voice_id === 'string' ? v.voice_id.trim() : ''
        const name = typeof v.name === 'string' ? v.name : ''
        if (!voice_id) return null
        const out: ElevenLabsVoiceDTO = { voice_id, name: name || voice_id }
        if (typeof v.category === 'string' && v.category.length > 0) {
          out.category = v.category
        }
        return out
      })
      .filter((x): x is ElevenLabsVoiceDTO => x !== null)

    res.status(200).json({ ok: true, voices })
  } catch {
    clearTimeout(t)
    res.status(502).json({
      ok: false,
      error: 'Não foi possível listar as vozes na ElevenLabs. Tente novamente mais tarde.',
    })
  }
}

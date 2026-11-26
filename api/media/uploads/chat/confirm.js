import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js'
import { confirmChatUpload } from '../../../lib/media/chatUpload/confirmChatUpload.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

export async function handleChatConfirm(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    send(res, 405, { error: 'Método não permitido' })
    return
  }

  let svc = deps.svc
  if (!svc) {
    try {
      svc = getSupabaseAdmin()
    } catch {
      send(res, 503, { error: 'Confirmação temporariamente indisponível' })
      return
    }
  }

  try {
    const result = await confirmChatUpload({
      req,
      body: req.body,
      svc,
      env: deps.env ?? process.env,
      now: deps.now,
      headObject: deps.headObject,
    })
    send(res, result.status, result.body)
  } catch {
    send(res, 503, { error: 'Confirmação temporariamente indisponível' })
  }
}

export default function handler(req, res) {
  return handleChatConfirm(req, res)
}

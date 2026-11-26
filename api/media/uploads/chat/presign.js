import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js'
import { presignChatUpload } from '../../../lib/media/chatUpload/presignChatUpload.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

export async function handleChatPresign(req, res, deps = {}) {
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
      send(res, 500, { error: 'Falha ao preparar upload' })
      return
    }
  }

  try {
    const result = await presignChatUpload({
      req,
      body: req.body,
      svc,
      env: deps.env ?? process.env,
      now: deps.now,
      createOperationId: deps.createOperationId,
      signPut: deps.signPut,
    })
    send(res, result.status, result.body)
  } catch {
    send(res, 500, { error: 'Falha ao preparar upload' })
  }
}

export default function handler(req, res) {
  return handleChatPresign(req, res)
}

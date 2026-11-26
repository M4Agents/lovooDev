import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js'
import { presignLibraryUpload } from '../../../lib/media/libraryUpload/presignLibraryUpload.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

export async function handleLibraryPresign(req, res, deps = {}) {
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
    const result = await presignLibraryUpload({
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
  return handleLibraryPresign(req, res)
}

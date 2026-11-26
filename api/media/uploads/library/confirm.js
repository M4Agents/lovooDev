import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js'
import { confirmLibraryUpload } from '../../../lib/media/libraryUpload/confirmLibraryUpload.js'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

export async function handleLibraryConfirm(req, res, deps = {}) {
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
      send(res, 500, { error: 'Falha ao confirmar upload' })
      return
    }
  }

  try {
    const result = await confirmLibraryUpload({
      req,
      body: req.body,
      svc,
      env: deps.env ?? process.env,
      now: deps.now,
      headObject: deps.headObject,
    })
    send(res, result.status, result.body)
  } catch {
    send(res, 500, { error: 'Falha ao confirmar upload' })
  }
}

export default function handler(req, res) {
  return handleLibraryConfirm(req, res)
}

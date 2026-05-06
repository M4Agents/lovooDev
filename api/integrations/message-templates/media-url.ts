// =============================================================================
// GET /api/integrations/message-templates/media-url
//
// Retorna a URL pública de um media_path (S3 key) para preview de mídia
// de template de mensagem. Consulta as credenciais da empresa para obter
// bucket e região — nunca expõe as credenciais ao browser.
//
// Query: ?media_path=<s3_key>&company_id=<uuid>
// Returns: { url: string }
//
// Segurança:
//   - Bearer token obrigatório
//   - company_id validado via assertMembership
//   - Nenhuma credencial AWS retornada ao browser
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { getSupabaseAdmin }                     from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
}                                               from '../../lib/dashboard/auth.js'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Resolve bucket e região usando o RPC webhook_resolve_aws_credentials.
 * Garante fallback empresa filha → empresa mãe (SECURITY DEFINER).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAwsBucketInfo(svc: any, companyId: string): Promise<{ region: string; bucket: string } | null> {
  const { data, error } = await svc
    .rpc('webhook_resolve_aws_credentials', { p_company_id: companyId })

  if (error || !data || data.length === 0) return null

  const cred = data[0] as { region: string; bucket: string }
  return { region: cred.region ?? 'sa-east-1', bucket: cred.bucket ?? 'aws-lovoocrm-media' }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'GET') return jsonError(res, 405, 'Método não permitido')

  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const q = (req as any).query as Record<string, string> // eslint-disable-line @typescript-eslint/no-explicit-any

  const mediaPath = q?.media_path
  const companyId = q?.company_id

  if (!mediaPath || !companyId) {
    return jsonError(res, 400, 'media_path e company_id são obrigatórios')
  }

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  try {
    const info = await getAwsBucketInfo(svc, companyId)
    if (!info) return jsonError(res, 422, 'Credenciais AWS não encontradas para esta empresa')
    const url = `https://${info.bucket}.s3.${info.region}.amazonaws.com/${mediaPath}`
    return res.status(200).json({ url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    console.error('[media-url] error:', message)
    return jsonError(res, 500, 'Erro ao gerar URL de mídia')
  }
}

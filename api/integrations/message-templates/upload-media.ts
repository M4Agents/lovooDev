// =============================================================================
// POST /api/integrations/message-templates/upload-media
//
// Gera uma presigned PUT URL para upload de mídia de template diretamente ao S3.
// O browser faz o PUT direto ao S3 sem passar o arquivo pelo backend.
//
// Body: { filename: string, contentType: string, companyId: string }
// Returns: { presignedUrl, s3Key, mediaType, directUrl }
//
// Segurança:
//   - Bearer token obrigatório
//   - company_id validado via assertMembership
//   - Credenciais AWS nunca expostas ao browser
//   - s3Storage / CredentialsManager / supabase-webhook NÃO importados no browser
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { S3Client, PutObjectCommand }           from '@aws-sdk/client-s3'
import { getSignedUrl }                         from '@aws-sdk/s3-request-presigner'
import { getSupabaseAdmin }                     from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
}                                               from '../../lib/dashboard/auth.js'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type MediaType = 'image' | 'video' | 'audio' | 'document'

interface AwsCreds {
  access_key_id:     string
  secret_access_key: string
  region:            string
  bucket:            string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMediaType(contentType: string): MediaType {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'document'
}

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
}

function generateS3Key(companyId: string, filename: string): string {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day   = String(now.getDate()).padStart(2, '0')
  const ts    = Date.now()
  const safe  = sanitizeFilename(filename)
  return `clientes/${companyId}/templates/${year}/${month}/${day}/${ts}_${safe}`
}

/**
 * Resolve credenciais AWS usando o RPC webhook_resolve_aws_credentials.
 * O RPC já implementa o fallback empresa filha → empresa mãe (SECURITY DEFINER),
 * garantindo que empresas filhas sem credenciais próprias usem as da mãe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAwsCredentials(svc: any, companyId: string): Promise<AwsCreds | null> {
  const { data, error } = await svc
    .rpc('webhook_resolve_aws_credentials', { p_company_id: companyId })

  if (error || !data || data.length === 0) return null

  return data[0] as AwsCreds
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'POST') return jsonError(res, 405, 'Método não permitido')

  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  // Parse body
  let body: Record<string, unknown> = {}
  try {
    const raw = (req as any).body // eslint-disable-line @typescript-eslint/no-explicit-any
    body = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
  } catch {
    return jsonError(res, 400, 'Body inválido')
  }

  const { filename, contentType, companyId } = body as {
    filename?:    string
    contentType?: string
    companyId?:   string
  }

  if (!filename || !contentType || !companyId) {
    return jsonError(res, 400, 'filename, contentType e companyId são obrigatórios')
  }

  // Membership — valida antes de qualquer operação S3
  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  try {
    const credentials = await getAwsCredentials(svc, companyId)

    if (!credentials) {
      return jsonError(res, 422, 'Credenciais AWS não encontradas para esta empresa. Configure as credenciais em Configurações > Integrações > AWS.')
    }

    const s3Key     = generateS3Key(companyId, filename)
    const mediaType = resolveMediaType(contentType)

    const s3Client = new S3Client({
      region: credentials.region,
      credentials: {
        accessKeyId:     credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    // Presigned PUT URL — expira em 5 minutos (tempo suficiente para o upload)
    const command = new PutObjectCommand({
      Bucket:      credentials.bucket,
      Key:         s3Key,
      ContentType: contentType,
    })

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 })
    const directUrl    = `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${s3Key}`

    return res.status(200).json({
      presignedUrl,
      s3Key,
      mediaType,
      directUrl,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    console.error('[upload-media] error:', message)
    return jsonError(res, 500, 'Erro ao preparar upload de mídia')
  }
}

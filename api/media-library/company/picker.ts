// =============================================================================
// GET /api/media-library/company/picker
//
// Lista arquivos de mídia S3 da empresa para uso no picker de modelos.
//
// Parâmetros de query:
//   company_id  — obrigatório (validado via auth + assertMembership)
//   file_type   — opcional: image | video | audio | document
//   search      — opcional: filtro por nome de arquivo
//   page        — opcional: número da página (padrão 1)
//   limit       — opcional: itens por página (padrão 50, máx 200)
//
// Segurança:
//   - Bearer token obrigatório
//   - company_id validado via assertMembership (nunca confiado sem validação)
//   - service_role usado apenas após auth + membership
//   - preview_url nos arquivos retornados é apenas para exibição interna no modal
// =============================================================================

import type { IncomingMessage, ServerResponse }  from 'http'
import { S3Client, ListObjectsV2Command }         from '@aws-sdk/client-s3'
import { getSupabaseAdmin }                       from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
}                                                 from '../../lib/dashboard/auth.js'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface S3PickerFile {
  id:                string
  s3_key:            string
  original_filename: string
  file_type:         'image' | 'video' | 'audio' | 'document'
  mime_type:         string
  file_size:         number
  preview_url:       string
  created_at:        string
}

interface AwsCredentials {
  access_key_id:     string
  secret_access_key: string
  region:            string
  bucket:            string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TYPES = ['image', 'video', 'audio', 'document'] as const
type ValidType = (typeof VALID_TYPES)[number]

const MEDIA_EXTENSIONS: Record<ValidType, string[]> = {
  image:    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
  video:    ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
  audio:    ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'rtf'],
}

const ALL_MEDIA_EXT = new Set(Object.values(MEDIA_EXTENSIONS).flat())

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv', flv: 'video/x-flv', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
  m4a: 'audio/mp4', flac: 'audio/flac',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function detectFileType(filename: string): ValidType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  for (const [type, exts] of Object.entries(MEDIA_EXTENSIONS)) {
    if ((exts as string[]).includes(ext)) return type as ValidType
  }
  return 'document'
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

function generateStaticUrl(s3Key: string, region: string, bucket: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`
}

// ---------------------------------------------------------------------------
// Obter credenciais AWS da empresa (com fallback para env vars)
// ---------------------------------------------------------------------------

async function getCompanyCredentials(svc: ReturnType<typeof getSupabaseAdmin>, companyId: string): Promise<AwsCredentials> {
  const { data } = await svc
    .from('aws_credentials')
    .select('access_key_id, secret_access_key, region, bucket')
    .eq('company_id', companyId)
    .maybeSingle()

  if (data?.access_key_id && data?.secret_access_key) {
    return {
      access_key_id:     data.access_key_id as string,
      secret_access_key: data.secret_access_key as string,
      region:            (data.region as string) || 'sa-east-1',
      bucket:            (data.bucket as string) || 'aws-lovoocrm-media',
    }
  }

  return {
    access_key_id:     process.env.AWS_ACCESS_KEY_ID     ?? '',
    secret_access_key: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    region:            process.env.AWS_REGION            ?? 'sa-east-1',
    bucket:            process.env.AWS_S3_BUCKET         ?? 'aws-lovoocrm-media',
  }
}

// ---------------------------------------------------------------------------
// Listar objetos S3 da empresa
// ---------------------------------------------------------------------------

async function listCompanyS3Files(companyId: string, creds: AwsCredentials): Promise<S3PickerFile[]> {
  const s3 = new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId:     creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  })

  const prefix = `clientes/${companyId}/`

  const command = new ListObjectsV2Command({
    Bucket:  creds.bucket,
    Prefix:  prefix,
    MaxKeys: 1000,
  })

  const response = await s3.send(command)

  if (!response.Contents || response.Contents.length === 0) {
    return []
  }

  return response.Contents
    .filter(obj => {
      if (!obj.Key || obj.Key === prefix) return false
      const filename = obj.Key.split('/').pop()
      if (!filename) return false
      const ext = filename.split('.').pop()?.toLowerCase()
      return ext ? ALL_MEDIA_EXT.has(ext) : false
    })
    .map(obj => {
      const filename = obj.Key!.split('/').pop()!
      return {
        id:                `s3_${obj.Key!.replace(/[^a-zA-Z0-9]/g, '_')}`,
        s3_key:            obj.Key!,
        original_filename: filename,
        file_type:         detectFileType(filename),
        mime_type:         getMimeType(filename),
        file_size:         obj.Size ?? 0,
        preview_url:       generateStaticUrl(obj.Key!, creds.region, creds.bucket),
        created_at:        obj.LastModified?.toISOString() ?? new Date().toISOString(),
      }
    })
}

// ---------------------------------------------------------------------------
// Handler principal
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

  const q = (req as any).query as Record<string, string>

  const companyId = q?.company_id
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  // Parâmetros de filtragem/paginação
  const fileTypeParam = q?.file_type
  const search        = (q?.search ?? '').trim()
  const page          = Math.max(1, parseInt(q?.page ?? '1', 10) || 1)
  const limit         = Math.min(200, Math.max(1, parseInt(q?.limit ?? '50', 10) || 50))

  const filterType = fileTypeParam && (VALID_TYPES as readonly string[]).includes(fileTypeParam)
    ? fileTypeParam as ValidType
    : undefined

  try {
    const creds = await getCompanyCredentials(svc, companyId)

    if (!creds.access_key_id) {
      console.error('[picker] Credenciais AWS não configuradas para empresa:', companyId)
      return jsonError(res, 500, 'Credenciais de armazenamento não configuradas')
    }

    let files = await listCompanyS3Files(companyId, creds)

    // Aplicar filtro de tipo
    if (filterType) {
      files = files.filter(f => f.file_type === filterType)
    }

    // Aplicar filtro de busca
    if (search) {
      const lowerSearch = search.toLowerCase()
      files = files.filter(f => f.original_filename.toLowerCase().includes(lowerSearch))
    }

    // Ordenar por data decrescente (mais recentes primeiro)
    files.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Paginação
    const totalCount  = files.length
    const totalPages  = Math.ceil(totalCount / limit)
    const offset      = (page - 1) * limit
    const pagedFiles  = files.slice(offset, offset + limit)

    return res.status(200).json({
      files: pagedFiles,
      pagination: {
        page,
        limit,
        total:       totalCount,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: {
        company_id: companyId,
        file_type:  filterType ?? 'all',
        search,
      },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    console.error('[picker] Erro ao listar arquivos:', message)
    return jsonError(res, 500, 'Erro ao listar arquivos da biblioteca')
  }
}

// =============================================================================
// GET /api/media-library/company/picker
//
// Lista arquivos de mídia da empresa a partir da tabela company_media_library.
// Usado pelo picker de modelos de mensagem (Configurações > Modelos).
//
// Parâmetros de query:
//   company_id  — obrigatório (validado via auth + assertMembership)
//   file_type   — opcional: image | video | audio | document
//   search      — opcional: filtro por original_filename (ILIKE)
//   page        — opcional: número da página (padrão 1)
//   limit       — opcional: itens por página (padrão 50, máx 200)
//
// Segurança:
//   - Bearer token obrigatório
//   - company_id validado via assertMembership antes de qualquer query
//   - service_role usado apenas após auth + membership validados
//   - preview_url retornada apenas para exibição interna no modal (não persistida)
//
// Fonte de verdade: company_media_library (sem ListObjectsV2 / sem s3:ListBucket)
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { getSupabaseAdmin }                     from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
}                                               from '../../lib/dashboard/auth.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VALID_FILE_TYPES = ['image', 'video', 'audio', 'document'] as const
type ValidFileType = (typeof VALID_FILE_TYPES)[number]

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string> },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'GET') return jsonError(res, 405, 'Método não permitido')

  // Auth — Bearer token obrigatório
  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const q = (req as any).query as Record<string, string>

  const companyId = q?.company_id
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  // Membership — validação obrigatória antes de qualquer query de dados
  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  // Parâmetros de filtragem e paginação
  const fileTypeParam = q?.file_type
  const search        = (q?.search ?? '').trim()
  const page          = Math.max(1, parseInt(q?.page  ?? '1',  10) || 1)
  const limit         = Math.min(200, Math.max(1, parseInt(q?.limit ?? '50', 10) || 50))
  const offset        = (page - 1) * limit

  const filterType: ValidFileType | undefined =
    fileTypeParam && (VALID_FILE_TYPES as readonly string[]).includes(fileTypeParam)
      ? (fileTypeParam as ValidFileType)
      : undefined

  try {
    // #region agent log
    console.log('[DBG-picker] handler-entry', { companyId, fileType: fileTypeParam, search, page, limit })
    // #endregion

    // -----------------------------------------------------------------------
    // Contar total (para paginação)
    // -----------------------------------------------------------------------

    let countQuery = svc
      .from('company_media_library')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)

    if (filterType) {
      countQuery = countQuery.eq('file_type', filterType)
    }
    if (search) {
      countQuery = countQuery.ilike('original_filename', `%${search}%`)
    }

    const { count, error: countErr } = await countQuery

    if (countErr) {
      // #region agent log
      console.error('[DBG-picker] count-error', { error: countErr.message })
      // #endregion
      return jsonError(res, 500, 'Erro ao contar arquivos da biblioteca')
    }

    const totalCount = count ?? 0
    const totalPages = Math.ceil(totalCount / limit)

    // -----------------------------------------------------------------------
    // Buscar arquivos paginados
    // -----------------------------------------------------------------------

    let filesQuery = svc
      .from('company_media_library')
      .select('id, original_filename, s3_key, file_type, mime_type, file_size, preview_url, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filterType) {
      filesQuery = filesQuery.eq('file_type', filterType)
    }
    if (search) {
      filesQuery = filesQuery.ilike('original_filename', `%${search}%`)
    }

    const { data: files, error: filesErr } = await filesQuery

    if (filesErr) {
      // #region agent log
      console.error('[DBG-picker] files-error', { error: filesErr.message })
      // #endregion
      return jsonError(res, 500, 'Erro ao buscar arquivos da biblioteca')
    }

    // #region agent log
    console.log('[DBG-picker] files-ok', { totalCount, returned: files?.length ?? 0 })
    // #endregion

    return res.status(200).json({
      files: files ?? [],
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
    // #region agent log
    console.error('[DBG-picker] catch-error', { errorMessage: message })
    // #endregion
    return jsonError(res, 500, 'Erro ao carregar arquivos da biblioteca')
  }
}

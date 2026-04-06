/**
 * Mídias estruturadas do catálogo (vínculo a company_media_library).
 * Sem duplicação de arquivos no S3; RLS por tenant.
 */

import { supabase } from '../lib/supabase'

export const CATALOG_MEDIA_USAGE_ROLES = [
  'presentation',
  'demo',
  'proof',
  'testimonial',
  'before_after',
] as const

export type CatalogMediaUsageRole = (typeof CATALOG_MEDIA_USAGE_ROLES)[number]

export type CatalogItemMediaResolved = {
  id: string
  company_id: string
  product_id: string | null
  service_id: string | null
  library_asset_id: string
  media_type: 'image' | 'video'
  usage_role: CatalogMediaUsageRole
  sort_order: number
  is_active: boolean
  use_in_ai: boolean
  metadata: Record<string, unknown>
  s3_key: string
  preview_url: string | null
  original_filename: string
  library_file_type: string
}

export type CompanyLibraryAssetPicker = {
  id: string
  original_filename: string
  file_type: string
  preview_url: string | null
  mime_type: string
}

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

export const catalogMediaApi = {
  async listResolved(
    companyId: string,
    params: { productId?: string | null; serviceId?: string | null }
  ): Promise<CatalogItemMediaResolved[]> {
    const { data, error } = await supabase.rpc('get_catalog_item_media', {
      p_company_id: companyId,
      p_product_id: params.productId ?? null,
      p_service_id: params.serviceId ?? null,
    })
    if (error) throw error
    const rows = (data || []) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id),
      company_id: String(r.company_id),
      product_id: r.product_id != null ? String(r.product_id) : null,
      service_id: r.service_id != null ? String(r.service_id) : null,
      library_asset_id: String(r.library_asset_id),
      media_type: r.media_type === 'video' ? 'video' : 'image',
      usage_role: String(r.usage_role) as CatalogMediaUsageRole,
      sort_order: Number(r.sort_order ?? 0),
      is_active: Boolean(r.is_active),
      use_in_ai: Boolean(r.use_in_ai),
      metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<
        string,
        unknown
      >,
      s3_key: String(r.s3_key ?? ''),
      preview_url: r.preview_url != null ? String(r.preview_url) : null,
      original_filename: String(r.original_filename ?? ''),
      library_file_type: String(r.library_file_type ?? ''),
    }))
  },

  async listLibraryAssetsForPicker(companyId: string): Promise<CompanyLibraryAssetPicker[]> {
    const { data, error } = await supabase
      .from('company_media_library')
      .select('id, original_filename, file_type, preview_url, mime_type')
      .eq('company_id', companyId)
      .in('file_type', ['image', 'video'])
      .order('original_filename', { ascending: true })
      .limit(500)
    if (error) throw error
    return (data || []) as CompanyLibraryAssetPicker[]
  },

  async addLink(params: {
    companyId: string
    productId: string | null
    serviceId: string | null
    libraryAssetId: string
    mediaType: 'image' | 'video'
    usageRole: CatalogMediaUsageRole
    sortOrder?: number
    isActive?: boolean
    useInAi?: boolean
  }): Promise<void> {
    const row = {
      company_id: params.companyId,
      product_id: params.productId,
      service_id: params.serviceId,
      library_asset_id: params.libraryAssetId,
      media_type: params.mediaType,
      usage_role: params.usageRole,
      sort_order: params.sortOrder ?? 0,
      is_active: params.isActive ?? true,
      use_in_ai: params.useInAi ?? true,
      metadata: {},
    }
    const { error } = await supabase.from('catalog_item_media').insert(row)
    if (error) {
      if (isPostgresUniqueViolation(error)) {
        throw new Error('Esta mídia já está vinculada com a mesma função para este item.')
      }
      throw error
    }
  },

  async update(
    id: string,
    patch: Partial<{
      usage_role: CatalogMediaUsageRole
      sort_order: number
      is_active: boolean
      use_in_ai: boolean
      metadata: Record<string, unknown>
    }>
  ): Promise<void> {
    const { error } = await supabase.from('catalog_item_media').update(patch).eq('id', id)
    if (error) {
      if (isPostgresUniqueViolation(error)) {
        throw new Error('Já existe outra mídia com o mesmo arquivo e função para este item.')
      }
      throw error
    }
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('catalog_item_media').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Retorna a primeira imagem ativa (menor sort_order) de cada item do tipo informado.
   * Usado na listagem do catálogo para exibir thumbnail ao lado do nome.
   */
  async getThumbnails(
    companyId: string,
    type: 'product' | 'service'
  ): Promise<Record<string, string>> {
    const { data, error } = await supabase.rpc('get_catalog_thumbnails', {
      p_company_id: companyId,
      p_type: type,
    })
    if (error) throw error
    const rows = (data || []) as { item_id: string; preview_url: string | null }[]
    return Object.fromEntries(
      rows
        .filter((r) => r.item_id && r.preview_url)
        .map((r) => [r.item_id, r.preview_url as string])
    )
  },
}

/**
 * CRUD de categorias do catálogo.
 * RLS por company_id — sem RPCs adicionais.
 * Categoria é opcional: produtos/serviços sem categoria_id permanecem válidos.
 */

import { supabase } from '../lib/supabase'
import type { CatalogCategory } from '../types/sales-funnel'

export const catalogCategoriesApi = {
  /**
   * Lista categorias ativas de um tipo específico, ordenadas por sort_order e nome.
   */
  async list(companyId: string, type: 'product' | 'service'): Promise<CatalogCategory[]> {
    const { data, error } = await supabase
      .from('catalog_categories')
      .select('*')
      .eq('company_id', companyId)
      .eq('type', type)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) throw error
    return (data || []) as CatalogCategory[]
  },

  /**
   * Lista todas as categorias da empresa (ambos os tipos), incluindo inativas.
   * Usado na aba de gestão de categorias.
   */
  async listAll(companyId: string): Promise<CatalogCategory[]> {
    const { data, error } = await supabase
      .from('catalog_categories')
      .select('*')
      .eq('company_id', companyId)
      .order('type', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) throw error
    return (data || []) as CatalogCategory[]
  },

  async create(
    companyId: string,
    type: 'product' | 'service',
    name: string,
    sortOrder = 0
  ): Promise<CatalogCategory> {
    const { data, error } = await supabase
      .from('catalog_categories')
      .insert({ company_id: companyId, type, name: name.trim(), sort_order: sortOrder })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') {
        throw new Error(`Já existe uma categoria "${name}" para este tipo.`)
      }
      throw error
    }
    return data as CatalogCategory
  },

  async update(
    id: string,
    patch: Partial<Pick<CatalogCategory, 'name' | 'is_active' | 'sort_order'>>
  ): Promise<CatalogCategory> {
    const payload: Record<string, unknown> = {}
    if (patch.name !== undefined) payload.name = patch.name.trim()
    if (patch.is_active !== undefined) payload.is_active = patch.is_active
    if (patch.sort_order !== undefined) payload.sort_order = patch.sort_order

    const { data, error } = await supabase
      .from('catalog_categories')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) {
      if (error.code === '23505') {
        throw new Error('Já existe uma categoria com este nome para este tipo.')
      }
      throw error
    }
    return data as CatalogCategory
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('catalog_categories').delete().eq('id', id)
    if (error) throw error
  },
}

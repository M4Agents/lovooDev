/**
 * CRUD de fornecedores.
 * RLS por company_id (Trilha 1 — membership direto).
 * Remoção via soft delete (is_active = false).
 */

import { supabase } from '../lib/supabase'
import type { Supplier } from '../types/sales-funnel'

export type SupplierInput = Pick<Supplier, 'name'> &
  Partial<
    Pick<
      Supplier,
      | 'trade_name'
      | 'document'
      | 'document_type'
      | 'email'
      | 'phone'
      | 'website'
      | 'contact_name'
      | 'contact_phone'
      | 'address_street'
      | 'address_city'
      | 'address_state'
      | 'address_zip'
      | 'address_country'
      | 'notes'
      | 'is_active'
    >
  >

export const suppliersApi = {
  /** Lista fornecedores ativos da empresa, ordenados por nome. */
  async listActive(companyId: string): Promise<Supplier[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (error) throw error
    return (data || []) as Supplier[]
  },

  /** Lista todos os fornecedores da empresa (incluindo inativos). Usado na gestão. */
  async listAll(companyId: string): Promise<Supplier[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
    if (error) throw error
    return (data || []) as Supplier[]
  },

  async create(companyId: string, input: SupplierInput): Promise<Supplier> {
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        company_id: companyId,
        name: input.name.trim(),
        trade_name: input.trade_name?.trim() ?? null,
        document: input.document?.trim() ?? null,
        document_type: input.document_type ?? null,
        email: input.email?.trim() ?? null,
        phone: input.phone?.trim() ?? null,
        website: input.website?.trim() ?? null,
        contact_name: input.contact_name?.trim() ?? null,
        contact_phone: input.contact_phone?.trim() ?? null,
        address_street: input.address_street?.trim() ?? null,
        address_city: input.address_city?.trim() ?? null,
        address_state: input.address_state?.trim() ?? null,
        address_zip: input.address_zip?.trim() ?? null,
        address_country: input.address_country?.trim() ?? 'Brasil',
        notes: input.notes?.trim() ?? null,
        is_active: input.is_active ?? true,
      })
      .select()
      .single()
    if (error) throw error
    return data as Supplier
  },

  async update(id: string, companyId: string, patch: Partial<SupplierInput>): Promise<Supplier> {
    const payload: Record<string, unknown> = {}
    if (patch.name !== undefined) payload.name = patch.name.trim()
    if (patch.trade_name !== undefined) payload.trade_name = patch.trade_name?.trim() ?? null
    if (patch.document !== undefined) payload.document = patch.document?.trim() ?? null
    if (patch.document_type !== undefined) payload.document_type = patch.document_type ?? null
    if (patch.email !== undefined) payload.email = patch.email?.trim() ?? null
    if (patch.phone !== undefined) payload.phone = patch.phone?.trim() ?? null
    if (patch.website !== undefined) payload.website = patch.website?.trim() ?? null
    if (patch.contact_name !== undefined) payload.contact_name = patch.contact_name?.trim() ?? null
    if (patch.contact_phone !== undefined) payload.contact_phone = patch.contact_phone?.trim() ?? null
    if (patch.address_street !== undefined) payload.address_street = patch.address_street?.trim() ?? null
    if (patch.address_city !== undefined) payload.address_city = patch.address_city?.trim() ?? null
    if (patch.address_state !== undefined) payload.address_state = patch.address_state?.trim() ?? null
    if (patch.address_zip !== undefined) payload.address_zip = patch.address_zip?.trim() ?? null
    if (patch.address_country !== undefined) payload.address_country = patch.address_country?.trim() ?? null
    if (patch.notes !== undefined) payload.notes = patch.notes?.trim() ?? null
    if (patch.is_active !== undefined) payload.is_active = patch.is_active

    const { data, error } = await supabase
      .from('suppliers')
      .update(payload)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single()
    if (error) throw error
    return data as Supplier
  },

  /** Soft delete: marca is_active = false. */
  async remove(id: string, companyId: string): Promise<void> {
    const { error } = await supabase
      .from('suppliers')
      .update({ is_active: false })
      .eq('id', id)
      .eq('company_id', companyId)
    if (error) throw error
  },

  /** Busca um fornecedor pelo id, respeitando company_id. Retorna null se não encontrado. */
  async getById(id: string, companyId: string): Promise<Supplier | null> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()
    if (error) return null
    return data as Supplier
  },
}

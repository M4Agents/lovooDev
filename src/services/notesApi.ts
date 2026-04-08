import { supabase } from '../lib/supabase'

// =====================================================
// TIPOS
// =====================================================

export interface InternalNote {
  id: string
  company_id: string
  lead_id: number | null
  opportunity_id: string | null
  content: string
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

// Campos retornados nas queries (deleted_at excluído: RLS já filtra notas ativas)
const NOTE_FIELDS = 'id, company_id, lead_id, opportunity_id, content, created_by, updated_by, created_at, updated_at'

// =====================================================
// API
// Padrão: objeto com métodos async, consistente com tagsApi, funnelApi, etc.
// A policy RLS intnotes_select já filtra deleted_at IS NULL — sem necessidade
// de filtro extra no cliente.
// =====================================================

export const notesApi = {
  async getNotesByLead(companyId: string, leadId: number): Promise<InternalNote[]> {
    const { data, error } = await supabase
      .from('internal_notes')
      .select(NOTE_FIELDS)
      .eq('company_id', companyId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  async getNotesByOpportunity(companyId: string, opportunityId: string): Promise<InternalNote[]> {
    const { data, error } = await supabase
      .from('internal_notes')
      .select(NOTE_FIELDS)
      .eq('company_id', companyId)
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  async createNote(params: {
    companyId: string
    content: string
    leadId?: number
    opportunityId?: string
  }): Promise<InternalNote> {
    const payload: Record<string, unknown> = {
      company_id: params.companyId,
      content: params.content.trim(),
    }
    if (params.leadId !== undefined) payload.lead_id = params.leadId
    if (params.opportunityId !== undefined) payload.opportunity_id = params.opportunityId

    const { data, error } = await supabase
      .from('internal_notes')
      .insert(payload)
      .select(NOTE_FIELDS)
      .single()

    if (error) throw error
    return data
  },

  // Trigger protect_internal_note_immutable_fields garante que apenas o autor
  // pode alterar o content. Se chamado por não-autor, o banco lança exceção.
  async updateContent(noteId: string, content: string): Promise<void> {
    const { error } = await supabase
      .from('internal_notes')
      .update({ content: content.trim() })
      .eq('id', noteId)

    if (error) throw error
  },

  // Exclusão lógica via UPDATE em deleted_at.
  // Permitido para: autor da nota OU admin da empresa (policy intnotes_update).
  // Trigger protect_internal_note_immutable_fields impede admin de alterar content.
  async softDelete(noteId: string): Promise<void> {
    const { error } = await supabase
      .from('internal_notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', noteId)

    if (error) throw error
  },
}

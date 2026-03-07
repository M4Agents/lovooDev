// =====================================================
// API DE CALENDÁRIO
// =====================================================

import { supabase } from '../lib/supabase'
import type {
  LeadActivity,
  CalendarPermission,
  CalendarSettings,
  CreateActivityForm,
  UpdateActivityForm,
  CompleteActivityForm,
  CreatePermissionForm,
  UpdatePermissionForm,
  UpdateSettingsForm,
  ActivityFilter,
  CalendarUser
} from '../types/calendar'

export class CalendarApi {
  // =====================================================
  // ATIVIDADES
  // =====================================================

  /**
   * Criar nova atividade
   */
  static async createActivity(
    companyId: string,
    userId: string,
    data: CreateActivityForm
  ): Promise<LeadActivity> {
    try {
      const { data: result, error } = await supabase
        .from('lead_activities')
        .insert({
          company_id: companyId,
          owner_user_id: userId,
          created_by: userId,
          ...data
        })
        .select(`
          *,
          lead:leads(id, name, phone, email, company_name),
          owner_user:auth.users!owner_user_id(id, email),
          assigned_user:auth.users!assigned_to(id, email)
        `)
        .single()

      if (error) throw error
      return this.mapActivity(result)
    } catch (error) {
      console.error('Error creating activity:', error)
      throw error
    }
  }

  /**
   * Buscar atividades com filtros
   */
  static async getActivities(
    companyId: string,
    filter?: ActivityFilter
  ): Promise<LeadActivity[]> {
    try {
      let query = supabase
        .from('lead_activities')
        .select(`
          *,
          lead:leads(id, name, phone, email, company_name),
          owner_user:auth.users!owner_user_id(id, email),
          assigned_user:auth.users!assigned_to(id, email)
        `)
        .eq('company_id', companyId)

      // Filtros de data
      if (filter?.start_date) {
        query = query.gte('scheduled_date', filter.start_date.toISOString().split('T')[0])
      }
      if (filter?.end_date) {
        query = query.lte('scheduled_date', filter.end_date.toISOString().split('T')[0])
      }

      // Filtro de status
      if (filter?.status) {
        if (Array.isArray(filter.status)) {
          query = query.in('status', filter.status)
        } else {
          query = query.eq('status', filter.status)
        }
      }

      // Filtro de tipo
      if (filter?.activity_type) {
        if (Array.isArray(filter.activity_type)) {
          query = query.in('activity_type', filter.activity_type)
        } else {
          query = query.eq('activity_type', filter.activity_type)
        }
      }

      // Filtro de prioridade
      if (filter?.priority) {
        if (Array.isArray(filter.priority)) {
          query = query.in('priority', filter.priority)
        } else {
          query = query.eq('priority', filter.priority)
        }
      }

      // Filtro de responsável
      if (filter?.assigned_to) {
        query = query.eq('assigned_to', filter.assigned_to)
      }

      // Filtro de dono
      if (filter?.owner_user_id) {
        query = query.eq('owner_user_id', filter.owner_user_id)
      }

      // Filtro de lead
      if (filter?.lead_id) {
        query = query.eq('lead_id', filter.lead_id)
      }

      // Busca por texto
      if (filter?.search) {
        query = query.or(`title.ilike.%${filter.search}%,description.ilike.%${filter.search}%`)
      }

      query = query.order('scheduled_datetime', { ascending: true })

      const { data, error } = await query

      if (error) throw error
      return (data || []).map(this.mapActivity)
    } catch (error) {
      console.error('Error fetching activities:', error)
      throw error
    }
  }

  /**
   * Buscar atividade por ID
   */
  static async getActivity(activityId: string): Promise<LeadActivity | null> {
    try {
      const { data, error } = await supabase
        .from('lead_activities')
        .select(`
          *,
          lead:leads(id, name, phone, email, company_name),
          owner_user:auth.users!owner_user_id(id, email),
          assigned_user:auth.users!assigned_to(id, email)
        `)
        .eq('id', activityId)
        .single()

      if (error) throw error
      return data ? this.mapActivity(data) : null
    } catch (error) {
      console.error('Error fetching activity:', error)
      throw error
    }
  }

  /**
   * Atualizar atividade
   */
  static async updateActivity(
    activityId: string,
    data: UpdateActivityForm
  ): Promise<LeadActivity> {
    try {
      const { data: result, error } = await supabase
        .from('lead_activities')
        .update({
          ...data,
          updated_at: new Date().toISOString()
        })
        .eq('id', activityId)
        .select(`
          *,
          lead:leads(id, name, phone, email, company_name),
          owner_user:auth.users!owner_user_id(id, email),
          assigned_user:auth.users!assigned_to(id, email)
        `)
        .single()

      if (error) throw error
      return this.mapActivity(result)
    } catch (error) {
      console.error('Error updating activity:', error)
      throw error
    }
  }

  /**
   * Marcar atividade como concluída
   */
  static async completeActivity(
    activityId: string,
    userId: string,
    data?: CompleteActivityForm
  ): Promise<LeadActivity> {
    try {
      const { data: result, error } = await supabase
        .from('lead_activities')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: userId,
          completion_notes: data?.completion_notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', activityId)
        .select(`
          *,
          lead:leads(id, name, phone, email, company_name),
          owner_user:auth.users!owner_user_id(id, email),
          assigned_user:auth.users!assigned_to(id, email)
        `)
        .single()

      if (error) throw error
      return this.mapActivity(result)
    } catch (error) {
      console.error('Error completing activity:', error)
      throw error
    }
  }

  /**
   * Cancelar atividade
   */
  static async cancelActivity(activityId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('lead_activities')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', activityId)

      if (error) throw error
    } catch (error) {
      console.error('Error cancelling activity:', error)
      throw error
    }
  }

  /**
   * Deletar atividade
   */
  static async deleteActivity(activityId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('lead_activities')
        .delete()
        .eq('id', activityId)

      if (error) throw error
    } catch (error) {
      console.error('Error deleting activity:', error)
      throw error
    }
  }

  // =====================================================
  // PERMISSÕES DE CALENDÁRIO
  // =====================================================

  /**
   * Conceder permissão de visualização
   */
  static async grantPermission(
    companyId: string,
    ownerUserId: string,
    grantedBy: string,
    data: CreatePermissionForm
  ): Promise<CalendarPermission> {
    try {
      const { data: result, error } = await supabase
        .from('calendar_permissions')
        .insert({
          company_id: companyId,
          owner_user_id: ownerUserId,
          granted_by: grantedBy,
          ...data
        })
        .select(`
          *,
          viewer_user:auth.users!viewer_user_id(id, email),
          owner_user:auth.users!owner_user_id(id, email)
        `)
        .single()

      if (error) throw error
      return this.mapPermission(result)
    } catch (error) {
      console.error('Error granting permission:', error)
      throw error
    }
  }

  /**
   * Buscar permissões concedidas (quem pode ver meu calendário)
   */
  static async getMyPermissions(userId: string): Promise<CalendarPermission[]> {
    try {
      const { data, error } = await supabase
        .from('calendar_permissions')
        .select(`
          *,
          viewer_user:auth.users!viewer_user_id(id, email)
        `)
        .eq('owner_user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []).map(this.mapPermission)
    } catch (error) {
      console.error('Error fetching my permissions:', error)
      throw error
    }
  }

  /**
   * Buscar calendários que posso visualizar
   */
  static async getAccessibleCalendars(userId: string): Promise<CalendarUser[]> {
    try {
      const { data, error } = await supabase
        .from('calendar_permissions')
        .select(`
          permission_level,
          owner_user:auth.users!owner_user_id(id, email)
        `)
        .eq('viewer_user_id', userId)
        .eq('is_active', true)

      if (error) throw error
      
      return (data || []).map((p: any, index: number) => ({
        id: p.owner_user.id,
        email: p.owner_user.email,
        display_name: p.owner_user.display_name,
        profile_picture_url: p.owner_user.profile_picture_url,
        permission: p.permission_level,
        color: this.getUserColor(index + 1), // +1 porque índice 0 é o próprio usuário
        is_own: false
      }))
    } catch (error) {
      console.error('Error fetching accessible calendars:', error)
      throw error
    }
  }

  /**
   * Atualizar permissão
   */
  static async updatePermission(
    permissionId: string,
    data: UpdatePermissionForm
  ): Promise<CalendarPermission> {
    try {
      const { data: result, error } = await supabase
        .from('calendar_permissions')
        .update({
          ...data,
          updated_at: new Date().toISOString()
        })
        .eq('id', permissionId)
        .select(`
          *,
          viewer_user:auth.users!viewer_user_id(id, email)
        `)
        .single()

      if (error) throw error
      return this.mapPermission(result)
    } catch (error) {
      console.error('Error updating permission:', error)
      throw error
    }
  }

  /**
   * Revogar permissão
   */
  static async revokePermission(permissionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('calendar_permissions')
        .delete()
        .eq('id', permissionId)

      if (error) throw error
    } catch (error) {
      console.error('Error revoking permission:', error)
      throw error
    }
  }

  // =====================================================
  // CONFIGURAÇÕES DE CALENDÁRIO
  // =====================================================

  /**
   * Buscar configurações do usuário
   */
  static async getSettings(
    userId: string,
    companyId: string
  ): Promise<CalendarSettings | null> {
    try {
      const { data, error } = await supabase
        .from('calendar_settings')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .single()

      if (error) {
        // Se não existir, retornar null para criar depois
        if (error.code === 'PGRST116') return null
        throw error
      }

      return this.mapSettings(data)
    } catch (error) {
      console.error('Error fetching settings:', error)
      throw error
    }
  }

  /**
   * Criar configurações padrão
   */
  static async createSettings(
    userId: string,
    companyId: string
  ): Promise<CalendarSettings> {
    try {
      const { data, error } = await supabase
        .from('calendar_settings')
        .insert({
          user_id: userId,
          company_id: companyId
        })
        .select()
        .single()

      if (error) throw error
      return this.mapSettings(data)
    } catch (error) {
      console.error('Error creating settings:', error)
      throw error
    }
  }

  /**
   * Atualizar configurações
   */
  static async updateSettings(
    userId: string,
    companyId: string,
    data: UpdateSettingsForm
  ): Promise<CalendarSettings> {
    try {
      const { data: result, error } = await supabase
        .from('calendar_settings')
        .update({
          ...data,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .select()
        .single()

      if (error) throw error
      return this.mapSettings(result)
    } catch (error) {
      console.error('Error updating settings:', error)
      throw error
    }
  }

  // =====================================================
  // HELPERS E MAPEADORES
  // =====================================================

  private static mapActivity(data: any): LeadActivity {
    return {
      ...data,
      scheduled_datetime: new Date(data.scheduled_datetime),
      completed_at: data.completed_at ? new Date(data.completed_at) : undefined,
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    }
  }

  private static mapPermission(data: any): CalendarPermission {
    return {
      ...data,
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    }
  }

  private static mapSettings(data: any): CalendarSettings {
    return {
      ...data,
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    }
  }

  private static getUserColor(index: number): string {
    const colors = [
      '#3B82F6', // blue
      '#10B981', // green
      '#F59E0B', // amber
      '#EF4444', // red
      '#8B5CF6', // violet
      '#EC4899', // pink
      '#14B8A6', // teal
      '#F97316', // orange
      '#6366F1', // indigo
      '#84CC16'  // lime
    ]
    return colors[index % colors.length]
  }

  /**
   * Buscar atividades do dia
   */
  static async getTodayActivities(
    companyId: string,
    userId: string
  ): Promise<LeadActivity[]> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    return this.getActivities(companyId, {
      start_date: today,
      end_date: tomorrow,
      owner_user_id: userId,
      status: 'pending'
    })
  }

  /**
   * Contar atividades pendentes do dia
   */
  static async getTodayActivitiesCount(
    companyId: string,
    userId: string
  ): Promise<number> {
    try {
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]

      const { count, error } = await supabase
        .from('lead_activities')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('owner_user_id', userId)
        .eq('scheduled_date', todayStr)
        .eq('status', 'pending')

      if (error) throw error
      return count || 0
    } catch (error) {
      console.error('Error counting today activities:', error)
      return 0
    }
  }
}

export const calendarApi = CalendarApi

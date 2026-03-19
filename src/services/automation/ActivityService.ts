// =====================================================
// SERVICE: ACTIVITY SERVICE
// Data: 19/03/2026
// Objetivo: Gerenciar atividades via automação
// =====================================================

import { supabase } from '../../lib/supabase'
import type { ActivityType, ActivityStatus, ActivityPriority } from '../../types/calendar'

interface CreateActivityParams {
  leadId: number
  companyId: string
  userId: string
  title: string
  activityType: ActivityType
  scheduledDate: string
  scheduledTime: string
  description?: string
  durationMinutes?: number
  assignedTo?: string
  reminderMinutes?: number
  priority?: ActivityPriority
  syncToGoogle?: boolean
}

interface ActivityFilter {
  leadId?: number
  status?: ActivityStatus | ActivityStatus[]
  activityType?: ActivityType
  scheduledAfter?: string
  scheduledBefore?: string
}

interface ActivityUpdates {
  title?: string
  description?: string
  activityType?: ActivityType
  scheduledDate?: string
  scheduledTime?: string
  assignedTo?: string
  priority?: ActivityPriority
  status?: ActivityStatus
}

export class ActivityService {
  async createActivity(params: CreateActivityParams): Promise<any> {
    const scheduledDatetime = new Date(`${params.scheduledDate}T${params.scheduledTime}:00`)
    
    const { data, error } = await supabase
      .from('lead_activities')
      .insert({
        company_id: params.companyId,
        lead_id: params.leadId,
        owner_user_id: params.userId,
        created_by: params.userId,
        assigned_to: params.assignedTo || params.userId,
        title: params.title,
        description: params.description,
        activity_type: params.activityType,
        scheduled_date: params.scheduledDate,
        scheduled_time: params.scheduledTime,
        scheduled_datetime: scheduledDatetime.toISOString(),
        duration_minutes: params.durationMinutes || 30,
        status: 'pending',
        reminder_minutes: params.reminderMinutes || 15,
        priority: params.priority || 'medium',
        visibility: 'shared',
        sync_to_google: params.syncToGoogle || false,
        notification_sent: false
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  async updateActivities(companyId: string, filter: ActivityFilter, updates: ActivityUpdates): Promise<number> {
    let query = supabase
      .from('lead_activities')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)

    if (filter.leadId) query = query.eq('lead_id', filter.leadId)
    if (filter.status) {
      Array.isArray(filter.status) ? query = query.in('status', filter.status) : query = query.eq('status', filter.status)
    }
    if (filter.activityType) query = query.eq('activity_type', filter.activityType)
    if (filter.scheduledAfter) query = query.gte('scheduled_date', filter.scheduledAfter)
    if (filter.scheduledBefore) query = query.lte('scheduled_date', filter.scheduledBefore)

    const { data, error } = await query.select()
    if (error) throw error
    return data?.length || 0
  }

  async completeActivities(companyId: string, userId: string, filter: ActivityFilter, notes?: string): Promise<number> {
    let query = supabase
      .from('lead_activities')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: userId,
        completion_notes: notes,
        updated_at: new Date().toISOString()
      })
      .eq('company_id', companyId)

    if (filter.leadId) query = query.eq('lead_id', filter.leadId)
    if (filter.status) {
      Array.isArray(filter.status) ? query = query.in('status', filter.status) : query = query.eq('status', filter.status)
    }
    if (filter.activityType) query = query.eq('activity_type', filter.activityType)

    const { data, error } = await query.select()
    if (error) throw error
    return data?.length || 0
  }

  async cancelActivities(companyId: string, filter: ActivityFilter, reason?: string): Promise<number> {
    let query = supabase
      .from('lead_activities')
      .update({
        status: 'cancelled',
        completion_notes: reason,
        updated_at: new Date().toISOString()
      })
      .eq('company_id', companyId)

    if (filter.leadId) query = query.eq('lead_id', filter.leadId)
    if (filter.status) {
      Array.isArray(filter.status) ? query = query.in('status', filter.status) : query = query.eq('status', filter.status)
    }
    if (filter.activityType) query = query.eq('activity_type', filter.activityType)
    if (filter.scheduledAfter) query = query.gte('scheduled_date', filter.scheduledAfter)

    const { data, error } = await query.select()
    if (error) throw error
    return data?.length || 0
  }

  async rescheduleActivities(companyId: string, filter: ActivityFilter, daysOffset: number, newTime?: string): Promise<number> {
    let query = supabase.from('lead_activities').select().eq('company_id', companyId)

    if (filter.leadId) query = query.eq('lead_id', filter.leadId)
    if (filter.status) {
      Array.isArray(filter.status) ? query = query.in('status', filter.status) : query = query.eq('status', filter.status)
    }
    if (filter.activityType) query = query.eq('activity_type', filter.activityType)

    const { data: activities, error: fetchError } = await query
    if (fetchError) throw fetchError
    if (!activities || activities.length === 0) return 0

    const updates = activities.map(activity => {
      const currentDate = new Date(activity.scheduled_date)
      currentDate.setDate(currentDate.getDate() + daysOffset)
      const newDate = currentDate.toISOString().split('T')[0]
      const time = newTime || activity.scheduled_time
      
      return supabase
        .from('lead_activities')
        .update({
          scheduled_date: newDate,
          scheduled_time: time,
          scheduled_datetime: new Date(`${newDate}T${time}:00`).toISOString(),
          status: 'rescheduled',
          updated_at: new Date().toISOString()
        })
        .eq('id', activity.id)
    })

    await Promise.all(updates)
    return activities.length
  }
}

export const activityService = new ActivityService()

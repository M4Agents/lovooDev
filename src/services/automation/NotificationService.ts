import { supabase } from '../../lib/supabase'

export interface SendNotificationParams {
  companyId: string
  userId: string
  title: string
  message: string
  notificationType?: 'info' | 'success' | 'warning' | 'error'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  actionType?: string
  actionData?: any
  source?: string
  sourceFlowId?: string
  leadId?: number
  opportunityId?: string
}

class NotificationService {
  async sendNotification(params: SendNotificationParams) {
    const { data, error } = await supabase.from('system_notifications').insert({
      company_id: params.companyId,
      user_id: params.userId,
      title: params.title,
      message: params.message,
      notification_type: params.notificationType || 'info',
      priority: params.priority || 'normal',
      action_type: params.actionType,
      action_data: params.actionData,
      source: params.source || 'automation',
      source_flow_id: params.sourceFlowId,
      lead_id: params.leadId,
      opportunity_id: params.opportunityId,
      status: 'sent'
    }).select().single()

    if (error) throw error
    return data
  }

  async resolveRecipients(recipientType: string, context: any): Promise<string[]> {
    const recipients: string[] = []

    if (recipientType === 'owner' && context.triggerData?.owner_user_id) {
      recipients.push(context.triggerData.owner_user_id)
    } else if (recipientType === 'specific' && context.specificUserId) {
      recipients.push(context.specificUserId)
    } else if (recipientType === 'all_team') {
      const { data } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', context.companyId)
        .eq('is_active', true)
      
      if (data) recipients.push(...data.map(u => u.user_id))
    }

    return recipients
  }
}

export const notificationService = new NotificationService()

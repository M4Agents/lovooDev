import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const companyId = req.headers['x-company-id'] || req.query.company_id;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  try {
    if (req.method === 'GET') {
      const { data: notifications, error } = await supabase
        .from('duplicate_notifications')
        .select('id, lead_id, duplicate_of_lead_id, reason, created_at')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Erro ao buscar notificações', details: error.message });
      }

      let enrichedNotifications = [];

      if (notifications && notifications.length > 0) {
        const leadIds = new Set();
        notifications.forEach(notif => {
          leadIds.add(notif.lead_id);
          leadIds.add(notif.duplicate_of_lead_id);
        });

        const { data: leads, error: leadsError } = await supabase
          .rpc('get_leads_for_notifications', {
            p_lead_ids: Array.from(leadIds),
            p_company_id: companyId
          });

        if (leadsError) {
          console.error('Erro ao buscar leads:', leadsError);
        }

        const leadsMap = new Map();
        if (leads) {
          leads.forEach(lead => leadsMap.set(lead.id, lead));
        }

        enrichedNotifications = notifications
          .filter(notif => {
            const leadNew = leadsMap.get(notif.lead_id);
            const leadExisting = leadsMap.get(notif.duplicate_of_lead_id);
            return leadNew && leadExisting;
          })
          .map(notif => {
            const leadNew = leadsMap.get(notif.lead_id);
            const leadExisting = leadsMap.get(notif.duplicate_of_lead_id);

            let duplicateFieldValue = '';
            let reasonLabel = '';

            if (notif.reason === 'phone') {
              duplicateFieldValue = leadNew?.phone || leadExisting?.phone || '';
              reasonLabel = 'Telefone';
            } else if (notif.reason === 'email') {
              duplicateFieldValue = leadNew?.email || leadExisting?.email || '';
              reasonLabel = 'Email';
            }

            return {
              notification_id: notif.id,
              lead_id: notif.lead_id,
              lead_name: leadNew?.name || 'Lead não encontrado',
              lead_email: leadNew?.email || '',
              lead_phone: leadNew?.phone || '',
              duplicate_of_lead_id: notif.duplicate_of_lead_id,
              duplicate_name: leadExisting?.name || 'Lead não encontrado',
              duplicate_email: leadExisting?.email || '',
              duplicate_phone: leadExisting?.phone || '',
              reason: notif.reason,
              reason_label: reasonLabel,
              duplicate_field_value: duplicateFieldValue,
              created_at: notif.created_at
            };
          });
      }

      return res.status(200).json({
        success: true,
        notifications: enrichedNotifications,
        count: enrichedNotifications.length
      });
    }

    if (req.method === 'PUT') {
      const { notification_id, status, user_id } = req.body;

      if (!notification_id || !status) {
        return res.status(400).json({ error: 'notification_id e status são obrigatórios' });
      }

      const { error } = await supabase
        .from('duplicate_notifications')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: user_id || null
        })
        .eq('id', notification_id)
        .eq('company_id', companyId);

      if (error) {
        return res.status(500).json({ error: 'Erro ao atualizar notificação', details: error.message });
      }

      return res.status(200).json({ success: true, message: 'Notificação atualizada com sucesso' });
    }

    return res.status(405).json({ error: 'Método não permitido' });

  } catch (error) {
    console.error('Erro na API de notificações:', error);
    return res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
  }
}

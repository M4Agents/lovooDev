import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Helpers de auth ──────────────────────────────────────────────────────────

function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function getUserFromToken(token) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, error: new Error('Configuração de servidor incompleta') };
  }
  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  return { user: user ?? null, error: error ?? null };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  const companyId = req.headers['x-company-id'] || req.query.company_id;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // ── Autenticação JWT ──────────────────────────────────────────────────────
  const token = extractToken(req.headers['authorization']);
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação obrigatório' });
  }

  const { user, error: authError } = await getUserFromToken(token);
  if (!user || authError) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey);

  // ── Validar membership (Trilha 1 + Trilha 2) ─────────────────────────────
  const { data: member } = await svc
    .from('company_users')
    .select('role, permissions')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  // Trilha 2: super_admin/system_admin da empresa pai
  let effectiveMember = member;
  if (!member) {
    const { data: companyData } = await svc
      .from('companies')
      .select('parent_company_id')
      .eq('id', companyId)
      .maybeSingle();

    if (companyData?.parent_company_id) {
      const { data: parentMember } = await svc
        .from('company_users')
        .select('role, permissions')
        .eq('user_id', user.id)
        .eq('company_id', companyData.parent_company_id)
        .eq('is_active', true)
        .in('role', ['super_admin', 'system_admin'])
        .maybeSingle();
      effectiveMember = parentMember ?? null;
    }
  }

  if (!effectiveMember) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  // ── Verificar restrição de leads por responsável ──────────────────────────
  const { data: companySettings } = await svc
    .from('companies')
    .select('restrict_leads_to_owner')
    .eq('id', companyId)
    .maybeSingle();

  const hasViewAllLeads = effectiveMember.permissions?.view_all_leads === true;
  const isRestricted =
    companySettings?.restrict_leads_to_owner === true &&
    !hasViewAllLeads &&
    !['admin', 'super_admin', 'system_admin'].includes(effectiveMember.role);

  try {
    // ── GET: buscar notificações ────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data: notifications, error } = await svc
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

        const { data: leads, error: leadsError } = await svc
          .rpc('get_leads_for_notifications', {
            p_lead_ids: Array.from(leadIds),
            p_company_id: companyId,
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
            if (!leadNew || !leadExisting) return false;
            // Se restrito, mostrar apenas notificações onde AMBOS os leads pertencem ao usuário
            if (isRestricted) {
              return (
                leadNew.responsible_user_id === user.id &&
                leadExisting.responsible_user_id === user.id
              );
            }
            return true;
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
              created_at: notif.created_at,
            };
          });
      }

      return res.status(200).json({
        success: true,
        notifications: enrichedNotifications,
        count: enrichedNotifications.length,
      });
    }

    // ── PUT: atualizar status da notificação (ignorar) ──────────────────────
    if (req.method === 'PUT') {
      const { notification_id, status } = req.body;

      if (!notification_id || !status) {
        return res.status(400).json({ error: 'notification_id e status são obrigatórios' });
      }

      // Se restrito, verificar se os leads da notificação pertencem ao usuário
      if (isRestricted) {
        const { data: notifData } = await svc
          .from('duplicate_notifications')
          .select('lead_id, duplicate_of_lead_id')
          .eq('id', notification_id)
          .eq('company_id', companyId)
          .maybeSingle();

        if (!notifData) {
          return res.status(404).json({ error: 'Notificação não encontrada' });
        }

        const { data: notifLeads } = await svc
          .rpc('get_leads_for_notifications', {
            p_lead_ids: [notifData.lead_id, notifData.duplicate_of_lead_id],
            p_company_id: companyId,
          });

        const leadsMap = new Map((notifLeads || []).map(l => [l.id, l]));
        const leadA = leadsMap.get(notifData.lead_id);
        const leadB = leadsMap.get(notifData.duplicate_of_lead_id);

        const bothAssigned =
          leadA?.responsible_user_id === user.id &&
          leadB?.responsible_user_id === user.id;

        if (!bothAssigned) {
          return res.status(403).json({ error: 'Acesso negado: leads não atribuídos a você' });
        }
      }

      const { error } = await svc
        .from('duplicate_notifications')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: user.id,
        })
        .eq('id', notification_id)
        .eq('company_id', companyId);

      if (error) {
        return res.status(500).json({ error: 'Erro ao atualizar notificação', details: error.message });
      }

      return res.status(200).json({ success: true, message: 'Notificação atualizada com sucesso' });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('Erro na API de notificações:', err);
    return res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
  }
}

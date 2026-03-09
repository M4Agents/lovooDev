// =====================================================
// GOOGLE CALENDAR EVENT CONVERTER
// Converte entre lead_activities e Google Calendar Events
// =====================================================

/**
 * Converte atividade do sistema para evento do Google Calendar
 */
export function activityToGoogleEvent(activity, timezone = 'America/Sao_Paulo') {
  // Combinar data e hora no formato correto para o timezone local
  // Formato: YYYY-MM-DDTHH:mm:ss (sem Z no final para não ser interpretado como UTC)
  const startDateTime = `${activity.scheduled_date}T${activity.scheduled_time}:00`;
  
  // Calcular fim baseado na duração
  const [hours, minutes] = activity.scheduled_time.split(':');
  const durationMinutes = activity.duration_minutes || 30;
  const totalMinutes = parseInt(hours) * 60 + parseInt(minutes) + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}:00`;
  const endDateTime = `${activity.scheduled_date}T${endTime}`;

  // Mapear tipo de atividade para cor do Google Calendar
  const colorId = getColorIdForActivityType(activity.activity_type);

  // Criar descrição rica
  const description = buildEventDescription(activity);

  return {
    summary: activity.title,
    description: description,
    start: {
      dateTime: startDateTime,
      timeZone: timezone
    },
    end: {
      dateTime: endDateTime,
      timeZone: timezone
    },
    colorId: colorId,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: activity.reminder_minutes || 15 }
      ]
    },
    // Metadados privados para rastreamento
    extendedProperties: {
      private: {
        lovoo_activity_id: activity.id,
        lovoo_lead_id: activity.lead_id?.toString() || '',
        lovoo_activity_type: activity.activity_type,
        lovoo_priority: activity.priority
      }
    }
  };
}

/**
 * Constrói descrição detalhada do evento
 */
function buildEventDescription(activity) {
  const parts = [];

  // Descrição principal
  if (activity.description) {
    parts.push(activity.description);
    parts.push('');
  }

  // Informações do lead
  if (activity.lead) {
    parts.push('📋 INFORMAÇÕES DO LEAD:');
    if (activity.lead.name) parts.push(`Nome: ${activity.lead.name}`);
    if (activity.lead.company_name) parts.push(`Empresa: ${activity.lead.company_name}`);
    if (activity.lead.phone) parts.push(`Telefone: ${activity.lead.phone}`);
    if (activity.lead.email) parts.push(`Email: ${activity.lead.email}`);
    parts.push('');
  }

  // Tipo de atividade
  parts.push(`Tipo: ${getActivityTypeLabel(activity.activity_type)}`);
  
  // Prioridade
  parts.push(`Prioridade: ${getPriorityLabel(activity.priority)}`);

  // Status
  if (activity.status !== 'pending') {
    parts.push(`Status: ${getStatusLabel(activity.status)}`);
  }

  // Rodapé
  parts.push('');
  parts.push('---');
  parts.push('📅 Sincronizado via LovoCRM');

  return parts.join('\n');
}

/**
 * Mapeia tipo de atividade para cor do Google Calendar
 */
function getColorIdForActivityType(type) {
  const colorMap = {
    'call': '9',        // Azul
    'meeting': '10',    // Verde
    'email': '6',       // Laranja
    'task': '11',       // Vermelho
    'follow_up': '5',   // Amarelo
    'demo': '3',        // Roxo
    'other': '8'        // Cinza
  };
  return colorMap[type] || '1'; // Padrão: Lavanda
}

/**
 * Labels amigáveis para tipos de atividade
 */
function getActivityTypeLabel(type) {
  const labels = {
    'call': '📞 Ligação',
    'meeting': '🤝 Reunião',
    'email': '📧 Email',
    'task': '✅ Tarefa',
    'follow_up': '🔄 Follow-up',
    'demo': '🎯 Demonstração',
    'other': '📌 Outro'
  };
  return labels[type] || type;
}

/**
 * Labels amigáveis para prioridade
 */
function getPriorityLabel(priority) {
  const labels = {
    'low': '🟢 Baixa',
    'medium': '🟡 Média',
    'high': '🟠 Alta',
    'urgent': '🔴 Urgente'
  };
  return labels[priority] || priority;
}

/**
 * Labels amigáveis para status
 */
function getStatusLabel(status) {
  const labels = {
    'pending': '⏳ Pendente',
    'completed': '✅ Concluída',
    'cancelled': '❌ Cancelada',
    'rescheduled': '🔄 Reagendada'
  };
  return labels[status] || status;
}

/**
 * Converte evento do Google Calendar para atividade do sistema
 * (Para uso futuro na sincronização bidirecional)
 */
export function googleEventToActivity(event, companyId, userId) {
  // Extrair data e hora do início
  const startDateTime = new Date(event.start.dateTime || event.start.date);
  const scheduled_date = startDateTime.toISOString().split('T')[0];
  const scheduled_time = startDateTime.toTimeString().slice(0, 5);

  // Calcular duração
  const endDateTime = new Date(event.end.dateTime || event.end.date);
  const duration_minutes = Math.round((endDateTime - startDateTime) / (1000 * 60));

  // Extrair metadados se existirem
  const privateProps = event.extendedProperties?.private || {};

  return {
    company_id: companyId,
    owner_user_id: userId,
    created_by: userId,
    title: event.summary || 'Evento sem título',
    description: event.description || '',
    activity_type: privateProps.lovoo_activity_type || 'other',
    scheduled_date,
    scheduled_time,
    duration_minutes,
    priority: privateProps.lovoo_priority || 'medium',
    reminder_minutes: event.reminders?.overrides?.[0]?.minutes || 15,
    google_event_id: event.id,
    sync_to_google: true
  };
}

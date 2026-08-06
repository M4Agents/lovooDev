// =====================================================
// Tipos do Relatório do Agente de IA
// Espelha o retorno JSONB da RPC get_agent_report
// =====================================================

export interface AgentReportKpis {
  total_sessions: number
  completed_sessions: number
  completion_rate: number
  avg_messages_sent: number
  total_followups_sent: number
  total_credits_used: number
  avg_credits_per_session: number
  human_handoffs: number
  human_handoff_rate: number
}

export interface AgentHourlyEntry {
  hour: number
  session_count: number
}

export interface AgentDailyEntry {
  date: string
  sessions: number
  credits: number
  human_handoffs: number
}

export interface AgentAssignmentEntry {
  assignment_id: string
  display_name: string
  is_active: boolean
  session_count: number
  avg_messages: number
  total_credits: number
  human_handoffs: number
  human_handoff_rate: number
}

export interface AgentReport {
  kpis: AgentReportKpis
  hourly_distribution: AgentHourlyEntry[]
  daily_trend: AgentDailyEntry[]
  assignment_breakdown: AgentAssignmentEntry[]
}

// =====================================================
// AGENT REPORT API SERVICE
// Chama a RPC get_agent_report via Supabase client autenticado.
// Nunca usa service_role no frontend.
// =====================================================

import { supabase } from '../lib/supabase'
import type { AgentReport } from '../types/agent-report'

export const agentReportApi = {
  async getReport(
    companyId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<AgentReport> {
    const { data, error } = await supabase.rpc('get_agent_report', {
      p_company_id: companyId,
      p_date_from:  dateFrom.toISOString(),
      p_date_to:    dateTo.toISOString(),
    })

    if (error) throw error

    return data as AgentReport
  },
}

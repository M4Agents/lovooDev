/**
 * agentDocumentsAuth.ts
 *
 * Guard de autenticação para upload e processamento de documentos RAG
 * de Company Agents (agentes de empresas filhas).
 *
 * Diferença do guard existente (assertCanManageOpenAIIntegration):
 *   - Não exige membership na empresa pai
 *   - Valida que o agente pertence à empresa do caller (multi-tenant)
 *   - Retorna cliente service_role para operações que precisam bypass RLS
 *
 * Fluxo de validação:
 *   1. Extrai JWT do header Authorization
 *   2. Valida sessão via cliente anon
 *   3. Usa service_role para buscar company_id do agente
 *   4. Valida membership ativa + role do caller na empresa do agente
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://etzdsywunlpbgxkphuil.supabase.co'

const WRITE_ROLES = ['admin', 'system_admin', 'super_admin']

export type AgentDocumentsAuthSuccess = {
  ok:              true
  userId:          string
  role:            string
  callerCompanyId: string
  svcSupabase:     SupabaseClient
}

export type AgentDocumentsAuthFailure = {
  ok:      false
  status:  401 | 403 | 404
  message: string
}

export type AgentDocumentsAuthResult = AgentDocumentsAuthSuccess | AgentDocumentsAuthFailure

/**
 * Valida que o caller:
 *   - tem JWT válido
 *   - é membro ativo com role admin/system_admin/super_admin na empresa do agente
 *   - o agente (agentId) pertence à empresa do caller
 *
 * Retorna svcSupabase (service_role) para que o handler use nas operações subsequentes,
 * evitando dependência de políticas RLS que podem não cobrir empresas filhas.
 */
export async function assertCanManageAgentDocuments(
  req: { headers?: Record<string, string | string[] | undefined> },
  agentId: string
): Promise<AgentDocumentsAuthResult> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const anonKey    =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''

  if (!serviceKey || !anonKey) {
    return { ok: false, status: 403, message: 'Configuração de servidor incompleta' }
  }

  // ── Extrair Bearer token ───────────────────────────────────────────────────

  const rawAuth = req.headers?.authorization
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth ?? ''

  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Autenticação necessária' }
  }

  // ── Clientes Supabase ──────────────────────────────────────────────────────

  const svc = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // ── 1. Validar sessão JWT ─────────────────────────────────────────────────

  const { data: { user }, error: authErr } = await callerClient.auth.getUser()
  if (authErr || !user) {
    return { ok: false, status: 401, message: 'Sessão inválida ou expirada' }
  }

  // ── 2. Buscar company_id do agente via service_role ───────────────────────
  //
  // Usa service_role para não depender de RLS de lovoo_agents que pode variar.
  // Garante que agentes de qualquer empresa sejam acessíveis ao pipeline.

  const { data: agent } = await svc
    .from('lovoo_agents')
    .select('id, company_id')
    .eq('id', agentId.trim())
    .maybeSingle()

  if (!agent) {
    return { ok: false, status: 404, message: 'Agente não encontrado' }
  }

  // ── 3. Validar membership do caller na empresa do agente ──────────────────
  //
  // Usa JWT do caller (RLS aplicado) — garante que somente membros ativos
  // com role compatível consigam gerenciar documentos do agente.

  const { data: membership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id',   user.id)
    .eq('company_id', agent.company_id)
    .eq('is_active',  true)
    .maybeSingle()

  if (!membership || !WRITE_ROLES.includes(membership.role)) {
    return {
      ok:      false,
      status:  403,
      message: 'Permissão insuficiente — requer admin, system_admin ou super_admin na empresa do agente',
    }
  }

  return {
    ok:              true,
    userId:          user.id,
    role:            membership.role,
    callerCompanyId: agent.company_id,
    svcSupabase:     svc,
  }
}

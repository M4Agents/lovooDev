// =============================================================================
// DELETE /api/companies/:id
//
// Soft delete de empresa cliente (filha).
// Aplica deleted_at + deleted_by sem alterar status (sem hard delete).
//
// ROTA DINÂMICA VERCEL: req.query.id contém o :id da URL
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin em empresa do tipo 'parent'
//   Partner bloqueado explicitamente com 403
//
// VALIDAÇÕES:
//   - company_type = 'client'                     (nunca deletar empresa pai)
//   - parent_company_id = empresa pai do caller   (isolamento multi-tenant)
//   - deleted_at IS NULL                          (evitar double delete)
//
// SOFT DELETE:
//   UPDATE companies SET deleted_at = NOW(), deleted_by = user.id
//   Status NÃO é alterado — constraint aceita apenas active/suspended/cancelled
//
// SEGURANÇA:
//   - JWT validado via svc.auth.getUser(token)
//   - id vem apenas do parâmetro de rota — nunca do body ou query string
//   - Dupla camada: auth_user_is_platform_admin + validação explícita de membership
//   - service_role apenas neste backend
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
    console.error('[companies/delete] Variáveis de ambiente Supabase não configuradas')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // ── 1. Autenticação ─────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' })
  }
  const userToken = authHeader.slice(7)

  const svc = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authError } = await svc.auth.getUser(userToken)
  if (authError || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. ID da empresa alvo (parâmetro de rota) ───────────────────────────────
  const { id: companyId } = req.query
  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'ID da empresa é obrigatório na rota' })
  }

  // ── 3. Autorização ──────────────────────────────────────────────────────────
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // Primeira camada
  const { data: isPlatformAdmin, error: adminCheckError } = await supabaseUser
    .rpc('auth_user_is_platform_admin')

  if (adminCheckError) {
    console.error('[companies/delete] Erro ao verificar auth_user_is_platform_admin:', adminCheckError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões do usuário' })
  }

  if (!isPlatformAdmin) {
    return res.status(403).json({ error: 'Permissão insuficiente' })
  }

  // Segunda camada: validar role e obter empresa pai do caller
  const { data: membership, error: membershipError } = await svc
    .from('company_users')
    .select('role, company_id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .eq('companies.company_type', 'parent')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (membershipError || !membership) {
    return res.status(403).json({ error: 'Usuário não possui role válido em empresa parent' })
  }

  // Partner check explícito
  if (membership.role === 'partner') {
    return res.status(403).json({ error: 'Partner não pode excluir empresas' })
  }

  const callerParentCompanyId = membership.company_id

  // ── 4. Buscar e validar a empresa alvo ──────────────────────────────────────
  const { data: targetCompany, error: fetchError } = await svc
    .from('companies')
    .select('id, company_type, parent_company_id, name, deleted_at')
    .eq('id', companyId)
    .single()

  if (fetchError || !targetCompany) {
    return res.status(404).json({ error: 'Empresa não encontrada' })
  }

  if (targetCompany.company_type !== 'client') {
    return res.status(400).json({ error: 'Apenas empresas do tipo client podem ser excluídas' })
  }

  if (targetCompany.parent_company_id !== callerParentCompanyId) {
    return res.status(403).json({ error: 'Empresa não pertence à sua empresa pai' })
  }

  if (targetCompany.deleted_at !== null) {
    return res.status(409).json({ error: 'Empresa já foi excluída anteriormente' })
  }

  // ── 5. Soft delete ──────────────────────────────────────────────────────────
  const { error: updateError } = await svc
    .from('companies')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    })
    .eq('id', companyId)
    .eq('company_type', 'client')         // guard extra
    .is('deleted_at', null)               // guard: evitar double delete

  if (updateError) {
    console.error('[companies/delete] Erro ao aplicar soft delete:', updateError.message, { companyId })
    return res.status(500).json({ error: 'Erro ao excluir empresa' })
  }

  console.log('[companies/delete] Soft delete aplicado:', {
    companyId,
    companyName:     targetCompany.name,
    deletedBy:       user.id,
    parentCompanyId: callerParentCompanyId,
  })

  return res.status(200).json({
    success:    true,
    company_id: companyId,
    message:    `Empresa "${targetCompany.name}" excluída com sucesso`,
  })
}

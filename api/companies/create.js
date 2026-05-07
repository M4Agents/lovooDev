// =============================================================================
// POST /api/companies/create
//
// Cria empresa cliente (filha) de forma unificada.
// Suporta criação opcional de usuário admin no mesmo request.
//
// BODY (JSON):
//   {
//     "name":          string   (obrigatório)
//     "domain"?:       string   (opcional)
//     "createAdmin"?:  boolean  (opcional, default false)
//     "adminEmail"?:   string   (obrigatório se createAdmin = true)
//   }
//
// FLUXO COM ADMIN (createAdmin = true):
//   1. Validar JWT + role (super_admin / system_admin — partner rejeitado)
//   2. Derivar parentCompanyId do banco via auth.uid()
//   3. auth.admin.createUser → cria auth user sem senha
//   4. auth.admin.generateLink({ type: 'invite' }) → gera invite link
//   5. RPC create_client_company_with_admin_safe → empresa + trial + admin (transacional)
//   6. Se RPC falhar → rollback do auth user criado no passo 3
//
// FLUXO SEM ADMIN (createAdmin = false ou ausente):
//   1-2. Igual ao acima
//   3. RPC create_client_company_with_admin_safe com p_admin_user_id = null
//
// RESPOSTA (201):
//   {
//     "company_id":    "<uuid>",
//     "trial_started": boolean,
//     "trial_end":     string | null,
//     "admin_created": boolean,
//     "admin_email":   string | null,
//     "invite_link":   string | null   (link de uso único — não salvo em banco)
//   }
//
// SEGURANÇA:
//   - JWT validado via svc.auth.getUser(token)
//   - parentCompanyId derivado do banco — nunca aceito do frontend
//   - Partner bloqueado explicitamente com 403
//   - service_role usado apenas neste backend
//   - invite_link não é logado nem salvo em banco
//   - Dupla camada: backend + RPC SECURITY DEFINER
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// URL base do app para o redirectTo do invite link
const APP_URL = process.env.NEXT_PUBLIC_APP_URL
  ?? process.env.VITE_APP_URL
  ?? 'https://app.lovoocrm.com'

const RPC_ERROR_MAP = {
  'unauthenticated':
    { status: 401, msg: 'Não autenticado' },
  'parent company not found':
    { status: 400, msg: 'Empresa pai não encontrada' },
  'target is not a parent company':
    { status: 400, msg: 'Empresa informada não é do tipo parent' },
  'forbidden: apenas super_admin ou system_admin podem criar empresas client via este endpoint':
    { status: 403, msg: 'Apenas super_admin ou system_admin podem criar empresas cliente' },
  'no active super_admin found in parent company':
    { status: 500, msg: 'Empresa pai não possui super_admin ativo' },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
    console.error('[companies/create] Variáveis de ambiente Supabase não configuradas')
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

  // ── 2. Parse do body ────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body inválido' })
  }

  const { name, domain, createAdmin = false, adminEmail } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name é obrigatório' })
  }

  if (createAdmin) {
    if (!adminEmail || typeof adminEmail !== 'string' || !adminEmail.includes('@')) {
      return res.status(400).json({ error: 'adminEmail válido é obrigatório quando createAdmin = true' })
    }
  }

  // ── 3. Autorização — verificar role explicitamente ──────────────────────────
  // Não confiar apenas em auth_user_is_platform_admin().
  // Buscar membership real em company_users com is_active = true.
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // Primeira camada: RPC de plataforma
  const { data: isPlatformAdmin, error: adminCheckError } = await supabaseUser
    .rpc('auth_user_is_platform_admin')

  if (adminCheckError) {
    console.error('[companies/create] Erro ao verificar auth_user_is_platform_admin:', adminCheckError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões do usuário' })
  }

  if (!isPlatformAdmin) {
    return res.status(403).json({ error: 'Apenas super_admin ou system_admin podem criar empresas cliente' })
  }

  // Segunda camada: validar role explícito e derivar parentCompanyId
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

  // Partner check explícito — extra safety
  if (membership.role === 'partner') {
    return res.status(403).json({ error: 'Partner não pode criar empresas cliente via este endpoint' })
  }

  const parentCompanyId = membership.company_id

  // ── 4. Criar auth user para o admin (se solicitado) ─────────────────────────
  let adminUserId       = null
  let inviteLink        = null
  let adminUserCreated  = false

  if (createAdmin) {
    const { data: newUser, error: createUserError } = await svc.auth.admin.createUser({
      email:         adminEmail.trim().toLowerCase(),
      email_confirm: false,
    })

    if (createUserError || !newUser?.user) {
      console.error('[companies/create] Erro ao criar auth user:', createUserError?.message)
      return res.status(500).json({ error: 'Erro ao criar usuário administrador' })
    }

    adminUserId      = newUser.user.id
    adminUserCreated = true

    // Gerar invite link (type='invite') — link de uso único, não salvo em banco
    try {
      const { data: linkData, error: linkError } = await svc.auth.admin.generateLink({
        type:    'invite',
        email:   adminEmail.trim().toLowerCase(),
        options: { redirectTo: `${APP_URL}/login` },
      })

      if (!linkError && linkData?.properties?.action_link) {
        inviteLink = linkData.properties.action_link
      }
    } catch (linkErr) {
      // invite link é opcional — não bloqueia a criação
      console.warn('[companies/create] Falha ao gerar invite link (não crítico):', linkErr?.message)
    }
  }

  // ── 5. Criar empresa via nova RPC transacional ──────────────────────────────
  // Tudo ocorre atomicamente: empresa + trial + super_admin + admin (se houver)
  // Se a RPC falhar após createUser, o auth user é deletado (rollback)
  try {
    const { data: rpcResult, error: rpcError } = await supabaseUser
      .rpc('create_client_company_with_admin_safe', {
        p_parent_company_id: parentCompanyId,
        p_name:              name.trim(),
        p_domain:            domain?.trim() ?? null,
        p_admin_user_id:     adminUserId,
      })

    if (rpcError) {
      console.error('[companies/create] Erro na RPC:', rpcError.message, { name, parentCompanyId })

      // Rollback do auth user criado neste request
      if (adminUserCreated && adminUserId) {
        await svc.auth.admin.deleteUser(adminUserId).catch(e =>
          console.error('[companies/create] Falha no rollback do auth user:', e?.message)
        )
      }

      return res.status(500).json({ error: 'Erro ao criar empresa' })
    }

    if (!rpcResult?.success) {
      const errCode = rpcResult?.error ?? 'unknown_error'
      const mapped  = RPC_ERROR_MAP[errCode]

      console.warn('[companies/create] RPC retornou success=false:', { errCode, name, parentCompanyId })

      // Rollback do auth user criado neste request
      if (adminUserCreated && adminUserId) {
        await svc.auth.admin.deleteUser(adminUserId).catch(e =>
          console.error('[companies/create] Falha no rollback do auth user:', e?.message)
        )
      }

      return res.status(mapped?.status ?? 400).json({ error: mapped?.msg ?? errCode })
    }

    const companyId = rpcResult.company_id

    console.log('[companies/create] Empresa criada com sucesso:', {
      companyId,
      parentCompanyId,
      trial_started: rpcResult.trial_started,
      trial_end:     rpcResult.trial_end,
      admin_linked:  rpcResult.admin_linked,
      // invite_link não é logado por segurança
    })

    return res.status(201).json({
      company_id:    companyId,
      trial_started: rpcResult.trial_started  ?? false,
      trial_end:     rpcResult.trial_end       ?? null,
      admin_created: rpcResult.admin_linked    ?? false,
      admin_email:   adminUserCreated ? adminEmail.trim().toLowerCase() : null,
      invite_link:   inviteLink,  // null se não foi criado ou se falhou
    })

  } catch (err) {
    console.error('[companies/create] Erro interno:', err)

    // Rollback do auth user criado neste request
    if (adminUserCreated && adminUserId) {
      await svc.auth.admin.deleteUser(adminUserId).catch(e =>
        console.error('[companies/create] Falha no rollback do auth user:', e?.message)
      )
    }

    return res.status(500).json({ error: 'Erro interno ao criar empresa' })
  }
}

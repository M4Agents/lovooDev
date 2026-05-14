// =============================================================================
// POST /api/admin/sync-contact-photos-batch
//
// Migra em lote os contatos da empresa cujo profile_picture_url ainda aponta
// para URL temporária do CDN do WhatsApp, baixando e salvando permanentemente
// no Supabase Storage (bucket contact-avatars).
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin (membership direto ou via parent admin)
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",   (obrigatório)
//     "limit":      10          (opcional — default 10, máximo 20)
//   }
//
// RESPOSTA (200):
//   {
//     "processed": number,
//     "updated":   number,
//     "skipped":   number,
//     "errors":    number,
//     "has_more":  boolean
//   }
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth (assinatura + expiração)
//   - Role buscada diretamente em company_users (fonte de verdade)
//   - Trilha 2: se sem membership direto, valida auth_user_is_parent_admin via RPC
//   - service_role utilizado SOMENTE após autorização completa
//   - Nunca sobrescreve URL permanente já armazenada no Storage
//   - Logs sem tokens, apiKeys ou URLs sensíveis completas
// =============================================================================

import { createClient }  from '@supabase/supabase-js'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL         ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const ALLOWED_ROLES    = new Set(['super_admin', 'system_admin'])
const DEFAULT_LIMIT    = 10
const MAX_LIMIT        = 20

// ── helpers ──────────────────────────────────────────────────────────────────

function buildAnonClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })
}

function buildServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Autenticação — JWT ────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' })
  }
  const token = authHeader.slice(7)

  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
    console.error('[batch-photos] Variáveis de ambiente do Supabase não configuradas')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // Usamos service_role para chamar getUser (valida assinatura + expiração do JWT)
  const svcClient = buildServiceClient()
  const { data: { user }, error: authError } = await svcClient.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Parse do body ─────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body JSON inválido' })
  }

  const { company_id: companyId, limit: rawLimit } = body

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'company_id obrigatório' })
  }

  const limit = Math.min(
    Math.max(1, Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  // ── 3. Autorização ───────────────────────────────────────────────────────
  // Trilha 1: membership direto em company_users para a empresa alvo
  // Trilha 2: se sem membership direto, verificar se é parent admin via RPC
  //
  // O cliente com o JWT do usuário garante que auth.uid() == user.id
  // dentro das chamadas ao banco (necessário para as funções SECURITY DEFINER).
  const userClient = buildAnonClient(token)

  const { data: membership, error: memberErr } = await userClient
    .from('company_users')
    .select('role, is_active')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberErr) {
    console.error('[batch-photos] erro ao verificar membership:', memberErr.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  let authorized = false

  if (membership && membership.is_active && ALLOWED_ROLES.has(membership.role)) {
    // Trilha 1 aprovada
    authorized = true
  } else {
    // Trilha 2: pode ser super_admin/system_admin de empresa parent
    const { data: isParentAdmin, error: parentErr } = await userClient
      .rpc('auth_user_is_parent_admin', { p_company_id: companyId })

    if (parentErr) {
      console.error('[batch-photos] erro ao verificar parent admin:', parentErr.message)
      return res.status(500).json({ error: 'Erro ao validar permissões' })
    }

    if (isParentAdmin) {
      // Confirmar que o role na empresa do caller é permitido
      // (auth_user_is_parent_admin já garante super_admin ou system_admin,
      //  mas buscamos para auditoria e dupla garantia)
      const { data: callerMemberships } = await userClient
        .from('company_users')
        .select('role, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .in('role', Array.from(ALLOWED_ROLES))
        .limit(1)

      authorized = Array.isArray(callerMemberships) && callerMemberships.length > 0
    }
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Acesso negado: requer super_admin ou system_admin' })
  }

  // ── 4. Processamento — apenas a partir daqui usamos service_role ─────────
  const { isWhatsAppCdnPhoto, downloadAndStorePhoto } = _require('../../lib/photoSync.cjs')

  // Buscar contatos com URL temporária, ordenados pelo mais antigo primeiro
  // (estratégia conservadora: processa os contatos sem atualização há mais tempo).
  const { data: contacts, error: fetchErr } = await svcClient
    .from('chat_contacts')
    .select('id, phone_number, profile_picture_url, photo_updated_at, company_id')
    .eq('company_id', companyId)
    .filter('profile_picture_url', 'not.is', null)
    .order('photo_updated_at', { ascending: true, nullsFirst: true })
    .limit(limit + 1) // +1 para detectar has_more

  if (fetchErr) {
    console.error('[batch-photos] erro ao buscar contatos:', fetchErr.message)
    return res.status(500).json({ error: 'Erro ao buscar contatos' })
  }

  // Filtrar apenas os que têm URL de CDN temporário
  const allWithCdn = (contacts ?? []).filter(c => isWhatsAppCdnPhoto(c.profile_picture_url))
  const hasMore    = allWithCdn.length > limit
  const batch      = allWithCdn.slice(0, limit)

  let processed = 0
  let updated   = 0
  let skipped   = 0
  let errors    = 0

  for (const contact of batch) {
    processed++
    try {
      const permanentUrl = await downloadAndStorePhoto(
        svcClient,
        contact.profile_picture_url,
        contact.company_id,
        contact.phone_number,
      )

      const { error: updErr } = await svcClient
        .from('chat_contacts')
        .update({
          profile_picture_url: permanentUrl,
          photo_updated_at:    new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        })
        .eq('id', contact.id)

      if (updErr) {
        console.error('[batch-photos] erro ao atualizar contato', contact.id, ':', updErr.message)
        errors++
      } else {
        console.log('[batch-photos] foto migrada, contato:', contact.id)
        updated++
      }
    } catch (err) {
      // URL provavelmente expirada — skip sem chamar Uazapi
      console.warn('[batch-photos] download falhou, contato:', contact.id, '—', err.message)
      skipped++
    }
  }

  console.log(`[batch-photos] concluído — company:${companyId} processed:${processed} updated:${updated} skipped:${skipped} errors:${errors}`)

  return res.status(200).json({ processed, updated, skipped, errors, has_more: hasMore })
}

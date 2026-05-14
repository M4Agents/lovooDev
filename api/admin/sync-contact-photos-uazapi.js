// =============================================================================
// POST /api/admin/sync-contact-photos-uazapi
//
// Migra em lote fotos de contatos cujo profile_picture_url está ausente ou
// com URL CDN expirada, buscando a foto atual via API Uazapi e salvando
// permanentemente no Supabase Storage (bucket contact-avatars).
//
// Uso provisório para migração retroativa de bases existentes.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin (direto ou via parent admin)
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",   (obrigatório)
//     "limit":      10          (opcional — default 10, máximo 10)
//   }
//
// RESPOSTA (200):
//   { "processed", "updated", "skipped", "errors", "has_more" }
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth
//   - Role buscada em company_users (Trilha 1) ou auth_user_is_parent_admin (Trilha 2)
//   - service_role utilizado SOMENTE após autorização completa
//   - api_key da empresa NUNCA exposta em logs ou respostas
// =============================================================================

import { createClient }  from '@supabase/supabase-js'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL         ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const ALLOWED_ROLES = new Set(['super_admin', 'system_admin'])
const MAX_LIMIT     = 10  // conservador — cada chamada Uazapi leva ~2-3s
const DEFAULT_LIMIT = 10

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

  // ── 1. Autenticação ──────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' })
  }
  const token = authHeader.slice(7)

  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
    console.error('[uazapi-photos] Variáveis de ambiente não configuradas')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

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

  // ── 3. Autorização (Trilha 1 + Trilha 2) ────────────────────────────────
  const userClient = buildAnonClient(token)

  const { data: membership, error: memberErr } = await userClient
    .from('company_users')
    .select('role, is_active')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberErr) {
    console.error('[uazapi-photos] erro ao verificar membership:', memberErr.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  let authorized = false

  if (membership && membership.is_active && ALLOWED_ROLES.has(membership.role)) {
    authorized = true
  } else {
    const { data: isParentAdmin, error: parentErr } = await userClient
      .rpc('auth_user_is_parent_admin', { p_company_id: companyId })

    if (parentErr) {
      console.error('[uazapi-photos] erro ao verificar parent admin:', parentErr.message)
      return res.status(500).json({ error: 'Erro ao validar permissões' })
    }

    if (isParentAdmin) {
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

  // ── 4. Buscar instância conectada e api_key da empresa ───────────────────
  // A partir daqui apenas service_role
  const { data: instanceRow, error: instErr } = await svcClient
    .from('whatsapp_life_instances')
    .select('id, provider_instance_id')
    .eq('company_id', companyId)
    .eq('status', 'connected')
    .not('provider_instance_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (instErr || !instanceRow) {
    console.error('[uazapi-photos] nenhuma instância conectada encontrada para company:', companyId)
    return res.status(422).json({ error: 'Nenhuma instância WhatsApp conectada para esta empresa' })
  }

  const { data: companyRow, error: companyErr } = await svcClient
    .from('companies')
    .select('api_key')
    .eq('id', companyId)
    .single()

  if (companyErr || !companyRow?.api_key) {
    console.error('[uazapi-photos] api_key não encontrada para company:', companyId)
    return res.status(422).json({ error: 'API key Uazapi não configurada para esta empresa' })
  }

  // ── 5. Buscar contatos sem foto permanente ───────────────────────────────
  const { isWhatsAppCdnPhoto, downloadAndStorePhoto, fetchPhotoFromUazapi } =
    _require('../../lib/photoSync.cjs')

  // Busca contatos com foto ausente OU CDN expirada, ordenados pelo mais antigo
  const { data: contacts, error: fetchErr } = await svcClient
    .from('chat_contacts')
    .select('id, phone_number, profile_picture_url, photo_updated_at, company_id')
    .eq('company_id', companyId)
    .or('profile_picture_url.is.null,profile_picture_url.ilike.%pps.whatsapp.net%,profile_picture_url.ilike.%mmg.whatsapp.net%')
    .order('photo_updated_at', { ascending: true, nullsFirst: true })
    .limit(limit + 1)

  if (fetchErr) {
    console.error('[uazapi-photos] erro ao buscar contatos:', fetchErr.message)
    return res.status(500).json({ error: 'Erro ao buscar contatos' })
  }

  const hasMore   = (contacts ?? []).length > limit
  const batch     = (contacts ?? []).slice(0, limit)

  // #region agent log — diagnóstico Uazapi (remover após confirmar)
  // Faz uma chamada direta à API Uazapi para o primeiro contato do lote
  // e expõe o status HTTP + estrutura da resposta (sem apikey completa).
  let _probe = null
  if (batch.length > 0) {
    try {
      const probePhone = batch[0].phone_number
      const probeUrl   = `https://lovoo.uazapi.com/chat/GetNameAndImageURL/${instanceRow.provider_instance_id}`
      const probeRes   = await fetch(probeUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': companyRow.api_key },
        body:    JSON.stringify({ phone: probePhone }),
      })
      const probeBody = await probeRes.json().catch(() => null)
      _probe = {
        http_status:   probeRes.status,
        phone_sent:    probePhone,
        instance_used: instanceRow.provider_instance_id,
        api_key_prefix: companyRow.api_key ? companyRow.api_key.slice(0, 6) + '…' : null,
        response_keys:  probeBody ? Object.keys(probeBody) : null,
        success_field:  probeBody?.success,
        has_data:       !!probeBody?.data,
        data_keys:      probeBody?.data ? Object.keys(probeBody.data) : null,
        profilePictureUrl_present: !!(probeBody?.data?.profilePictureUrl),
      }
      console.log('[uazapi-photos] probe:', JSON.stringify(_probe))
    } catch (e) {
      _probe = { probe_error: e.message }
    }
  }
  // #endregion

  let processed = 0
  let updated   = 0
  let skipped   = 0
  let errors    = 0

  for (const contact of batch) {
    processed++
    try {
      // Buscar foto atual via Uazapi
      const freshUrl = await fetchPhotoFromUazapi(
        instanceRow.provider_instance_id,
        companyRow.api_key,
        contact.phone_number,
      )

      if (!freshUrl) {
        console.log('[uazapi-photos] sem foto no WhatsApp, contato:', contact.id)
        skipped++
        continue
      }

      // Baixar e salvar no Storage
      const permanentUrl = await downloadAndStorePhoto(
        svcClient,
        freshUrl,
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
        console.error('[uazapi-photos] erro ao atualizar contato', contact.id, ':', updErr.message)
        errors++
      } else {
        console.log('[uazapi-photos] foto migrada via Uazapi, contato:', contact.id)
        updated++
      }
    } catch (err) {
      console.warn('[uazapi-photos] falha no contato:', contact.id, '—', err.message)
      errors++
    }
  }

  console.log(
    `[uazapi-photos] concluído — company:${companyId} processed:${processed} updated:${updated} skipped:${skipped} errors:${errors}`
  )

  return res.status(200).json({ processed, updated, skipped, errors, has_more: hasMore, _probe })
}

// =============================================================================
// POST /api/cron/refresh-instagram-tokens
//
// CRON de renovação proativa de tokens long-lived do Instagram Business Login.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   Sem JWT de usuário — service_role exclusivo.
//   Tokens nunca aparecem em logs, response ou audit metadata.
//
// EXECUÇÃO:
//   1. Busca até 25 conexões Instagram com token expirando em ≤ 7 dias
//      (status active|limited, token_expires_at definido)
//   2. Para cada conexão, usa lock otimista via UPDATE condicional:
//      - Avança somente se UPDATE afetou 1 linha (exclui corrida simultânea)
//   3. Descriptografa token, chama Meta API, recriptografa resultado
//   4. Sucesso: atualiza token + limpa erros anteriores + audit log
//   5. Token inválido: status=reauth_required + audit log
//   6. Erro temporário: preserva status atual, atualiza last_error_at + audit log
//
// AGENDAMENTO:
//   "0 3 * * *" — 03:00 UTC diariamente (configurado em vercel.json)
//
// META API:
//   GET https://graph.instagram.com/refresh_access_token
//     ?grant_type=ig_refresh_token&access_token=<long_lived_token>
//   Resposta: { access_token, token_type, expires_in }
//   Nota: token expirado não pode ser renovado — exige re-autorização OAuth.
//
// VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS:
//   CRON_SECRET                  — segredo compartilhado para autenticar o cron
//   INSTAGRAM_TOKEN_ENC_KEY_V1   — chave AES-256-GCM para criptografia de tokens
//   SUPABASE_SERVICE_ROLE_KEY    — chave service_role do Supabase
//   VITE_SUPABASE_URL            — URL do projeto Supabase
// =============================================================================

import { createClient }          from '@supabase/supabase-js'
import { encryptInstagramToken,
         decryptInstagramToken } from '../lib/instagram/tokenCrypto.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const GRAPH_BASE_URL    = 'https://graph.instagram.com'
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000   // 7 dias em ms
const LOCK_WINDOW_HOURS = 2                           // lock otimista: 2h
const BATCH_SIZE        = 25
const META_TIMEOUT_MS   = 15_000                      // 15s por requisição Meta

// Códigos OAuthException da Meta que indicam token definitivamente inválido.
// Nesses casos: status=reauth_required (usuário precisa re-autorizar).
const REAUTH_OAUTH_CODES    = new Set([190])
const REAUTH_OAUTH_SUBCODES = new Set([463, 467])

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) return false
  const auth = req.headers.authorization ?? ''
  return auth === `Bearer ${cronSecret}`
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── 1. Autenticação ────────────────────────────────────────────────────────
  if (!validateCronAuth(req)) {
    console.warn('[cron/refresh-instagram-tokens] Tentativa de acesso sem CRON_SECRET válido')
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[cron/refresh-instagram-tokens] SUPABASE_SERVICE_ROLE_KEY não configurado')
    return res.status(500).json({ ok: false, error: 'Supabase service_role não configurado' })
  }

  const executedAt = new Date().toISOString()
  console.log('[cron/refresh-instagram-tokens] Iniciando | timestamp:', executedAt)

  // ── 2. Buscar conexões candidatas ──────────────────────────────────────────
  //
  // Critérios:
  //   - status ativo ou limitado (never tenta revoked/reauth_required/expired)
  //   - token_expires_at definido e dentro da janela de 7 dias
  //   - last_refresh_attempt_at sem tentativa recente (filtro de lock otimista)
  //
  // Ordenado por token_expires_at ASC: prioriza quem expira mais cedo.
  // LIMIT 25 por execução: evita timeout Vercel em redes externas.

  const windowDate = new Date(Date.now() + REFRESH_WINDOW_MS).toISOString()
  const lockCutoff = new Date(Date.now() - LOCK_WINDOW_HOURS * 3600_000).toISOString()

  const { data: candidates, error: fetchError } = await svc
    .from('instagram_connections')
    .select('id, company_id, instagram_user_id, instagram_username, access_token_enc, encryption_version, token_expires_at, connection_id:id, status')
    .in('status', ['active', 'limited'])
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', windowDate)
    .or(`last_refresh_attempt_at.is.null,last_refresh_attempt_at.lt.${lockCutoff}`)
    .order('token_expires_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    console.error('[cron/refresh-instagram-tokens] Erro ao buscar conexões:', fetchError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar conexões candidatas' })
  }

  const total         = (candidates ?? []).length
  let processed       = 0
  let refreshed       = 0
  let failed          = 0
  let reauth_required = 0
  let skipped_locked  = 0

  console.log(`[cron/refresh-instagram-tokens] Candidatos encontrados: ${total}`)

  // ── 3. Processar cada conexão ──────────────────────────────────────────────

  for (const conn of (candidates ?? [])) {
    processed++

    // ── 3a. Lock otimista ─────────────────────────────────────────────────────
    //
    // UPDATE condicional: avança somente se nenhuma outra execução tomou
    // esta conexão nas últimas 2 horas. Se count = 0 → skip silencioso.

    const { count: lockCount, error: lockError } = await svc
      .from('instagram_connections')
      .update({ last_refresh_attempt_at: new Date().toISOString() })
      .eq('id', conn.id)
      .or(`last_refresh_attempt_at.is.null,last_refresh_attempt_at.lt.${lockCutoff}`)
      .select('id', { count: 'exact', head: true })

    if (lockError) {
      console.warn(`[cron/refresh-instagram-tokens] Erro no lock otimista | id=${conn.id}:`, lockError.message)
      skipped_locked++
      continue
    }

    if ((lockCount ?? 0) === 0) {
      console.log(`[cron/refresh-instagram-tokens] Conexão já tomada por outra execução | id=${conn.id}`)
      skipped_locked++
      continue
    }

    // ── 3b. Descriptografar token atual ───────────────────────────────────────

    let plainToken
    try {
      plainToken = decryptInstagramToken(conn.access_token_enc)
    } catch (decryptErr) {
      // Falha de criptografia = erro temporário/infra, não invalida conexão.
      console.error(`[cron/refresh-instagram-tokens] Falha ao descriptografar | id=${conn.id}`)

      await Promise.all([
        svc.from('instagram_connections').update({
          status_reason: 'Falha ao processar token (erro interno)',
          last_error_at: new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        }).eq('id', conn.id),

        insertAuditLog(svc, conn, 'token_refresh_failed', {
          error_code:         'decrypt_error',
          error_message_safe: 'Falha interna ao processar token',
        }),
      ])

      failed++
      continue
    }

    // ── 3c. Chamar Meta API ────────────────────────────────────────────────────

    let metaResult
    let isReauthRequired = false
    let isTemporaryError = false
    let errorCode        = null
    let errorMsgSafe     = null

    try {
      const url      = `${GRAPH_BASE_URL}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(plainToken)}`
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), META_TIMEOUT_MS)

      let response
      try {
        response = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }

      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        // Classificar erro Meta
        const oauthCode    = body?.error?.code
        const oauthSubcode = body?.error?.error_subcode
        const oauthType    = body?.error?.type

        const isOAuthException = oauthType === 'OAuthException'
        const isReauthCode     = REAUTH_OAUTH_CODES.has(oauthCode)
        const isReauthSubcode  = REAUTH_OAUTH_SUBCODES.has(oauthSubcode)

        if (isOAuthException && (isReauthCode || isReauthSubcode)) {
          isReauthRequired = true
          errorCode        = `${oauthCode ?? 'oauth'}${oauthSubcode ? `/${oauthSubcode}` : ''}`
          errorMsgSafe     = 'Token inválido ou expirado. Re-autorização necessária.'
        } else {
          isTemporaryError = true
          errorCode        = String(oauthCode ?? response.status)
          errorMsgSafe     = 'Falha temporária na API Meta. Será tentado novamente.'
        }
      } else {
        metaResult = body
      }
    } catch (fetchErr) {
      // Timeout, ECONNRESET, ETIMEDOUT, network failure — todos temporários
      isTemporaryError = true
      errorCode        = fetchErr?.name === 'AbortError' ? 'timeout' : (fetchErr?.code ?? 'network_error')
      errorMsgSafe     = 'Erro de rede ao contatar Meta API. Será tentado novamente.'
      console.warn(`[cron/refresh-instagram-tokens] Erro de rede | id=${conn.id} | code=${errorCode}`)
    }

    // Garantia: token plaintext nunca vaza para além desta função
    plainToken = null

    // ── 3d. Tratar resultado ──────────────────────────────────────────────────

    if (metaResult?.access_token) {
      // ── SUCESSO ──────────────────────────────────────────────────────────────

      let newTokenEnc
      try {
        newTokenEnc = encryptInstagramToken(metaResult.access_token)
      } catch (encErr) {
        console.error(`[cron/refresh-instagram-tokens] Falha ao criptografar novo token | id=${conn.id}`)
        failed++
        continue
      }

      // Calcular nova expiração com base em expires_in (segundos)
      const expiresInSec = typeof metaResult.expires_in === 'number' ? metaResult.expires_in : 60 * 24 * 3600
      const newExpiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()

      await Promise.all([
        svc.from('instagram_connections').update({
          access_token_enc:  newTokenEnc,
          token_expires_at:  newExpiresAt,
          status:            'active',
          status_reason:     null,
          last_error_at:     null,
          updated_at:        new Date().toISOString(),
        }).eq('id', conn.id),

        insertAuditLog(svc, conn, 'token_refresh', {
          previous_expires_at: conn.token_expires_at,
          new_expires_at:      newExpiresAt,
        }),
      ])

      console.log(`[cron/refresh-instagram-tokens] Token renovado | id=${conn.id} | novo_expires=${newExpiresAt}`)
      refreshed++

    } else if (isReauthRequired) {
      // ── REAUTH REQUIRED ───────────────────────────────────────────────────────
      // Token definitivamente inválido — usuário precisa re-autorizar o app.

      await Promise.all([
        svc.from('instagram_connections').update({
          status:        'reauth_required',
          status_reason: errorMsgSafe,
          last_error_at: new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        }).eq('id', conn.id),

        insertAuditLog(svc, conn, 'token_reauth_required', {
          error_code:          errorCode,
          error_message_safe:  errorMsgSafe,
          previous_expires_at: conn.token_expires_at,
        }),
      ])

      console.warn(`[cron/refresh-instagram-tokens] Reauth necessário | id=${conn.id} | code=${errorCode}`)
      reauth_required++

    } else {
      // ── ERRO TEMPORÁRIO ───────────────────────────────────────────────────────
      // Preservar status atual (active|limited) — não penalizar conexão válida
      // por falha transitória de rede ou rate limit da Meta.

      await Promise.all([
        svc.from('instagram_connections').update({
          status_reason: errorMsgSafe,
          last_error_at: new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        }).eq('id', conn.id),

        insertAuditLog(svc, conn, 'token_refresh_failed', {
          error_code:          errorCode,
          error_message_safe:  errorMsgSafe,
          previous_expires_at: conn.token_expires_at,
        }),
      ])

      console.warn(`[cron/refresh-instagram-tokens] Falha temporária | id=${conn.id} | code=${errorCode}`)
      failed++
    }
  }

  // ── 4. Resposta segura ─────────────────────────────────────────────────────

  const summary = {
    success:        true,
    processed,
    refreshed,
    failed,
    reauth_required,
    skipped_locked,
    executed_at:    executedAt,
  }

  console.log('[cron/refresh-instagram-tokens] Concluído |', JSON.stringify(summary))

  return res.status(200).json(summary)
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function insertAuditLog(svc, conn, action, metadata = {}) {
  // Nunca incluir token, ciphertext ou plaintext no metadata.
  const safeMetadata = {
    instagram_user_id:   conn.instagram_user_id,
    instagram_username:  conn.instagram_username,
    ...metadata,
  }

  const { error } = await svc.from('instagram_audit_logs').insert({
    company_id:    conn.company_id,
    connection_id: conn.id,
    action,
    performed_by:  null,   // ação automática — sem usuário
    metadata:      safeMetadata,
  })

  if (error) {
    console.warn(`[cron/refresh-instagram-tokens] Falha ao inserir audit log | id=${conn.id} | action=${action}:`, error.message)
  }
}

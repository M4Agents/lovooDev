// =============================================================================
// POST /api/cron/alert-trials
//
// Cron de alertas automáticos de trial expirando.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   Rejeita qualquer requisição sem token válido.
//   Sem JWT de usuário — service_role exclusivo.
//
// FLUXO:
//   1. Lê configuração via fetchNotificationsConfig()
//   2. Se sistema desabilitado → encerra sem gravar logs
//   3. Busca candidatos via get_trial_alert_candidates()
//   4. Para cada empresa:
//      a. Processa canal WhatsApp (independente do email)
//      b. Processa canal Email  (independente do WhatsApp)
//   5. Retorna resumo da execução
//
// DEDUP: notification_dedup (company_id, event_key, channel)
//   → INSERT somente após envio com sucesso
//   → ON CONFLICT ignorado (idempotente)
//
// LOGS: notification_logs
//   → 1 registro por destinatário por canal
//   → Gravado em sent, failed e skipped
//   → Skipped sem dedup insert (permite nova tentativa após correção)
//
// CANAIS: completamente independentes — sem fallback automático entre eles.
// TEMPLATES: ausência → log skipped, sem hardcoded. Sem fallback textual.
//
// AGENDAMENTO: "0 6 * * *" — 06:00 UTC diariamente (vercel.json)
//
// VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS:
//   CRON_SECRET               — segredo compartilhado
//   SUPABASE_SERVICE_ROLE_KEY — chave service_role
//   VITE_SUPABASE_URL         — URL do Supabase
//   RESEND_API_KEY             — chave do Resend (para email)
//   EMAIL_FROM                 — remetente (ex.: noreply@send.lovoocrm.com)
// VARIÁVEIS OPCIONAIS:
//   LOVOO_EMAIL_LOGO_URL       — URL pública do logo (emailRenderer usa fallback textual se ausente)
//   PARENT_COMPANY_ID          — UUID da empresa pai (fallback: M4 Digital)
// =============================================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { fetchNotificationsConfig, isChannelEnabled } from '../lib/notifications/configDb.js'
import { fetchTemplate, renderTemplate } from '../lib/notifications/templateDb.js'
import {
  resolveTrialAlertBaseVariables,
  withAdminName,
  getCompanyAdminUsers,
  resolveCompanyWhatsAppPhone,
} from '../lib/notifications/variablesResolver.js'
import { sendEmail } from '../lib/email/resendClient.js'
import { renderEmail } from '../lib/email/emailRenderer.js'
import { sendWhatsApp } from '../lib/whatsapp/notificationSender.js'

// ── Constantes ─────────────────────────────────────────────────────────────────

const DEFAULT_PARENT_COMPANY_ID = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'
const PARENT_COMPANY_ID =
  (typeof process.env?.PARENT_COMPANY_ID === 'string' && process.env.PARENT_COMPANY_ID.trim()
    ? process.env.PARENT_COMPANY_ID.trim()
    : DEFAULT_PARENT_COMPANY_ID)

/** Limite de caracteres do campo rendered_body em notification_logs */
const RENDERED_BODY_MAX = 1000

// ── Helpers de autenticação ────────────────────────────────────────────────────

function validateCronAuth(req) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) return false
  return (req.headers.authorization ?? '') === `Bearer ${cronSecret}`
}

// ── Helpers de banco (service_role) ────────────────────────────────────────────

/**
 * Verifica se já existe registro de dedup para (company_id, event_key, channel).
 * Retorna true se já foi enviado (deve pular).
 */
async function checkDedup(svc, companyId, eventKey, channel) {
  const { data } = await svc
    .from('notification_dedup')
    .select('id')
    .eq('company_id', companyId)
    .eq('event_key', eventKey)
    .eq('channel', channel)
    .maybeSingle()
  return data != null
}

/**
 * Insere registro de dedup após envio com sucesso.
 * ON CONFLICT ignorado (upsert ignoreDuplicates=true).
 */
async function insertDedup(svc, companyId, eventKey, channel) {
  const { error } = await svc
    .from('notification_dedup')
    .upsert(
      { company_id: companyId, event_key: eventKey, channel },
      { onConflict: 'company_id,event_key,channel', ignoreDuplicates: true }
    )
  if (error) {
    console.warn(`[alert-trials] Aviso: falha ao inserir dedup (${channel}/${eventKey}):`, error.message)
  }
}

/**
 * Insere um registro em notification_logs.
 * Trunca rendered_body para RENDERED_BODY_MAX caracteres.
 * Erros de DB são silenciosos (logar no console) para não quebrar o fluxo.
 */
async function insertLog(svc, {
  companyId,
  eventType,
  eventSubtype,
  channel,
  recipient,
  subject,
  renderedBody,
  status,
  providerMessageId,
  errorMessage,
  metadata,
}) {
  const truncatedBody = typeof renderedBody === 'string' && renderedBody.length > RENDERED_BODY_MAX
    ? renderedBody.slice(0, RENDERED_BODY_MAX)
    : (renderedBody ?? null)

  const { error } = await svc.from('notification_logs').insert({
    company_id:          companyId,
    event_type:          eventType,
    event_subtype:       eventSubtype ?? null,
    channel,
    recipient:           recipient ?? null,
    subject:             subject ?? null,
    rendered_body:       truncatedBody,
    status,
    provider_message_id: providerMessageId ?? null,
    error_message:       errorMessage ?? null,
    metadata:            metadata ?? null,
    sent_at:             new Date().toISOString(),
  })

  if (error) {
    console.warn(`[alert-trials] Aviso: falha ao gravar log (${channel}/${status}):`, error.message)
  }
}

/**
 * Busca instância WhatsApp na tabela whatsapp_life_instances.
 * Requer status='connected' e deleted_at IS NULL.
 * Retorna null se não encontrada ou inativa.
 */
async function fetchWaInstance(svc, instanceId) {
  if (!instanceId) return null

  const { data: inst } = await svc
    .from('whatsapp_life_instances')
    .select('id, provider_token, status, deleted_at')
    .eq('id', instanceId)
    .maybeSingle()

  if (!inst)                       return null
  if (inst.deleted_at !== null)    return null
  if (inst.status !== 'connected') return null

  return inst
}

// ── Processadores de canal ─────────────────────────────────────────────────────

/**
 * Processa o canal WhatsApp para um candidato.
 * Independente do canal email — nenhum resultado aqui afeta o email.
 */
async function processWhatsApp(candidate, waInstance, svc, stats) {
  const { company_id: companyId, event_subtype: eventSubtype } = candidate
  const eventKey  = `trial_alert:${eventSubtype}`
  const logBase   = {
    companyId,
    eventType:    'trial_alert',
    eventSubtype,
    channel:      'whatsapp',
  }

  // ── 1. Verificar dedup ─────────────────────────────────────────────────────
  const isDup = await checkDedup(svc, companyId, eventKey, 'whatsapp')
  if (isDup) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'dedup_hit',
      metadata: { event_key: eventKey, provider: 'whatsapp', company_parent_id: PARENT_COMPANY_ID } })
    stats.whatsapp.skipped++
    return
  }

  // ── 2. Buscar template ─────────────────────────────────────────────────────
  const template = await fetchTemplate({
    companyId:    PARENT_COMPANY_ID,
    eventType:    'trial_alert',
    eventSubtype,
    channel:      'whatsapp',
  })
  if (!template) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'template_not_found',
      metadata: { event_key: eventKey, provider: 'whatsapp', company_parent_id: PARENT_COMPANY_ID } })
    stats.whatsapp.skipped++
    return
  }

  // ── 3. Resolver variáveis base ─────────────────────────────────────────────
  const baseVars = await resolveTrialAlertBaseVariables(candidate)
  if (!baseVars) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'variables_resolution_failed',
      metadata: { event_key: eventKey, provider: 'whatsapp', template_id: template.id, template_name: template.name, company_parent_id: PARENT_COMPANY_ID } })
    stats.whatsapp.skipped++
    return
  }

  // ── 4. Renderizar corpo textual ────────────────────────────────────────────
  const renderedBody = renderTemplate(template.body, baseVars)

  // ── 5. Resolver telefone da empresa ───────────────────────────────────────
  const phone = await resolveCompanyWhatsAppPhone(companyId)
  if (!phone) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'recipient_not_found',
      metadata: { event_key: eventKey, provider: 'whatsapp', template_id: template.id, template_name: template.name, company_parent_id: PARENT_COMPANY_ID, variables: baseVars } })
    stats.whatsapp.skipped++
    return
  }

  // ── 6. Enviar via Uazapi ───────────────────────────────────────────────────
  const metaBase = {
    event_key:          eventKey,
    provider:           'whatsapp',
    template_id:        template.id,
    template_name:      template.name,
    company_parent_id:  PARENT_COMPANY_ID,
    variables:          baseVars,
  }

  try {
    const result = await sendWhatsApp({
      number:   phone,
      message:  renderedBody,
      instance: waInstance,
    })

    await insertLog(svc, { ...logBase, recipient: phone, renderedBody, status: 'sent',
      providerMessageId: result.messageId, metadata: metaBase })
    await insertDedup(svc, companyId, eventKey, 'whatsapp')
    stats.whatsapp.sent++

  } catch (err) {
    await insertLog(svc, { ...logBase, recipient: phone, renderedBody, status: 'failed',
      errorMessage: err?.message ?? String(err), metadata: metaBase })
    stats.whatsapp.failed++
  }
}

/**
 * Processa o canal Email para um candidato.
 * Envia 1 email por admin ativo da empresa — 1 log por destinatário.
 * Dedup inserido somente se pelo menos 1 envio tiver sucesso.
 */
async function processEmail(candidate, svc, stats) {
  const { company_id: companyId, event_subtype: eventSubtype } = candidate
  const eventKey = `trial_alert:${eventSubtype}`
  const logBase  = {
    companyId,
    eventType:    'trial_alert',
    eventSubtype,
    channel:      'email',
  }

  // ── 1. Verificar dedup ─────────────────────────────────────────────────────
  const isDup = await checkDedup(svc, companyId, eventKey, 'email')
  if (isDup) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'dedup_hit',
      metadata: { event_key: eventKey, provider: 'resend', company_parent_id: PARENT_COMPANY_ID } })
    stats.email.skipped++
    return
  }

  // ── 2. Buscar template ─────────────────────────────────────────────────────
  const template = await fetchTemplate({
    companyId:    PARENT_COMPANY_ID,
    eventType:    'trial_alert',
    eventSubtype,
    channel:      'email',
  })
  if (!template) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'template_not_found',
      metadata: { event_key: eventKey, provider: 'resend', company_parent_id: PARENT_COMPANY_ID } })
    stats.email.skipped++
    return
  }

  // ── 3. Resolver variáveis base ─────────────────────────────────────────────
  const baseVars = await resolveTrialAlertBaseVariables(candidate)
  if (!baseVars) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'variables_resolution_failed',
      metadata: { event_key: eventKey, provider: 'resend', template_id: template.id, template_name: template.name, company_parent_id: PARENT_COMPANY_ID } })
    stats.email.skipped++
    return
  }

  // ── 4. Buscar destinatários (admins da empresa cliente) ────────────────────
  const admins = await getCompanyAdminUsers(companyId)
  if (!admins.length) {
    await insertLog(svc, { ...logBase, recipient: null, status: 'skipped', errorMessage: 'recipient_not_found',
      metadata: { event_key: eventKey, provider: 'resend', template_id: template.id, template_name: template.name, company_parent_id: PARENT_COMPANY_ID, variables: baseVars } })
    stats.email.skipped++
    return
  }

  // ── 5. Enviar para cada admin ──────────────────────────────────────────────
  let atLeastOneSent = false

  for (const admin of admins) {
    const vars          = withAdminName(baseVars, admin.display_name)
    const renderedBody  = renderTemplate(template.body, vars)
    const subject       = renderTemplate(template.subject ?? '', vars)
    const html          = renderEmail({ subject, body: renderedBody, ctaUrl: vars.cta_url })

    const metaAdmin = {
      event_key:         eventKey,
      provider:          'resend',
      template_id:       template.id,
      template_name:     template.name,
      company_parent_id: PARENT_COMPANY_ID,
      variables:         vars,
    }

    try {
      const result = await sendEmail({ to: admin.email, subject, html })

      await insertLog(svc, { ...logBase, recipient: admin.email, subject, renderedBody, status: 'sent',
        providerMessageId: result.id, metadata: metaAdmin })
      stats.email.sent++
      atLeastOneSent = true

    } catch (err) {
      await insertLog(svc, { ...logBase, recipient: admin.email, subject, renderedBody, status: 'failed',
        errorMessage: err?.message ?? String(err), metadata: metaAdmin })
      stats.email.failed++
    }
  }

  // ── 6. Dedup somente se pelo menos 1 sucesso ───────────────────────────────
  if (atLeastOneSent) {
    await insertDedup(svc, companyId, eventKey, 'email')
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  if (!validateCronAuth(req)) {
    console.warn('[cron/alert-trials] Acesso rejeitado: CRON_SECRET inválido ou ausente')
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  // ── Supabase service_role ──────────────────────────────────────────────────
  let svc
  try {
    svc = getSupabaseAdmin()
  } catch (err) {
    console.error('[cron/alert-trials] Supabase não configurado:', err.message)
    return res.status(500).json({ ok: false, error: 'Supabase service_role não configurado' })
  }

  const startedAt = new Date().toISOString()
  console.log('[cron/alert-trials] Iniciando | timestamp:', startedAt)

  // ── 1. Ler configuração de notificações ────────────────────────────────────
  const config = await fetchNotificationsConfig()

  if (!config.enabled) {
    console.log('[cron/alert-trials] Sistema de notificações desabilitado — encerrando sem logs')
    return res.status(200).json({ ok: true, skipped: true, reason: 'notifications_disabled' })
  }

  // ── 2. Resolver instância WhatsApp (uma vez, compartilhada entre candidatos) ─
  const waEnabled  = isChannelEnabled(config, 'whatsapp')
  const mailEnabled = isChannelEnabled(config, 'email')
  let waInstance = null

  if (waEnabled) {
    waInstance = await fetchWaInstance(svc, config.whatsapp_instance_id)
    if (!waInstance) {
      console.warn(
        '[cron/alert-trials] Canal WhatsApp habilitado mas instância não encontrada ou desconectada.',
        'whatsapp_instance_id:', config.whatsapp_instance_id,
        '— canal WA será ignorado nesta execução.'
      )
    }
  }

  // ── 3. Buscar empresas candidatas ──────────────────────────────────────────
  const { data: candidates, error: rpcError } = await svc.rpc('get_trial_alert_candidates')

  if (rpcError) {
    console.error('[cron/alert-trials] Erro ao chamar get_trial_alert_candidates:', rpcError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar candidatos de trial alert' })
  }

  if (!candidates?.length) {
    console.log('[cron/alert-trials] Nenhum candidato encontrado — encerrando')
    return res.status(200).json({
      ok: true, processed: 0,
      whatsapp: { sent: 0, failed: 0, skipped: 0 },
      email:    { sent: 0, failed: 0, skipped: 0 },
    })
  }

  console.log('[cron/alert-trials] Candidatos encontrados:', candidates.length)

  // ── 4. Processar cada candidato ────────────────────────────────────────────
  const stats = {
    whatsapp: { sent: 0, failed: 0, skipped: 0 },
    email:    { sent: 0, failed: 0, skipped: 0 },
  }

  for (const candidate of candidates) {
    const label = `[${candidate.company_name ?? candidate.company_id}/${candidate.event_subtype}]`

    // ── Canal WhatsApp (independente) ────────────────────────────────────────
    if (waEnabled && waInstance) {
      try {
        await processWhatsApp(candidate, waInstance, svc, stats)
      } catch (err) {
        console.error(`[cron/alert-trials] ${label} Erro inesperado no canal WA:`, err?.message)
        stats.whatsapp.failed++
      }
    }

    // ── Canal Email (independente) ────────────────────────────────────────────
    if (mailEnabled) {
      try {
        await processEmail(candidate, svc, stats)
      } catch (err) {
        console.error(`[cron/alert-trials] ${label} Erro inesperado no canal Email:`, err?.message)
        stats.email.failed++
      }
    }
  }

  // ── 5. Resumo final ────────────────────────────────────────────────────────
  const summary = {
    ok:        true,
    processed: candidates.length,
    whatsapp:  stats.whatsapp,
    email:     stats.email,
    started_at: startedAt,
  }

  console.log('[cron/alert-trials] Concluído |',
    'processados:', summary.processed,
    '| WA:', JSON.stringify(stats.whatsapp),
    '| Email:', JSON.stringify(stats.email)
  )

  return res.status(200).json(summary)
}

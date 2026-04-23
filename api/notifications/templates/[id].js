// =============================================================================
// PUT /api/notifications/templates/:id
//
// Atualiza um template de notificação da empresa pai.
//
// AUTENTICAÇÃO: Authorization: Bearer <JWT>
// AUTORIZAÇÃO:  super_admin ou system_admin da empresa pai (PARENT_COMPANY_ID)
//
// PARÂMETROS:
//   :id — UUID do template (Vercel dynamic route → req.query.id)
//
// BODY ACEITO:
//   {
//     "name":      "string",          // obrigatório
//     "subject":   "string | null",   // ignorado para channel=whatsapp
//     "body":      "string",          // obrigatório, não pode ser vazio
//     "is_active": boolean            // obrigatório
//   }
//
// CAMPOS IMUTÁVEIS (nunca alterados por este endpoint):
//   event_type, event_subtype, channel, company_id
//
// VALIDAÇÕES:
//   - ownership: template.company_id deve ser PARENT_COMPANY_ID
//   - body não pode ser vazio
//   - variáveis {{...}} validadas via validateTemplateVariables()
//   - channel=whatsapp: subject ignorado (salvo como null)
//   - campos não permitidos no body causam erro 400
//
// RESPOSTA (200):
//   { "ok": true, "template": { ... } }
//
// ERROS:
//   401 — token ausente ou inválido
//   403 — sem permissão
//   404 — template não encontrado ou não pertence à empresa pai
//   400 — body_required | invalid_variable | invalid_channel_configuration | campo_not_allowed
//   500 — erro interno
// =============================================================================

import { assertNotificationsAdmin, PARENT_COMPANY_ID } from '../../lib/notifications/auth.js'
import { validateTemplateVariables } from '../../lib/notifications/templateDb.js'

// ── Validação do body ──────────────────────────────────────────────────────────

/**
 * Valida e extrai os campos editáveis do body.
 * Retorna { ok: true, value } ou { ok: false, error, code }.
 */
function validatePutBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body inválido', code: 'invalid_body' }
  }

  // Rejeitar campos não permitidos (imutáveis ou desconhecidos)
  const allowed = new Set(['name', 'subject', 'body', 'is_active'])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return {
        ok:    false,
        error: `Campo não permitido: "${key}". Campos editáveis: name, subject, body, is_active`,
        code:  'field_not_allowed',
      }
    }
  }

  // name: obrigatório, string não vazia
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, error: 'name é obrigatório e não pode ser vazio', code: 'invalid_body' }
  }

  // body: obrigatório, string não vazia
  if (typeof body.body !== 'string' || !body.body.trim()) {
    return { ok: false, error: 'body é obrigatório e não pode ser vazio', code: 'body_required' }
  }

  // subject: string ou null (obrigatório apenas para email — validado após verificar channel)
  if ('subject' in body && body.subject !== null && typeof body.subject !== 'string') {
    return { ok: false, error: 'subject deve ser string ou null', code: 'invalid_body' }
  }

  // is_active: boolean obrigatório
  if (typeof body.is_active !== 'boolean') {
    return { ok: false, error: 'is_active deve ser boolean', code: 'invalid_body' }
  }

  return {
    ok:    true,
    value: {
      name:      body.name.trim(),
      subject:   body.subject ?? null,
      body:      body.body,
      is_active: body.is_active,
    },
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'PUT') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Autenticação e autorização ─────────────────────────────────────────────
  const auth = await assertNotificationsAdmin(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const { supabase } = auth

  // ── Extrair ID do template (Vercel dynamic route) ──────────────────────────
  const templateId = req.query?.id ?? null
  if (!templateId || typeof templateId !== 'string') {
    return res.status(400).json({ ok: false, error: 'ID do template é obrigatório' })
  }

  // ── Validar body ───────────────────────────────────────────────────────────
  const parsed = validatePutBody(req.body)
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error, code: parsed.code })
  }

  const fields = parsed.value

  // ── Buscar template e validar ownership ───────────────────────────────────
  const { data: template, error: fetchError } = await supabase
    .from('notification_templates')
    .select('id, company_id, event_type, event_subtype, channel, name, subject, body, is_active')
    .eq('id', templateId)
    .maybeSingle()

  if (fetchError) {
    console.error('[notifications/templates PUT] Erro ao buscar template:', fetchError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar template' })
  }

  if (!template) {
    return res.status(404).json({
      ok:    false,
      error: 'Template não encontrado',
      code:  'template_not_found',
    })
  }

  // Validar que o template pertence à empresa pai (ownership)
  if (template.company_id !== PARENT_COMPANY_ID) {
    return res.status(403).json({
      ok:    false,
      error: 'Template não pertence à empresa pai',
      code:  'forbidden',
    })
  }

  // ── Validar channel=whatsapp (subject ignorado) ────────────────────────────
  let finalSubject = fields.subject
  if (template.channel === 'whatsapp') {
    finalSubject = null
  } else if (template.channel === 'email' && !fields.subject?.trim()) {
    // Email sem subject é tecnicamente permitido mas avisamos
    // (não bloquear — o admin pode estar desabilitando o template)
    finalSubject = null
  }

  // ── Validar variáveis do body ──────────────────────────────────────────────
  try {
    validateTemplateVariables(fields.body, template.event_type)
  } catch (err) {
    return res.status(400).json({
      ok:    false,
      error: err?.message ?? 'Variável inválida no body do template',
      code:  'invalid_variable',
    })
  }

  // Validar subject (apenas para email) se fornecido
  if (finalSubject && template.channel === 'email') {
    try {
      validateTemplateVariables(finalSubject, template.event_type)
    } catch (err) {
      return res.status(400).json({
        ok:    false,
        error: `Variável inválida no subject: ${err?.message}`,
        code:  'invalid_variable',
      })
    }
  }

  // ── Atualizar template ─────────────────────────────────────────────────────
  const { data: updated, error: updateError } = await supabase
    .from('notification_templates')
    .update({
      name:       fields.name,
      subject:    finalSubject,
      body:       fields.body,
      is_active:  fields.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('company_id', PARENT_COMPANY_ID)  // dupla garantia de ownership
    .select('id, event_type, event_subtype, channel, name, subject, body, is_active')
    .maybeSingle()

  if (updateError) {
    console.error('[notifications/templates PUT] Erro ao atualizar template:', updateError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao salvar template' })
  }

  if (!updated) {
    return res.status(404).json({
      ok:    false,
      error: 'Template não encontrado após atualização',
      code:  'template_not_found',
    })
  }

  return res.status(200).json({ ok: true, success: true, template: updated })
}

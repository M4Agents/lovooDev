// Disparo do Webhook Avançado.
// service_role apenas no backend. Toda leitura filtra company_id do lead.

const LEAD_FIELDS = [
  'name',
  'email',
  'phone',
  'status',
  'origin',
  'interest',
  'responsible_user_id',
  'created_at',
  'updated_at',
]

const COMPANY_FIELDS = [
  'company_name',
  'company_cnpj',
  'company_razao_social',
  'company_nome_fantasia',
  'company_telefone',
  'company_email',
  'company_site',
  'company_cidade',
  'company_estado',
  'company_cep',
  'company_endereco',
]

const DEFAULT_LEAD_FIELDS = ['name', 'email', 'phone', 'status', 'origin']

export function resolveLeadWebhookEvent({ reason, previousStatus, currentStatus }) {
  if (reason === 'created') return 'lead_created'
  if (
    typeof previousStatus === 'string' &&
    previousStatus !== 'convertido' &&
    currentStatus === 'convertido'
  ) {
    return 'lead_converted'
  }
  return 'lead_updated'
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function headerMap(headers) {
  const source = asObject(headers)
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && key.trim()) out[key] = value
  }
  return out
}

function selectedList(payloadFields, key) {
  const list = asObject(payloadFields)[key]
  return Array.isArray(list) ? list.map((item) => String(item)) : []
}

async function loadLead(supabase, companyId, leadId) {
  const columns = ['id', ...LEAD_FIELDS, ...COMPANY_FIELDS].join(', ')
  const { data, error } = await supabase
    .from('leads')
    .select(columns)
    .eq('id', leadId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[advanced-webhook] erro ao ler lead:', error.message)
    return null
  }
  return data
}

async function loadTagNames(supabase, companyId, leadId) {
  const { data, error } = await supabase
    .from('lead_tag_assignments')
    .select('lead_tags(name, is_active, company_id)')
    .eq('lead_id', leadId)

  if (error) {
    console.error('[advanced-webhook] erro ao ler tags:', error.message)
    return null
  }

  const names = []
  const seen = new Set()
  for (const row of data || []) {
    const tag = Array.isArray(row.lead_tags) ? row.lead_tags[0] : row.lead_tags
    if (!tag || tag.is_active !== true || tag.company_id !== companyId) continue
    const name = typeof tag.name === 'string' ? tag.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  names.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return names
}

async function loadCustomFields(supabase, companyId, leadId) {
  const { data, error } = await supabase
    .from('lead_custom_values')
    .select('field_id, value, lead_custom_fields(numeric_id, company_id)')
    .eq('lead_id', leadId)

  if (error) {
    console.error('[advanced-webhook] erro ao ler campos personalizados:', error.message)
    return []
  }

  return (data || []).flatMap((row) => {
    const field = Array.isArray(row.lead_custom_fields)
      ? row.lead_custom_fields[0]
      : row.lead_custom_fields
    if (!field || field.company_id !== companyId) return []
    return [{
      field_id: row.field_id,
      value: row.value,
      numeric_id: field.numeric_id ?? null,
    }]
  })
}

function customFromProcessed(processed) {
  if (!Array.isArray(processed)) return []
  return processed.map((field) => ({
    field_id: field.field_id,
    value: field.value,
    numeric_id: field.numeric_id ?? null,
  }))
}

function buildLeadPayload(lead, config, tagNames, customFields) {
  const payloadFields = asObject(config.payload_fields)
  const leadFields = Array.isArray(payloadFields.lead)
    ? payloadFields.lead.map((item) => String(item))
    : DEFAULT_LEAD_FIELDS
  const companyFields = selectedList(payloadFields, 'empresa')
  const customSelected = selectedList(payloadFields, 'custom_fields')

  const body = { id: lead.id }

  for (const field of leadFields) {
    if (field === 'tags') {
      if (tagNames) body.tags = tagNames
      continue
    }
    if (!LEAD_FIELDS.includes(field)) continue
    const value = lead[field]
    if (value !== undefined && value !== null) body[field] = value
  }

  for (const field of companyFields) {
    if (!COMPANY_FIELDS.includes(field)) continue
    const value = lead[field]
    if (value !== undefined && value !== null) body[field] = value
  }

  if (customSelected.length > 0) {
    for (const custom of customFields) {
      const numericId = custom.numeric_id != null ? String(custom.numeric_id) : null
      const fieldId = custom.field_id != null ? String(custom.field_id) : null
      if (
        (numericId && customSelected.includes(numericId)) ||
        (fieldId && customSelected.includes(fieldId))
      ) {
        body[numericId || fieldId] = custom.value
      }
    }
  }

  return body
}

async function writeLog(supabase, entry) {
  const { error } = await supabase.from('webhook_trigger_logs').insert(entry)
  if (error) {
    console.error('[advanced-webhook] erro ao gravar log:', error.message)
  }
}

async function postConfig(supabase, config, companyId, leadId, event, payload) {
  const started = Date.now()
  const timeoutSeconds = Number(config.timeout_seconds) || 10
  let responseStatus = null
  let responseBody = null
  let errorMessage = null

  try {
    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headerMap(config.headers),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.min(Math.max(timeoutSeconds, 1), 60) * 1000),
    })
    responseStatus = response.status
    responseBody = await response.text()
    if (!response.ok) {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`
    }
  } catch (error) {
    errorMessage = error?.message || 'Falha ao enviar webhook'
    console.error(`[advanced-webhook] ${config.name}:`, errorMessage)
  }

  await writeLog(supabase, {
    config_id: config.id,
    company_id: companyId,
    lead_id: leadId,
    trigger_event: event,
    payload,
    webhook_url: config.webhook_url,
    response_status: responseStatus,
    response_body: responseBody,
    response_headers: {},
    error_message: errorMessage,
    execution_time_ms: Date.now() - started,
  })
}

// Não espera o envio. Usado em lote e no WhatsApp, onde a resposta não pode
// ficar presa no timeout do webhook do cliente.
export function scheduleAdvancedWebhooks(params) {
  void triggerAdvancedWebhooks(params).catch((error) => {
    console.error('[advanced-webhook] falha ao agendar:', error?.message || error)
  })
}

export async function triggerAdvancedWebhooks({
  supabase,
  companyId,
  leadId,
  event,
  customFieldsProcessed,
}) {
  try {
    if (!supabase || !companyId || !leadId || !event) return

    const { data: configs, error: configError } = await supabase
      .from('webhook_trigger_configs')
      .select('id, name, webhook_url, is_active, trigger_events, payload_fields, headers, timeout_seconds')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (configError) {
      console.error('[advanced-webhook] erro ao ler configurações:', configError.message)
      return
    }

    const active = (configs || []).filter(
      (config) => Array.isArray(config.trigger_events) && config.trigger_events.includes(event),
    )
    if (active.length === 0) return

    const lead = await loadLead(supabase, companyId, leadId)
    if (!lead) return

    const needsTags = active.some((config) => selectedList(config.payload_fields, 'lead').includes('tags'))
    const needsCustom = active.some((config) => selectedList(config.payload_fields, 'custom_fields').length > 0)

    const tagNames = needsTags ? await loadTagNames(supabase, companyId, leadId) : null
    const customFields = needsCustom
      ? (Array.isArray(customFieldsProcessed)
        ? customFromProcessed(customFieldsProcessed)
        : await loadCustomFields(supabase, companyId, leadId))
      : []

    await Promise.all(active.map((config) => {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data: {
          lead: buildLeadPayload(lead, config, tagNames, customFields),
        },
      }
      return postConfig(supabase, config, companyId, lead.id, event, payload)
    }))
  } catch (error) {
    console.error('[advanced-webhook] erro geral:', error?.message || error)
  }
}

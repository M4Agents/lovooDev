// Webhook Ultra-Simples para Criação Automática de Leads
// Endpoint: /api/webhook-lead
// Método: POST com api_key no body + dados do formulário
// Padrão baseado no webhook-visitor que funciona 100%

import { createHash } from 'crypto';
import { dispatchLeadCreatedTrigger } from './lib/automation/dispatchLeadCreatedTrigger.js';
import { getSupabaseAdmin } from './lib/automation/supabaseAdmin.js';
import { handleLeadReentry, hashPayload } from './lib/leads/handleLeadReentry.js';

const MAX_PAYLOAD_BYTES = 10_240; // 10 KB por requisição

// =============================================================================
// Fase 5 — Sanitização por whitelist
// =============================================================================

// Campos cujo envio causa rejeição imediata (400) — nunca devem vir do cliente
const BLOCKED_FIELDS = new Set([
  'company_id', 'user_id', 'role', 'permissions', 'plan_id',
  'is_admin', 'is_active', 'deleted_at', 'created_at', 'updated_at',
  'password', 'token', 'secret', 'authorization', 'jwt',
]);

// Map: alias_lowercase → { canonical, maxLen, normalize? }
// Aliases em lowercase; normalize: 'email' aplica lowercase + trim
const FIELD_WHITELIST = new Map([
  // Autenticação (extraído antes de chegar ao lead)
  ['api_key',        { canonical: 'api_key',         maxLen: 128 }],

  // Nome
  ['name',           { canonical: 'name',             maxLen: 255 }],
  ['nome',           { canonical: 'name',             maxLen: 255 }],
  ['full_name',      { canonical: 'name',             maxLen: 255 }],
  ['fullname',       { canonical: 'name',             maxLen: 255 }],
  ['first_name',     { canonical: 'name',             maxLen: 255 }],
  ['firstname',      { canonical: 'name',             maxLen: 255 }],
  ['cliente',        { canonical: 'name',             maxLen: 255 }],
  ['usuario',        { canonical: 'name',             maxLen: 255 }],

  // Email
  ['email',          { canonical: 'email',            maxLen: 255, normalize: 'email' }],
  ['e-mail',         { canonical: 'email',            maxLen: 255, normalize: 'email' }],
  ['mail',           { canonical: 'email',            maxLen: 255, normalize: 'email' }],
  ['email_address',  { canonical: 'email',            maxLen: 255, normalize: 'email' }],
  ['user_email',     { canonical: 'email',            maxLen: 255, normalize: 'email' }],

  // Telefone
  ['phone',          { canonical: 'phone',            maxLen: 30 }],
  ['telefone',       { canonical: 'phone',            maxLen: 30 }],
  ['tel',            { canonical: 'phone',            maxLen: 30 }],
  ['celular',        { canonical: 'phone',            maxLen: 30 }],
  ['whatsapp',       { canonical: 'phone',            maxLen: 30 }],
  ['mobile',         { canonical: 'phone',            maxLen: 30 }],
  ['contact',        { canonical: 'phone',            maxLen: 30 }],

  // Interesse / assunto
  ['interest',       { canonical: 'interest',         maxLen: 500 }],
  ['interesse',      { canonical: 'interest',         maxLen: 500 }],
  ['subject',        { canonical: 'interest',         maxLen: 500 }],
  ['assunto',        { canonical: 'interest',         maxLen: 500 }],
  ['message',        { canonical: 'interest',         maxLen: 500 }],
  ['mensagem',       { canonical: 'interest',         maxLen: 500 }],
  ['produto',        { canonical: 'interest',         maxLen: 500 }],
  ['servico',        { canonical: 'interest',         maxLen: 500 }],

  // Empresa do lead
  ['company',             { canonical: 'company_name',  maxLen: 255 }],
  ['empresa',             { canonical: 'company_name',  maxLen: 255 }],
  ['company_name',        { canonical: 'company_name',  maxLen: 255 }],
  ['nome_empresa',        { canonical: 'company_name',  maxLen: 255 }],
  ['cnpj',                { canonical: 'company_cnpj',  maxLen: 20  }],
  ['company_cnpj',        { canonical: 'company_cnpj',  maxLen: 20  }],
  ['documento',           { canonical: 'company_cnpj',  maxLen: 20  }],
  ['company_email',       { canonical: 'company_email', maxLen: 255, normalize: 'email' }],
  ['email_empresa',       { canonical: 'company_email', maxLen: 255, normalize: 'email' }],
  ['corporate_email',     { canonical: 'company_email', maxLen: 255, normalize: 'email' }],

  // Visitor / session
  ['visitor_id',     { canonical: 'visitor_id',       maxLen: 128 }],
  ['session_id',     { canonical: 'visitor_id',       maxLen: 128 }],

  // UTM / marketing
  ['campanha',         { canonical: 'campanha',          maxLen: 255 }],
  ['utm_campaign',     { canonical: 'campanha',          maxLen: 255 }],
  ['campaign',         { canonical: 'campanha',          maxLen: 255 }],
  ['campaign_name',    { canonical: 'campanha',          maxLen: 255 }],
  ['nome_campanha',    { canonical: 'campanha',          maxLen: 255 }],
  ['conjunto_anuncio', { canonical: 'conjunto_anuncio',  maxLen: 255 }],
  ['adset',            { canonical: 'conjunto_anuncio',  maxLen: 255 }],
  ['ad_set',           { canonical: 'conjunto_anuncio',  maxLen: 255 }],
  ['utm_content',      { canonical: 'conjunto_anuncio',  maxLen: 255 }],
  ['conjunto',         { canonical: 'conjunto_anuncio',  maxLen: 255 }],
  ['anuncio',          { canonical: 'anuncio',           maxLen: 255 }],
  ['ad',               { canonical: 'anuncio',           maxLen: 255 }],
  ['ad_name',          { canonical: 'anuncio',           maxLen: 255 }],
  ['utm_term',         { canonical: 'anuncio',           maxLen: 255 }],
  ['nome_anuncio',     { canonical: 'anuncio',           maxLen: 255 }],
  ['utm_medium',       { canonical: 'utm_medium',        maxLen: 100 }],
  ['medium',           { canonical: 'utm_medium',        maxLen: 100 }],
  ['midia',            { canonical: 'utm_medium',        maxLen: 100 }],
  ['mídia',            { canonical: 'utm_medium',        maxLen: 100 }],
  ['canal_midia',      { canonical: 'utm_medium',        maxLen: 100 }],
  ['utm_source',       { canonical: 'utm_source',        maxLen: 255 }],
  ['origin',           { canonical: 'utm_source',        maxLen: 255 }],
  ['origem',           { canonical: 'utm_source',        maxLen: 255 }],
  ['source',           { canonical: 'utm_source',        maxLen: 255 }],
  ['fonte',            { canonical: 'utm_source',        maxLen: 255 }],

  // Tags — tratamento especial (string ou array)
  ['tags',       { canonical: 'tags',   maxLen: null }],
  ['tag',        { canonical: 'tags',   maxLen: null }],
  ['etiquetas',  { canonical: 'tags',   maxLen: null }],
  ['etiqueta',   { canonical: 'tags',   maxLen: null }],

  // Referência externa
  ['ref',          { canonical: 'ref',        maxLen: 255 }],
  ['reference',    { canonical: 'ref',        maxLen: 255 }],
  ['id_externo',   { canonical: 'ref',        maxLen: 255 }],
  ['external_id',  { canonical: 'ref',        maxLen: 255 }],
  ['external_ref', { canonical: 'ref',        maxLen: 255 }],

  // Webhook / event id
  ['webhook_id',   { canonical: 'webhook_id', maxLen: 128 }],
  ['event_id',     { canonical: 'webhook_id', maxLen: 128 }],
]);

const MAX_FIELDS     = 50;
const MAX_CUSTOM_IDS = 20;
const MAX_CUSTOM_ID  = 99_999;
const MAX_CUSTOM_VAL = 500;
const MAX_TAGS       = 20;
const MAX_TAG_LEN    = 100;
const EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// sanitizePayload — sanitiza e normaliza req.body contra a whitelist
//
// Retorna:
//   isValid       : boolean
//   errors        : string[]   (mensagens de erro quando isValid=false)
//   canonical     : object     (campos em nome canônico, prontos para uso)
//   customFieldIds: object     (IDs numéricos → valor, ex: { "1": "texto" })
//   ignoredFields : { count, names }  (campos descartados, sem valores)
// ---------------------------------------------------------------------------
function sanitizePayload(rawBody) {
  const EMPTY = { isValid: false, errors: [], canonical: {}, customFieldIds: {}, ignoredFields: { count: 0, names: [] } };

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ...EMPTY, errors: ['Payload deve ser um objeto JSON'] };
  }

  const allKeys = Object.keys(rawBody);

  if (allKeys.length > MAX_FIELDS) {
    return { ...EMPTY, errors: [`Payload excede o limite de ${MAX_FIELDS} campos`] };
  }

  const errors        = [];
  const canonical     = {};
  const customFieldIds = {};
  const ignoredNames  = [];
  let customIdCount   = 0;

  for (const key of allKeys) {
    const keyLower = key.toLowerCase();
    const value    = rawBody[key];

    // 1. Campos bloqueados — rejeitar
    if (BLOCKED_FIELDS.has(keyLower)) {
      errors.push(`Campo não permitido no payload: ${key}`);
      continue;
    }

    // 2. Objetos aninhados — rejeitar (arrays tratados abaixo por caso)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      errors.push(`Campo ${key} não pode ser um objeto aninhado`);
      continue;
    }

    // 3. Campo numérico → custom field por ID
    if (/^\d+$/.test(key)) {
      const numId = parseInt(key, 10);
      if (numId < 1 || numId > MAX_CUSTOM_ID) {
        ignoredNames.push(key);
        continue;
      }
      if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
        errors.push(`Campo ${key} não pode ser array ou objeto`);
        continue;
      }
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        if (customIdCount < MAX_CUSTOM_IDS) {
          customFieldIds[key] = String(value).substring(0, MAX_CUSTOM_VAL).trim();
          customIdCount++;
        }
        // customIds extras silenciosamente descartados
      }
      continue;
    }

    // 4. Verificar whitelist
    const spec = FIELD_WHITELIST.get(keyLower);
    if (!spec) {
      ignoredNames.push(key);
      continue;
    }

    // 5. Tags — aceita string ou string[]
    if (spec.canonical === 'tags') {
      let tagArray = [];
      if (Array.isArray(value)) {
        tagArray = value;
      } else if (typeof value === 'string' && value.trim()) {
        tagArray = value.split(',');
      }
      const validTags = tagArray
        .filter(t => typeof t === 'string')
        .map(t => t.substring(0, MAX_TAG_LEN).trim())
        .filter(Boolean)
        .slice(0, MAX_TAGS);
      if (validTags.length > 0 && !canonical.tags) {
        canonical.tags = validTags;
      }
      continue;
    }

    // 6. Arrays onde não esperado — rejeitar
    if (Array.isArray(value)) {
      errors.push(`Campo ${key} não pode ser um array`);
      continue;
    }

    // 7. Valor vazio → drop silencioso
    const strRaw = (value === null || value === undefined) ? '' : String(value);
    const strVal = strRaw.trim();
    if (!strVal) continue;

    // 8. Truncar ao limite do campo
    const truncated = spec.maxLen ? strVal.substring(0, spec.maxLen) : strVal;

    // 9. Normalização específica
    const normalized = spec.normalize === 'email'
      ? truncated.toLowerCase()
      : truncated;

    // 10. Primeiro alias vence (não sobrescrever)
    if (!canonical[spec.canonical]) {
      canonical[spec.canonical] = normalized;
    }
  }

  // Campos bloqueados ou tipos inválidos → retornar inválido imediatamente
  if (errors.length > 0) {
    return {
      isValid:       false,
      errors,
      canonical:     {},
      customFieldIds: {},
      ignoredFields: { count: ignoredNames.length, names: ignoredNames },
    };
  }

  // Validar email se presente
  if (canonical.email) {
    if (!EMAIL_RE.test(canonical.email)) {
      if (canonical.phone) {
        // Email inválido mas há telefone → descartar email, continuar
        delete canonical.email;
      } else {
        return {
          isValid:       false,
          errors:        ['Email inválido e nenhum telefone fornecido'],
          canonical:     {},
          customFieldIds: {},
          ignoredFields: { count: ignoredNames.length, names: ignoredNames },
        };
      }
    }
  }

  // Exigir ao menos um identificador
  if (!canonical.name && !canonical.email && !canonical.phone) {
    return {
      isValid:       false,
      errors:        ['Pelo menos nome, email ou telefone é obrigatório'],
      canonical:     {},
      customFieldIds: {},
      ignoredFields: { count: ignoredNames.length, names: ignoredNames },
    };
  }

  return {
    isValid:       true,
    errors:        [],
    canonical,
    customFieldIds,
    ignoredFields: { count: ignoredNames.length, names: ignoredNames },
  };
}

// Função para disparar webhooks avançados automaticamente
// supabase: client passado pelo caller (svcClient) — sem criação interna de credenciais
async function triggerAdvancedWebhooks(leadData, companyId, supabase) {
  try {
    // 1. Buscar configurações ativas de webhook para lead_created
    const { data: configs, error: configError } = await supabase.rpc('get_webhook_trigger_configs', {
      p_company_id: companyId
    });
    
    if (configError) {
      console.error('❌ Erro ao buscar configurações:', configError);
      return;
    }
    
    // Filtrar configurações ativas para lead_created
    
    const activeConfigs = configs?.filter(config => 
      config.is_active && 
      config.trigger_events?.includes('lead_created')
    ) || [];
    
    if (activeConfigs.length > 0) {
      console.log(`📋 Processando ${activeConfigs.length} webhook(s) para lead_created`);
    }
    
    if (activeConfigs.length === 0) {
      console.log('⚠️ Nenhuma configuração de webhook ativa encontrada');
      return;
    }
    
    // 2. Disparar cada webhook
    for (const config of activeConfigs) {
      console.log(`🎯 Disparando webhook: ${config.name}`);
      
      // Construir payload dinâmico baseado nos campos selecionados
      const defaultLeadFields = ['name', 'email', 'phone', 'status', 'origin'];
      const selectedLeadFields = config.payload_fields?.lead || defaultLeadFields;
      
      // Dados disponíveis do lead (todos os campos da tabela leads)
      const availableLeadData = {
        id: leadData.lead_id,
        name: leadData.name,
        email: leadData.email,
        phone: leadData.phone,
        status: leadData.status || 'new',
        origin: leadData.origin || 'webhook',
        interest: leadData.interest,
        responsible_user_id: leadData.responsible_user_id,
        created_at: new Date().toISOString(),
        updated_at: leadData.updated_at,
        // Campos da empresa do lead
        company_name: leadData.company_name,
        company_cnpj: leadData.company_cnpj,
        company_razao_social: leadData.company_razao_social,
        company_nome_fantasia: leadData.company_nome_fantasia,
        company_telefone: leadData.company_telefone,
        company_email: leadData.company_email,
        company_site: leadData.company_site,
        company_cidade: leadData.company_cidade,
        company_estado: leadData.company_estado,
        company_cep: leadData.company_cep,
        company_endereco: leadData.company_endereco
      };
      
      // Construir objeto lead apenas com campos selecionados
      const leadPayload = { id: availableLeadData.id }; // ID sempre incluído
      
      // Adicionar campos do lead selecionados
      selectedLeadFields.forEach(field => {
        if (availableLeadData[field] !== undefined && availableLeadData[field] !== null) {
          leadPayload[field] = availableLeadData[field];
        } else {
          console.log(`⚠️ Campo do lead não disponível: ${field}`);
        }
      });
      
      // Adicionar campos da empresa do lead selecionados
      const selectedCompanyFields = config.payload_fields?.empresa || [];
      
      selectedCompanyFields.forEach(field => {
        if (availableLeadData[field] !== undefined && availableLeadData[field] !== null) {
          leadPayload[field] = availableLeadData[field];
        }
      });
      
      
      // Adicionar campos personalizados selecionados - NOVO E SEGURO
      const selectedCustomFields = config.payload_fields?.custom_fields || [];
      // Processar campos personalizados selecionados
      
      if (selectedCustomFields.length > 0) {
        try {
          // CORREÇÃO: Usar dados já processados em vez de buscar no banco
          // Isso evita o timing issue onde a busca acontece antes do commit
          const customFieldsFromProcessed = leadData.custom_fields_processed || [];
          
          // Converter para formato compatível com a lógica existente
          const customValues = customFieldsFromProcessed.map(cf => ({
            field_id: cf.field_id,
            value: cf.value,
            lead_custom_fields: {
              numeric_id: cf.numeric_id,
              field_name: cf.field_name || `campo_${cf.numeric_id}`,
              field_label: cf.field_label || `Campo ${cf.numeric_id}`
            }
          }));
          
          if (customValues && customValues.length > 0) {
            // Adicionar campos personalizados selecionados ao payload
            let includedCount = 0;
            customValues.forEach((customValue) => {
              const fieldNumericId = customValue.lead_custom_fields?.numeric_id?.toString();
              const fieldId = customValue.field_id;
              
              // Verificar se este campo foi selecionado (por ID numérico ou UUID)
              if (selectedCustomFields.includes(fieldNumericId) || selectedCustomFields.includes(fieldId)) {
                const fieldKey = fieldNumericId || fieldId;
                leadPayload[fieldKey] = customValue.value;
                includedCount++;
              }
            });
            
            if (includedCount > 0) {
              console.log(`✅ ${includedCount} campos personalizados incluídos no payload`);
            }
          } else {
            console.log('ℹ️ Nenhum valor de campo personalizado encontrado para este lead');
          }
        } catch (error) {
          console.error('❌ Erro ao processar campos personalizados:', error);
          // Falha silenciosa para não quebrar o webhook
        }
      }
      
      // Construir payload APÓS adicionar todos os campos (incluindo personalizados)
      const payload = {
        event: 'lead_created',
        timestamp: new Date().toISOString(),
        data: {
          lead: leadPayload
        }
      };
      
      // Payload construído com todos os campos (incluindo personalizados)
      
      // Fazer requisição HTTP
      const startTime = Date.now();
      try {
        const response = await fetch(config.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...config.headers
          },
          body: JSON.stringify(payload)
        });
        
        const responseText = await response.text();
        
        console.log(`📥 Resposta: ${response.status} ${response.statusText}`);
        console.log(`📄 Body: ${responseText}`);
        
        // Registrar log no banco de dados (MESMO payload enviado)
        try {
          const { data: logResult, error: logError } = await supabase
            .from('webhook_trigger_logs')
            .insert({
              config_id: config.id,
              company_id: companyId,
              lead_id: leadData.lead_id,
              event_type: 'lead_created',
              payload: payload,
              webhook_url: config.webhook_url,
              response_status: response.status,
              response_body: responseText,
              response_headers: {},
              error_message: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
              execution_time_ms: Date.now() - startTime
            });
          
          if (logError) {
            console.error('❌ Erro ao registrar log:', logError);
          } else {
            console.log('✅ Log registrado no banco de dados');
          }
        } catch (logError) {
          console.error('❌ Erro ao registrar log:', logError);
        }
        
        if (response.ok) {
          console.log(`✅ Webhook ${config.name} disparado com sucesso`);
        } else {
          console.log(`❌ Webhook ${config.name} falhou: ${response.status}`);
        }
        
      } catch (fetchError) {
        console.error(`❌ Erro ao disparar webhook ${config.name}:`, fetchError.message);
        
        // Registrar erro no log (MESMO payload que tentou enviar)
        try {
          await supabase
            .from('webhook_trigger_logs')
            .insert({
              config_id: config.id,
              company_id: companyId,
              lead_id: leadData.lead_id,
              event_type: 'lead_created',
              payload: payload,
              webhook_url: config.webhook_url,
              response_status: null,
              response_body: null,
              response_headers: {},
              error_message: fetchError.message,
              execution_time_ms: Date.now() - startTime
            });
          console.log('✅ Log de erro registrado no banco de dados');
        } catch (logError) {
          console.error('❌ Erro ao registrar log de erro:', logError);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Erro geral ao disparar webhooks:', error);
  }
}

// ---------------------------------------------------------------------------
// callRateLimit — chama a RPC atômica de rate limiting
//
// Fail-closed em produção: qualquer falha na RPC bloqueia a requisição,
// evitando que instabilidade do banco seja explorada para bypass.
// Em dev/staging: fail-open para não bloquear desenvolvimento.
// ---------------------------------------------------------------------------
async function callRateLimit(anonClient, params) {
  try {
    const { data, error } = await anonClient.rpc(
      'check_and_log_webhook_rate_limit',
      params
    );
    if (error) {
      console.error('[webhook-lead] rate limit RPC error', { message: error.message });
      if (process.env.NODE_ENV === 'production') {
        return { allowed: false, error: 'rate_limit_unavailable' };
      }
      return { allowed: true, error: error.message };
    }
    return data || { allowed: false, error: 'no_response' };
  } catch (err) {
    console.error('[webhook-lead] rate limit exception', { message: err?.message });
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, error: 'rate_limit_unavailable' };
    }
    return { allowed: true, error: err?.message };
  }
}

export default async function handler(req, res) {

  // Set CORS headers (mesmo padrão do webhook-visitor)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    // ── 1. Rejeição de lote ───────────────────────────────────────────────────
    const BATCH_FIELDS = ['leads', 'contacts', 'items', 'records'];
    const batchError   = { error: 'validation_error', message: 'Envie apenas um lead por requisição' };
    if (Array.isArray(req.body)) return res.status(400).json(batchError);
    if (req.body && typeof req.body === 'object') {
      for (const field of BATCH_FIELDS) {
        if (Array.isArray(req.body[field])) return res.status(400).json(batchError);
      }
    }

    // ── 2. Tamanho do payload ─────────────────────────────────────────────────
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'payload_too_large', message: 'Payload excede o limite permitido.' });
    }

    // ── 3. Presença da api_key ────────────────────────────────────────────────
    const api_key = req.body?.api_key;
    if (!api_key) {
      return res.status(400).json({ error: 'validation_error', message: 'api_key is required' });
    }

    // ── 4. Metadados imutáveis da requisição ──────────────────────────────────
    const requestId   = generateUUID();
    const apiKeyHash  = createHash('sha256').update(api_key).digest('hex');
    const ip          = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                     || req.socket?.remoteAddress
                     || 'unknown';
    const userAgent   = req.headers['user-agent'] || null;
    const payloadSize = contentLength || null;

    // ── 5. Clientes Supabase — fail-fast se env var ausente ───────────────────
    // Sem fallback hardcoded: ausência de env var falha explicitamente com 500
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL
                     || process.env.NEXT_PUBLIC_SUPABASE_URL
                     || process.env.VITE_SUPABASE_URL;
    const anonKey     = process.env.SUPABASE_ANON_KEY
                     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                     || process.env.VITE_SUPABASE_ANON_KEY;
    const svcKey      = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl) throw new Error('[webhook-lead] Missing SUPABASE_URL env var');
    if (!anonKey)     throw new Error('[webhook-lead] Missing Supabase anon key env var');
    if (!svcKey)      throw new Error('[webhook-lead] Missing SUPABASE_SERVICE_ROLE_KEY env var');
    const anonClient  = createClient(supabaseUrl, anonKey);
    const svcClient   = createClient(supabaseUrl, svcKey);

    // ── 6. Rate limit pré-auth — IP + hash (anti brute-force) ────────────────
    const preAuth = await callRateLimit(anonClient, {
      p_request_id:   requestId,
      p_company_id:   null,
      p_api_key_hash: apiKeyHash,
      p_ip_address:   ip,
      p_method:       'POST',
      p_path:         '/api/webhook-lead',
      p_user_agent:   userAgent,
      p_payload_size: payloadSize,
    });
    if (!preAuth.allowed) {
      return res.status(429).json({ error: 'rate_limited', message: 'Muitas requisições. Tente novamente em instantes.' });
    }

    // ── 7. Resolver company_id via service_role ───────────────────────────────
    // company_id vem EXCLUSIVAMENTE deste lookup — nunca de req.body
    const { data: companyRow } = await svcClient
      .from('companies').select('id').eq('api_key', api_key).single();
    const companyId = companyRow?.id || null;
    if (!companyId) {
      anonClient.rpc('log_webhook_invalid_key', {
        p_request_id:   requestId,
        p_api_key_hash: apiKeyHash,
        p_ip_address:   ip,
        p_method:       'POST',
        p_path:         '/api/webhook-lead',
      }).catch(err => console.error('[webhook-lead] Failed to log invalid key', { message: err?.message }));
      return res.status(401).json({ error: 'invalid_key', message: 'API key inválida' });
    }

    // ── 8. Rate limit pós-auth — por company_id ───────────────────────────────
    const postAuth = await callRateLimit(anonClient, {
      p_request_id:   requestId,
      p_company_id:   companyId,
      p_api_key_hash: apiKeyHash,
      p_ip_address:   ip,
      p_method:       'POST',
      p_path:         '/api/webhook-lead',
      p_user_agent:   userAgent,
      p_payload_size: payloadSize,
    });
    if (!postAuth.allowed) {
      return res.status(429).json({ error: 'rate_limited', message: 'Limite de importações atingido. Tente novamente em instantes.' });
    }

    // ── 9. Sanitização — whitelist + validação + normalização ────────────────
    // Após este ponto, req.body nunca é usado — apenas canonical e customFieldIds
    const sanitized = sanitizePayload(req.body);
    if (!sanitized.isValid) {
      const errorMsg = sanitized.errors[0] || 'validation_error';
      // Log técnico (company_id já resolvido neste ponto)
      anonClient.rpc('update_webhook_log_result', {
        p_request_id: requestId,
        p_result:     'validation_error',
        p_error_code: String(errorMsg).substring(0, 100),
      }).catch(() => {});
      // Log funcional — permite visualização no histórico de importações
      svcClient.rpc('log_lead_import_event', {
        p_company_id:         companyId,
        p_status:             'error',
        p_error_code:         'validation_error',
        p_error_message:      errorMsg,
        p_lead_id:            null,
        p_payload_summary:    null,
        p_external_reference: null,
      }).catch(err => console.error('[webhook-lead] Failed to log validation_error event', { message: err?.message }));
      return res.status(400).json({ error: 'validation_error', message: errorMsg });
    }
    const { canonical, customFieldIds, ignoredFields } = sanitized;

    // ── 10. Criação atômica do lead via RPC restrita a service_role ───────────
    // company_id vem do step 7 — nunca de req.body nem de canonical
    // A RPC valida empresa ativa + max_leads + deduplica + insere em uma transação
    const { data: lead, error: leadError } = await svcClient.rpc('create_lead_from_company', {
      p_company_id: companyId,
      lead_data: {
        name:             canonical.name             || 'Lead sem nome',
        email:            canonical.email            || null,
        phone:            canonical.phone            || null,
        interest:         canonical.interest         || null,
        company_name:     canonical.company_name     || null,
        company_cnpj:     canonical.company_cnpj     || null,
        company_email:    canonical.company_email    || null,
        visitor_id:       canonical.visitor_id       || null,
        campanha:         canonical.campanha         || null,
        conjunto_anuncio: canonical.conjunto_anuncio || null,
        anuncio:          canonical.anuncio          || null,
        utm_medium:       canonical.utm_medium       || null,
      },
    });

    if (leadError) {
      console.error('[webhook-lead] RPC create_lead_from_company error', { message: leadError.message });
      anonClient.rpc('update_webhook_log_result', {
        p_request_id: requestId, p_result: 'error', p_error_code: 'rpc_error',
      }).catch(() => {});
      return res.status(500).json({ success: false, error: 'internal_error' });
    }

    if (!lead?.success) {
      const errCode = lead?.error || 'unknown';

      if (errCode === 'plan_limit_exceeded') {
        const payloadSummary = {
          name:  canonical.name  || null,
          email: canonical.email || null,
          phone: canonical.phone || null,
        };
        svcClient.rpc('log_lead_import_event', {
          p_company_id:      companyId,
          p_status:          'plan_limit',
          p_error_code:      'plan_limit_exceeded',
          p_error_message:   `Limite de ${lead.max_allowed ?? '?'} leads atingido`,
          p_lead_id:         null,
          p_payload_summary: payloadSummary,
          p_external_reference: null,
        }).catch(err => console.error('[webhook-lead] Failed to log plan_limit event', { message: err?.message }));
        anonClient.rpc('update_webhook_log_result', {
          p_request_id: requestId, p_result: 'plan_limit',
        }).catch(() => {});
        return res.status(403).json({ error: 'plan_limit', message: 'Limite de leads do plano atingido.' });
      }

      if (errCode === 'company_not_found') {
        anonClient.rpc('update_webhook_log_result', {
          p_request_id: requestId, p_result: 'error', p_error_code: 'company_not_found',
        }).catch(() => {});
        return res.status(401).json({ error: 'invalid_key', message: 'Empresa não encontrada.' });
      }

      if (errCode === 'company_inactive') {
        anonClient.rpc('update_webhook_log_result', {
          p_request_id: requestId, p_result: 'error', p_error_code: 'company_inactive',
        }).catch(() => {});
        return res.status(403).json({ error: 'company_inactive', message: 'Empresa suspensa ou cancelada.' });
      }

      console.error('[webhook-lead] RPC returned failure', { error: errCode });
      anonClient.rpc('update_webhook_log_result', {
        p_request_id: requestId, p_result: 'error',
        p_error_code: String(errCode).substring(0, 100),
      }).catch(() => {});
      return res.status(500).json({ success: false, error: 'internal_error' });
    }

    // ── 11. Pipeline pós-criação ──────────────────────────────────────────────
    await executeLeadPipeline(lead, canonical, customFieldIds, { svcClient, anonClient, requestId, ignoredFields });

    return res.status(200).json({ success: true, lead_id: lead.lead_id });

  } catch (error) {
    console.error('[webhook-lead] Unhandled exception', { message: error?.message });
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
}

// ---------------------------------------------------------------------------
// logImportEvent — registra cada desfecho de importação na tabela funcional
//
// REGRA CRÍTICA: companyId deve vir SEMPRE da validação da api_key no backend
// (lead.company_id retornado pela RPC create_lead_from_company via svcClient).
// NUNCA passar companyId vindo de req.body ou de qualquer campo do payload.
//
// A falha ao gravar o log NÃO impede a criação do lead nem altera a resposta,
// mas é capturada e registrada no log técnico sem dados sensíveis.
// ---------------------------------------------------------------------------
async function logImportEvent(supabase, companyId, status, opts = {}) {
  try {
    await supabase.rpc('log_lead_import_event', {
      p_company_id:         companyId,
      p_status:             status,
      p_error_code:         opts.errorCode     || null,
      p_error_message:      opts.errorMessage  || null,
      p_lead_id:            opts.leadId        || null,
      p_payload_summary:    opts.summary       || null,
      p_external_reference: opts.ref           || null,
    });
  } catch (err) {
    console.error('[webhook-lead] Failed to log lead import event', {
      status,
      company_id: companyId,
      error_code: opts.errorCode || null,
      message: err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// executeLeadPipeline — processa tudo após a criação do lead
//
// Usa canonical (dados sanitizados) e customFieldIds (mapa ID→valor).
// Nenhuma referência a req.body ou form_data após este ponto.
// Erros em cada etapa são capturados individualmente para não interromper o fluxo.
// ---------------------------------------------------------------------------
async function executeLeadPipeline(lead, canonical, customFieldIds, { svcClient, anonClient, requestId, ignoredFields }) {
  const companyId = lead.company_id;

  // 1. Visitor connection
  try {
    if (canonical.visitor_id) {
      await processVisitorConnection(svcClient, lead.lead_id, companyId, canonical.visitor_id, canonical);
    } else {
      await processRetroactiveVisitorSearch(svcClient, lead.lead_id, companyId, canonical);
    }
  } catch (err) {
    console.error('[webhook-lead] Visitor connection failed', { message: err?.message });
  }

  // 2. Campos personalizados — processar + inserir
  let customFieldsProcessed = [];
  try {
    customFieldsProcessed = await processCustomFieldsFromIds(svcClient, companyId, customFieldIds);
    if (customFieldsProcessed.length > 0) {
      const customValues = customFieldsProcessed.map(field => ({
        lead_id:  lead.lead_id,
        field_id: field.field_id,
        value:    String(field.value),
      }));
      const { data: insertResult, error: customError } = await svcClient
        .rpc('insert_custom_field_values_webhook', {
          lead_id_param: lead.lead_id,
          field_values:  customValues,
        });
      if (customError) {
        console.error('[webhook-lead] Custom fields insert error', { message: customError.message });
      } else if (!insertResult?.success) {
        console.error('[webhook-lead] Custom fields RPC returned failure', insertResult);
      }
    }
  } catch (err) {
    console.error('[webhook-lead] Custom fields pipeline error', { message: err?.message });
  }

  // 3. Tags — array já normalizado pelo sanitizePayload
  try {
    if (canonical.tags?.length > 0) {
      await processTagsForLead(svcClient, companyId, lead.lead_id, canonical.tags);
    }
  } catch (err) {
    console.error('[webhook-lead] Tags pipeline error', { message: err?.message });
  }

  // 4. Webhooks avançados — svcClient passado diretamente
  try {
    await triggerAdvancedWebhooks({
      lead_id:                 lead.lead_id,
      name:                    canonical.name  || 'Lead sem nome',
      email:                   canonical.email || null,
      phone:                   canonical.phone || null,
      custom_fields_processed: customFieldsProcessed,
    }, companyId, svcClient);
  } catch (err) {
    console.error('[webhook-lead] Advanced webhooks error', { message: err?.message });
  }

  // 5. Automação — somente leads novos
  if (!lead.is_duplicate) {
    try {
      await dispatchLeadCreatedTrigger({ companyId, leadId: lead.lead_id, source: 'webhook' });
    } catch (err) {
      console.error('[webhook-lead] Automation trigger failed', { message: err?.message });
    }
  }

  // 6. Reentrada — somente duplicados
  if (lead.is_duplicate && lead.duplicate_of_lead_id) {
    const supabaseAdmin = getSupabaseAdmin();
    const payloadRef    = { name: canonical.name, phone: canonical.phone, email: canonical.email };
    try {
      await handleLeadReentry({
        newLeadId:       lead.lead_id,
        existingLeadId:  lead.duplicate_of_lead_id,
        companyId,
        source:          'webhook',
        externalEventId: canonical.webhook_id  || null,
        originChannel:   canonical.utm_source  || null,
        metadata:        { payload_hash: hashPayload(payloadRef) },
        supabase:        supabaseAdmin,
      });
    } catch (err) {
      console.error('[webhook-lead] Lead reentry failed', { message: err?.message });
    }
  }

  // 7. Log funcional (lead_import_events)
  await logImportEvent(svcClient, companyId, lead.is_duplicate ? 'duplicate' : 'success', {
    leadId:  lead.is_duplicate ? (lead.duplicate_of_lead_id || lead.lead_id) : lead.lead_id,
    summary: { name: canonical.name || null, email: canonical.email || null, phone: canonical.phone || null },
    ref:     canonical.ref || null,
  });

  // 8. Log técnico (webhook_api_logs) — inclui metadados de campos ignorados
  const logMetadata = ignoredFields?.count > 0
    ? { ignored_fields_count: ignoredFields.count, ignored_fields_names: ignoredFields.names }
    : null;
  anonClient.rpc('update_webhook_log_result', {
    p_request_id: requestId,
    p_result:     lead.is_duplicate ? 'duplicate' : 'success',
    p_lead_id:    lead.lead_id,
    p_metadata:   logMetadata,
  }).catch(err => console.error('[webhook-lead] Failed to update webhook log result', { message: err?.message }));
}

// detectFormFields removida na Fase 5 — substituída por sanitizePayload + FIELD_WHITELIST

// ---------------------------------------------------------------------------
// processCustomFieldsFromIds — processa campos personalizados a partir do mapa
// de IDs numéricos extraído pelo sanitizePayload (ex: { "1": "valor", "42": "outro" }).
//
// Substitui processCustomFields + lógica de extração de IDs do formData bruto.
// ---------------------------------------------------------------------------
async function processCustomFieldsFromIds(supabase, companyId, customFieldIds) {
  const customFields = [];
  try {
    for (const [fieldId, fieldValue] of Object.entries(customFieldIds)) {
      if (!fieldValue) continue;
      const customField = await processCustomFieldById(supabase, companyId, parseInt(fieldId, 10), fieldValue);
      if (customField) {
        customFields.push(customField);
      }
    }
  } catch (error) {
    console.error('[webhook-lead] processCustomFieldsFromIds error', { message: error?.message });
  }
  return customFields;
}

async function processCustomField(supabase, companyId, fieldName, fieldValue) {
  try {
    // 1. Normalizar nome do campo
    const normalizedFieldName = normalizeFieldName(fieldName);
    const fieldLabel = generateFieldLabel(fieldName);

    // 2. Verificar se campo já existe
    const { data: existingField, error: searchError } = await supabase
      .from('lead_custom_fields')
      .select('id, field_name, field_type')
      .eq('company_id', companyId)
      .eq('field_name', normalizedFieldName)
      .single();
    
    console.log(`    - Resultado da busca:`, { existingField, searchError });
    
    if (searchError && searchError.code !== 'PGRST116') { // PGRST116 = not found
      console.error('    - ❌ ERRO ao buscar campo existente:', searchError);
      return null;
    }
    
    let fieldId;
    
    if (existingField) {
      // 3a. Campo existe - usar existente
      console.log(`    - ✅ Campo existente encontrado: ${existingField.id}`);
      fieldId = existingField.id;
    } else {
      // 3b. Campo não existe - criar automaticamente via RPC (contorna RLS)
      console.log(`    - 🆕 Criando novo campo personalizado via RPC: ${normalizedFieldName}`);
      
      const fieldType = detectFieldType(fieldValue);
      console.log(`    - Tipo detectado: ${fieldType}`);
      
      console.log(`    - Chamando RPC create_custom_field_webhook...`);
      const { data: rpcResult, error: rpcError } = await supabase
        .rpc('create_custom_field_webhook', {
          p_company_id: companyId,
          p_field_name: normalizedFieldName,
          p_field_label: fieldLabel,
          p_field_type: fieldType,
          p_is_required: false
        });
      
      console.log(`    - Resultado da RPC:`, { rpcResult, rpcError });
      
      if (rpcError) {
        console.error('    - ❌ ERRO na RPC create_custom_field_webhook:', rpcError);
        return null;
      }
      
      if (!rpcResult || rpcResult.length === 0) {
        console.error('    - ❌ RPC retornou resultado vazio');
        return null;
      }
      
      const result = rpcResult[0];
      if (!result.success) {
        console.error('    - ❌ RPC falhou:', result.error_message);
        return null;
      }
      
      fieldId = result.field_id;
      console.log(`    - ✅ Campo criado via RPC com ID: ${fieldId}`);
    }
    
    // Buscar dados completos do campo para consistência
    let fieldData = null;
    if (existingField) {
      fieldData = existingField;
    } else {
      // Para campos criados, buscar dados completos
      const { data: createdField } = await supabase
        .from('lead_custom_fields')
        .select('*')
        .eq('id', fieldId)
        .single();
      fieldData = createdField;
    }
    
    return {
      field_id: fieldId,
      value: fieldValue,
      numeric_id: fieldData?.numeric_id,    // ✅ ADICIONAR para webhook
      field_name: fieldData?.name,          // ✅ ADICIONAR para webhook
      field_label: fieldData?.field_label   // ✅ ADICIONAR para webhook
    };
    
  } catch (error) {
    console.error(`Erro ao processar campo ${fieldName}:`, error);
    return null;
  }
}

function normalizeFieldName(fieldName) {
  // Converter para snake_case e remover caracteres especiais
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function generateFieldLabel(fieldName) {
  // Gerar label legível a partir do nome do campo
  return fieldName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
}

function detectFieldType(value) {
  // Detectar tipo do campo baseado no valor
  if (typeof value === 'boolean' || value === 'true' || value === 'false') {
    return 'boolean';
  }
  
  if (typeof value === 'number' || (!isNaN(value) && !isNaN(parseFloat(value)))) {
    return 'number';
  }
  
  // Detectar data (formatos comuns)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/;
  if (dateRegex.test(String(value))) {
    return 'date';
  }
  
  // Por padrão, usar texto
  return 'text';
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// NOVA FUNÇÃO: Processar conexão com visitor (OPCIONAL - não quebra compatibilidade)
async function processVisitorConnection(supabase, leadId, companyId, visitorId, detectedFields) {
  try {
    console.log('Processando conexão visitor-lead:', { leadId, visitorId });
    
    // 1. Buscar dados comportamentais do visitante
    const visitorData = await getVisitorBehaviorData(supabase, visitorId);
    
    if (visitorData) {
      // 2. Calcular engagement score baseado nos dados
      const engagementScore = calculateEngagementScore(visitorData);
      
      // 3. Criar registro na tabela conversions (conecta analytics + CRM)
      const conversionData = {
        id: generateUUID(),
        visitor_id: visitorId,
        landing_page_id: visitorData.landing_page_id,
        form_data: {
          name: detectedFields.name,
          email: detectedFields.email,
          phone: detectedFields.phone,
          company: detectedFields.company_name,
          interest: detectedFields.interest
        },
        behavior_summary: {
          session_duration: visitorData.session_duration || 0,
          device_type: visitorData.device_type || 'unknown',
          referrer: visitorData.referrer || 'direct',
          user_agent: visitorData.user_agent || 'unknown',
          engagement_score: engagementScore,
          lead_id: leadId // NOVA: Conexão com lead criado
        },
        engagement_score: engagementScore,
        time_to_convert: visitorData.session_duration || 0,
        webhook_sent: true,
        webhook_response: { success: true, lead_id: leadId },
        converted_at: new Date().toISOString()
      };
      
      // 4. Verificar se já existe conversão para este visitor (evitar duplicatas)
      const { data: existingConversion } = await supabase
        .from('conversions')
        .select('id')
        .eq('visitor_id', visitorId)
        .limit(1)
        .single();
      
      if (existingConversion) {
        console.log('Conversão já existe para este visitor - pulando criação');
      } else {
        // 5. Inserir conversão (conecta visitor + lead)
        const { error: conversionError } = await supabase
          .from('conversions')
          .insert(conversionData);
        
        if (conversionError) {
          console.error('Erro ao criar conversão:', conversionError);
          // NÃO falha o lead - apenas log do erro
        } else {
          console.log('Conversão criada com sucesso - Lead conectado ao analytics');
        }
      }
      
      // 6. Atualizar lead com visitor_id (se campo existir)
      const { error: updateError } = await supabase
        .from('leads')
        .update({ visitor_id: visitorId })
        .eq('id', leadId);
      
      if (updateError) {
        console.error('Erro ao atualizar visitor_id no lead:', updateError);
        // NÃO falha - apenas log
      } else {
        console.log('Lead atualizado com visitor_id');
      }
    } else {
      console.log('Dados comportamentais não encontrados para visitor:', visitorId);
    }
    
  } catch (error) {
    console.error('Erro no processamento visitor-lead:', error);
    // NÃO falha o lead - sistema robusto
  }
}

// Buscar dados comportamentais do visitante
async function getVisitorBehaviorData(supabase, visitorId) {
  try {
    const { data: visitor, error } = await supabase
      .from('visitors')
      .select('*')
      .eq('visitor_id', visitorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !visitor) {
      console.log('Visitante não encontrado:', visitorId);
      return null;
    }
    
    // Calcular duração da sessão (aproximada)
    const sessionDuration = visitor.created_at 
      ? Math.floor((new Date() - new Date(visitor.created_at)) / 1000)
      : 0;
    
    return {
      ...visitor,
      session_duration: sessionDuration
    };
    
  } catch (error) {
    console.error('Erro ao buscar dados do visitante:', error);
    return null;
  }
}

// Calcular score de engagement baseado nos dados
function calculateEngagementScore(visitorData) {
  let score = 0;
  
  // Base score por ter visitado
  score += 2;
  
  // Score por duração da sessão
  if (visitorData.session_duration > 30) score += 2;
  if (visitorData.session_duration > 60) score += 2;
  if (visitorData.session_duration > 120) score += 2;
  
  // Score por dispositivo (desktop = mais engajado)
  if (visitorData.device_type === 'desktop') score += 1;
  
  // Score por origem (direct = mais qualificado)
  if (!visitorData.referrer || visitorData.referrer === 'direct') score += 1;
  
  // Máximo 10
  return Math.min(score, 10);
}

// NOVA FUNÇÃO: Busca retroativa inteligente (quando não tem visitor_id)
async function processRetroactiveVisitorSearch(supabase, leadId, companyId, detectedFields) {
  try {
    console.log('Iniciando busca retroativa para conectar visitor-lead');
    
    // 1. Buscar visitantes recentes que podem corresponder ao lead
    const potentialVisitors = await findPotentialVisitors(supabase, detectedFields);
    
    if (potentialVisitors && potentialVisitors.length > 0) {
      // 2. Usar o visitante mais recente (mais provável)
      const bestMatch = potentialVisitors[0];
      console.log('Possível correspondência encontrada:', bestMatch.visitor_id);
      
      // 3. Processar como se tivesse visitor_id
      await processVisitorConnection(supabase, leadId, companyId, bestMatch.visitor_id, detectedFields);
      
    } else {
      console.log('Nenhum visitante correspondente encontrado - lead criado sem score');
    }
    
  } catch (error) {
    console.error('Erro na busca retroativa:', error);
    // NÃO falha o lead - sistema robusto
  }
}

// Buscar visitantes que podem corresponder ao lead
async function findPotentialVisitors(supabase, detectedFields) {
  try {
    // Buscar visitantes das últimas 2 horas (janela razoável para conversão)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: visitors, error } = await supabase
      .from('visitors')
      .select('*')
      .gte('created_at', twoHoursAgo)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error || !visitors || visitors.length === 0) {
      console.log('Nenhum visitante recente encontrado');
      return null;
    }
    
    // Filtrar visitantes que fazem sentido
    const filteredVisitors = visitors.filter(visitor => {
      // Critérios de correspondência:
      
      // 1. Deve ter visitor_id (para remarketing)
      if (!visitor.visitor_id) return false;
      
      // 2. Não deve já ter conversão (evitar duplicatas)
      // (Isso será verificado na função de conversão)
      
      // 3. Preferir visitantes mais recentes
      const visitTime = new Date(visitor.created_at);
      const now = new Date();
      const diffMinutes = (now - visitTime) / (1000 * 60);
      
      // Visitantes das últimas 30 minutos têm prioridade
      if (diffMinutes <= 30) return true;
      
      // Visitantes até 2 horas são considerados
      return diffMinutes <= 120;
    });
    
    console.log(`Encontrados ${filteredVisitors.length} visitantes potenciais`);
    return filteredVisitors;
    
  } catch (error) {
    console.error('Erro ao buscar visitantes potenciais:', error);
    return null;
  }
}

// Gerar UUID simples
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Nova função para processar campos personalizados por ID numérico
async function processCustomFieldById(supabase, companyId, numericId, value) {
  try {
    
    // Buscar campo personalizado pelo ID numérico usando RPC (contorna RLS)
    const { data: fieldData, error: fieldError } = await supabase
      .rpc('get_custom_field_by_id', {
        p_company_id: companyId,
        p_numeric_id: numericId
      })
      .single();
    
    if (fieldError) {
      console.log(`- ❌ Campo com ID ${numericId} não encontrado:`, fieldError);
      console.log(`- 📋 Para usar este ID, crie o campo na interface de Campos Personalizados`);
      return null;
    }
    
    console.log(`- ✅ Campo encontrado:`, fieldData);
    console.log(`- Nome: ${fieldData.name}`);
    console.log(`- Tipo: ${fieldData.field_type}`);
    console.log(`- ID: ${fieldData.id}`);
    
    // Retornar dados completos para inserção E webhook
    return {
      field_id: fieldData.id,
      value: String(value),
      numeric_id: fieldData.numeric_id,    // ✅ ADICIONAR para webhook
      field_name: fieldData.name,          // ✅ ADICIONAR para webhook
      field_label: fieldData.field_label   // ✅ ADICIONAR para webhook
    };
    
  } catch (error) {
    console.error(`❌ ERRO ao processar campo por ID ${numericId}:`, error);
    return null;
  }
}

// ─── Tags ────────────────────────────────────────────────────────────────────

async function processTagsForLead(supabase, companyId, leadId, rawTags) {
  try {
    // Normalizar para array de nomes
    let tagNames = [];
    if (Array.isArray(rawTags)) {
      tagNames = rawTags.map(t => String(t).trim()).filter(Boolean);
    } else {
      tagNames = String(rawTags).split(',').map(t => t.trim()).filter(Boolean);
    }

    if (tagNames.length === 0) return;

    console.log(`🏷️ Processando ${tagNames.length} tag(s):`, tagNames);

    // Buscar tags existentes da empresa (case-insensitive)
    const { data: existingTags, error: fetchError } = await supabase
      .from('lead_tags')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (fetchError) {
      console.error('❌ Erro ao buscar tags:', fetchError);
      return;
    }

    const resolvedTagIds = [];

    for (const tagName of tagNames) {
      const normalized = tagName.toLowerCase();

      // Verificar se já existe (case-insensitive)
      const found = (existingTags || []).find(t => t.name.toLowerCase() === normalized);

      if (found) {
        console.log(`✅ Tag encontrada: "${tagName}" → ${found.id}`);
        resolvedTagIds.push(found.id);
      } else {
        // Criar tag automaticamente
        console.log(`🆕 Criando tag: "${tagName}"`);
        const { data: created, error: createError } = await supabase
          .rpc('lead_tags_operations_safe', {
            p_company_id: companyId,
            p_action: 'create',
            p_tag_data: { name: tagName, color: '#6B7280' }
          });

        if (createError || !created?.success) {
          console.error(`❌ Erro ao criar tag "${tagName}":`, createError || created?.error);
          continue;
        }

        console.log(`✅ Tag criada: "${tagName}" → ${created.tag_id}`);
        resolvedTagIds.push(created.tag_id);
      }
    }

    if (resolvedTagIds.length === 0) return;

    // Atribuir todas as tags ao lead
    const { data: assignResult, error: assignError } = await supabase
      .rpc('manage_lead_tag_assignments_safe', {
        p_company_id: companyId,
        p_lead_id: leadId,
        p_tag_ids: resolvedTagIds,
        p_action: 'add'
      });

    if (assignError || !assignResult?.success) {
      console.error('❌ Erro ao atribuir tags:', assignError || assignResult?.error);
    } else {
      console.log(`✅ ${assignResult.processed_tags} tag(s) atribuída(s) ao lead ${leadId}`);
    }
  } catch (error) {
    console.error('❌ Erro geral ao processar tags:', error);
    // Não falhar o lead por causa das tags
  }
}

// DEPLOY FORÇADO - Webhook Lead V2 - 1730642100

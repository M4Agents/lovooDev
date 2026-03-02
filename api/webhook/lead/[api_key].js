// Webhook Ultra-Simples para Criação Automática de Leads
// Endpoint: /api/webhook/lead/[api_key]
// Método: POST com qualquer JSON contendo dados de formulário

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ 
      success: false, 
      error: 'Método não permitido. Use POST.' 
    });
    return;
  }
  
  try {
    const { api_key } = req.query;
    
    if (!api_key) {
      console.error('Lead webhook: Missing API key');
      res.status(400).json({ 
        success: false, 
        error: 'API key é obrigatória na URL' 
      });
      return;
    }
    
    console.log('Lead webhook received for API key:', api_key);
    console.log('Lead webhook payload:', req.body);
    
    // Processar dados do formulário
    const result = await createLeadFromWebhook({
      api_key,
      form_data: req.body,
      user_agent: req.headers['user-agent'] || 'Webhook Lead',
      ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      referrer: req.headers.referer || 'direct'
    });
    
    if (result.success) {
      console.log('SUCCESS: Lead criado via webhook ultra-simples:', result.lead_id);
      res.status(200).json({ 
        success: true, 
        lead_id: result.lead_id,
        message: 'Lead criado com sucesso!'
      });
    } else {
      console.error('ERROR: Falha ao criar lead via webhook:', result.error);
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in lead webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
}

async function createLeadFromWebhook(params) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. Validar API key e obter empresa
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('api_key', params.api_key)
      .single();
    
    if (companyError || !company) {
      console.error('Invalid API key:', params.api_key);
      return { success: false, error: 'API key inválida' };
    }
    
    console.log('API key validada para empresa:', company.name);
    
    // 2. Detectar campos automaticamente
    const detectedFields = detectFormFields(params.form_data);
    
    if (!detectedFields.name && !detectedFields.email) {
      return { 
        success: false, 
        error: 'Pelo menos nome ou email é obrigatório' 
      };
    }
    
    // 3. Processar campos personalizados (Mapeamento Inteligente)
    const customFieldsData = await processCustomFields(supabase, company.id, params.form_data, detectedFields);
    
    // 4. Preparar dados do lead
    const leadData = {
      company_id: company.id,
      name: detectedFields.name || 'Lead sem nome',
      email: detectedFields.email || null,
      phone: detectedFields.phone || null,
      origin: 'webhook',
      status: 'novo',
      interest: detectedFields.interest || null,
      // Campos da empresa (se fornecidos)
      company_name: detectedFields.company_name || null,
      company_cnpj: detectedFields.company_cnpj || null,
      company_email: detectedFields.company_email || null,
      company_telefone: detectedFields.company_phone || null
    };
    
    // 5. Criar lead usando RPC SECURITY DEFINER (compatível com RLS)
    console.log('🔄 USANDO RPC SECURITY DEFINER PARA CRIAÇÃO SEGURA DE LEAD');
    
    const { data: rpcResult, error: leadError } = await supabase
      .rpc('public_create_lead_webhook', {
        lead_data: {
          ...leadData,
          custom_fields: customFieldsData // Incluir campos personalizados no RPC
        }
      });
    
    if (leadError) {
      console.error('❌ ERRO RPC CREATE LEAD:', leadError);
      return { success: false, error: leadError.message };
    }
    
    if (!rpcResult || !rpcResult.success) {
      console.error('❌ RPC RETORNOU ERRO:', rpcResult);
      return { success: false, error: rpcResult?.error || 'Erro desconhecido no RPC' };
    }
    
    const leadId = rpcResult.lead_id;
    console.log('✅ LEAD CRIADO VIA RPC COM SUCESSO:', leadId);
    
    console.log('Lead criado com sucesso:', leadId);
    return { success: true, lead_id: leadId };
    
  } catch (error) {
    console.error('Exception in createLeadFromWebhook:', error);
    return { success: false, error: error.message };
  }
}

function detectFormFields(formData) {
  const detected = {};
  
  // Converter para objeto se necessário
  const data = typeof formData === 'string' ? JSON.parse(formData) : formData;
  
  // Detectar nome
  const nameFields = ['name', 'nome', 'full_name', 'fullname', 'first_name', 'firstname', 'cliente', 'usuario'];
  for (const field of nameFields) {
    if (data[field]) {
      detected.name = String(data[field]).trim();
      break;
    }
  }
  
  // Detectar email
  const emailFields = ['email', 'e-mail', 'mail', 'email_address', 'user_email'];
  for (const field of emailFields) {
    if (data[field] && isValidEmail(data[field])) {
      detected.email = String(data[field]).trim().toLowerCase();
      break;
    }
  }
  
  // Detectar telefone
  const phoneFields = ['phone', 'telefone', 'tel', 'celular', 'whatsapp', 'mobile', 'contact'];
  for (const field of phoneFields) {
    if (data[field]) {
      detected.phone = String(data[field]).trim();
      break;
    }
  }
  
  // Detectar interesse/assunto
  const interestFields = ['interest', 'interesse', 'subject', 'assunto', 'message', 'mensagem', 'produto', 'servico'];
  for (const field of interestFields) {
    if (data[field]) {
      detected.interest = String(data[field]).trim();
      break;
    }
  }
  
  // Detectar dados da empresa
  const companyNameFields = ['company', 'empresa', 'company_name', 'nome_empresa'];
  for (const field of companyNameFields) {
    if (data[field]) {
      detected.company_name = String(data[field]).trim();
      break;
    }
  }
  
  const cnpjFields = ['cnpj', 'company_cnpj', 'documento'];
  for (const field of cnpjFields) {
    if (data[field]) {
      detected.company_cnpj = String(data[field]).trim();
      break;
    }
  }
  
  const companyEmailFields = ['company_email', 'email_empresa', 'corporate_email'];
  for (const field of companyEmailFields) {
    if (data[field] && isValidEmail(data[field])) {
      detected.company_email = String(data[field]).trim().toLowerCase();
      break;
    }
  }
  
  const companyPhoneFields = ['company_phone', 'telefone_empresa', 'corporate_phone'];
  for (const field of companyPhoneFields) {
    if (data[field]) {
      detected.company_phone = String(data[field]).trim();
      break;
    }
  }
  
  console.log('Campos detectados:', detected);
  return detected;
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function processCustomFields(supabase, companyId, formData, detectedFields) {
  try {
    console.log('Processando campos personalizados...');
    
    // Converter para objeto se necessário
    const data = typeof formData === 'string' ? JSON.parse(formData) : formData;
    
    // Obter campos padrão que já foram detectados
    const standardFields = new Set([
      'name', 'nome', 'full_name', 'fullname', 'first_name', 'firstname', 'cliente', 'usuario',
      'email', 'e-mail', 'mail', 'email_address', 'user_email',
      'phone', 'telefone', 'tel', 'celular', 'whatsapp', 'mobile', 'contact',
      'interest', 'interesse', 'subject', 'assunto', 'message', 'mensagem', 'produto', 'servico',
      'company', 'empresa', 'company_name', 'nome_empresa',
      'cnpj', 'company_cnpj', 'documento',
      'company_email', 'email_empresa', 'corporate_email',
      'company_phone', 'telefone_empresa', 'corporate_phone'
    ]);
    
    // Identificar campos personalizados (que não são padrão)
    const customFields = [];
    
    for (const [fieldName, fieldValue] of Object.entries(data)) {
      // Pular campos padrão e campos vazios
      if (standardFields.has(fieldName.toLowerCase()) || !fieldValue) {
        continue;
      }
      
      console.log(`Campo personalizado detectado: ${fieldName} = ${fieldValue}`);
      
      // Processar campo personalizado
      const fieldData = await processCustomField(supabase, companyId, fieldName, fieldValue);
      if (fieldData) {
        customFields.push(fieldData);
      }
    }
    
    console.log(`${customFields.length} campos personalizados processados`);
    return customFields;
    
  } catch (error) {
    console.error('Erro ao processar campos personalizados:', error);
    return [];
  }
}

async function processCustomField(supabase, companyId, fieldName, fieldValue) {
  try {
    // 1. Normalizar nome do campo
    const normalizedFieldName = normalizeFieldName(fieldName);
    const fieldLabel = generateFieldLabel(fieldName);
    
    console.log(`Processando campo: ${fieldName} → ${normalizedFieldName} (${fieldLabel})`);
    
    // 2. Usar RPC SECURITY DEFINER para campos personalizados (compatível com RLS)
    console.log('🔄 USANDO RPC SECURITY DEFINER PARA CAMPO PERSONALIZADO');
    
    const { data: fieldResult, error: fieldError } = await supabase
      .rpc('create_custom_field_webhook', {
        p_company_id: companyId,
        p_field_name: normalizedFieldName,
        p_field_label: fieldLabel,
        p_field_type: detectFieldType(fieldValue),
        p_is_required: false
      });
    
    if (fieldError) {
      console.error('❌ ERRO RPC CUSTOM FIELD:', fieldError);
      return null;
    }
    
    if (!fieldResult || !fieldResult.success) {
      console.error('❌ RPC CUSTOM FIELD RETORNOU ERRO:', fieldResult);
      return null;
    }
    
    const fieldId = fieldResult.field_id;
    console.log('✅ CAMPO PERSONALIZADO PROCESSADO VIA RPC:', fieldId);
    
    return {
      field_id: fieldId,
      value: fieldValue
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

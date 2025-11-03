// Webhook Ultra-Simples para Criação Automática de Leads
// Endpoint: /api/webhook-lead
// Método: POST com api_key no body + dados do formulário
// Padrão baseado no webhook-visitor que funciona 100%

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
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    console.log('Lead webhook received raw body:', req.body);
    console.log('Lead webhook received headers:', req.headers);
    
    const { api_key, ...form_data } = req.body;
    
    if (!api_key) {
      console.error('Missing api_key in payload:', req.body);
      res.status(400).json({ error: 'api_key is required' });
      return;
    }
    
    console.log('Lead webhook received data:', { api_key, form_data });
    
    // Process data using direct SQL execution (mesmo padrão do webhook-visitor)
    const result = await createLeadDirectSQL({
      api_key,
      form_data,
      user_agent: req.headers['user-agent'] || 'Webhook Lead',
      ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      referrer: req.headers.referer || 'direct'
    });
    
    if (result.success) {
      console.log('SUCCESS: Lead created via webhook:', result.lead_id);
      res.status(200).json({ success: true, lead_id: result.lead_id });
    } else {
      console.error('ERROR: Webhook lead creation failed:', result.error);
      res.status(500).json({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('ERROR: Exception in lead webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function createLeadDirectSQL(params) {
  try {
    // Use the Supabase client with direct SQL execution (mesmo padrão do webhook-visitor)
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Processando webhook para API key:', params.api_key);
    
    // 1. Detectar campos automaticamente
    const detectedFields = detectFormFields(params.form_data);
    
    if (!detectedFields.name && !detectedFields.email) {
      return { 
        success: false, 
        error: 'Pelo menos nome ou email é obrigatório' 
      };
    }
    
    console.log('Campos detectados:', detectedFields);
    
    // 2. Criar lead via RPC (padrão Analytics V5 - contorna RLS)
    const { data: lead, error: leadError } = await supabase
      .rpc('public_create_lead_webhook', {
        lead_data: {
          api_key: params.api_key,
          name: detectedFields.name || 'Lead sem nome',
          email: detectedFields.email || null,
          phone: detectedFields.phone || null,
          interest: detectedFields.interest || null,
          company_name: detectedFields.company_name || null,
          company_cnpj: detectedFields.company_cnpj || null,
          company_email: detectedFields.company_email || null
        }
      });
    
    if (leadError) {
      console.error('Erro ao criar lead:', leadError);
      return { success: false, error: leadError.message };
    }
    
    if (!lead || !lead.success) {
      console.error('RPC falhou:', lead);
      return { success: false, error: lead?.error || 'Falha ao criar lead' };
    }
    
    console.log('Lead criado com ID:', lead.lead_id);
    
    // 3. Processar campos personalizados (mapeamento inteligente)
    const customFieldsData = await processCustomFields(supabase, lead.company_id, params.form_data, detectedFields);
    
    // 4. Inserir valores dos campos personalizados
    if (customFieldsData.length > 0) {
      const customValues = customFieldsData.map(field => ({
        lead_id: lead.lead_id,
        field_id: field.field_id,
        value: String(field.value)
      }));
      
      const { error: customError } = await supabase
        .from('lead_custom_values')
        .insert(customValues);
      
      if (customError) {
        console.error('Erro ao inserir campos personalizados:', customError);
        // Não falha o lead por causa dos campos personalizados
      } else {
        console.log(`${customValues.length} campos personalizados inseridos`);
      }
    }
    
    return { success: true, lead_id: lead.lead_id };
    
  } catch (error) {
    console.error('Exception in createLeadDirectSQL:', error);
    return { success: false, error: error.message };
  }
}

function detectFormFields(formData) {
  console.log('Detectando campos no formulário...');
  
  const data = typeof formData === 'string' ? JSON.parse(formData) : formData;
  const detected = {};
  
  // Mapear campos comuns para nomes padronizados
  const fieldMappings = {
    // Nome
    name: ['name', 'nome', 'full_name', 'fullname', 'first_name', 'firstname', 'cliente', 'usuario'],
    // Email
    email: ['email', 'e-mail', 'mail', 'email_address', 'user_email'],
    // Telefone
    phone: ['phone', 'telefone', 'tel', 'celular', 'whatsapp', 'mobile', 'contact'],
    // Interesse/Assunto
    interest: ['interest', 'interesse', 'subject', 'assunto', 'message', 'mensagem', 'produto', 'servico'],
    // Empresa
    company_name: ['company', 'empresa', 'company_name', 'nome_empresa'],
    company_cnpj: ['cnpj', 'company_cnpj', 'documento'],
    company_email: ['company_email', 'email_empresa', 'corporate_email'],
    company_phone: ['company_phone', 'telefone_empresa', 'corporate_phone']
  };
  
  // Detectar campos automaticamente
  for (const [standardField, variations] of Object.entries(fieldMappings)) {
    for (const [key, value] of Object.entries(data)) {
      if (variations.includes(key.toLowerCase()) && value) {
        detected[standardField] = value;
        console.log(`Campo detectado: ${key} → ${standardField} = ${value}`);
        break;
      }
    }
  }
  
  console.log('Campos detectados:', detected);
  return detected;
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
      'company_phone', 'telefone_empresa', 'corporate_phone',
      'api_key' // Excluir api_key dos campos personalizados
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
    
    // 2. Verificar se campo já existe
    const { data: existingField, error: searchError } = await supabase
      .from('lead_custom_fields')
      .select('id, field_name, field_type')
      .eq('company_id', companyId)
      .eq('field_name', normalizedFieldName)
      .single();
    
    if (searchError && searchError.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Erro ao buscar campo existente:', searchError);
      return null;
    }
    
    let fieldId;
    
    if (existingField) {
      // 3a. Campo existe - usar existente
      console.log(`Campo existente encontrado: ${existingField.id}`);
      fieldId = existingField.id;
    } else {
      // 3b. Campo não existe - criar automaticamente
      console.log(`Criando novo campo personalizado: ${normalizedFieldName}`);
      
      const fieldType = detectFieldType(fieldValue);
      
      const { data: newField, error: createError } = await supabase
        .from('lead_custom_fields')
        .insert({
          company_id: companyId,
          field_name: normalizedFieldName,
          field_label: fieldLabel,
          field_type: fieldType,
          is_required: false
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error('Erro ao criar campo personalizado:', createError);
        return null;
      }
      
      fieldId = newField.id;
      console.log(`Novo campo criado com ID: ${fieldId}`);
    }
    
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

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
// DEPLOY FORÇADO - Webhook Lead V2 - 1730642100

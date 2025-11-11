// Webhook Ultra-Simples para Criação Automática de Leads
// Endpoint: /api/webhook-lead
// Método: POST com api_key no body + dados do formulário
// Padrão baseado no webhook-visitor que funciona 100%

// Função para disparar webhooks avançados automaticamente
async function triggerAdvancedWebhooks(leadData, companyId) {
  console.log('🚀 FUNÇÃO triggerAdvancedWebhooks INICIADA');
  console.log('📋 PARÂMETROS RECEBIDOS:');
  console.log('  - leadData:', JSON.stringify(leadData, null, 2));
  console.log('  - companyId:', companyId);
  console.log('🚀 DISPARANDO WEBHOOKS AVANÇADOS');
  console.log('Lead ID:', leadData.lead_id);
  console.log('Company ID:', companyId);
  
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. Buscar configurações ativas de webhook para lead_created
    const { data: configs, error: configError } = await supabase.rpc('get_webhook_trigger_configs', {
      p_company_id: companyId
    });
    
    if (configError) {
      console.error('❌ Erro ao buscar configurações:', configError);
      return;
    }
    
    console.log('🔍 DEBUG FILTRO DE CONFIGURAÇÕES:');
    console.log('📊 Total de configs retornadas:', configs?.length || 0);
    
    if (configs && configs.length > 0) {
      configs.forEach((config, index) => {
        console.log(`📋 Config ${index + 1}:`);
        console.log(`  - ID: ${config.id}`);
        console.log(`  - Nome: ${config.name}`);
        console.log(`  - is_active: ${config.is_active}`);
        console.log(`  - trigger_events: ${JSON.stringify(config.trigger_events)}`);
        console.log(`  - trigger_events tipo: ${typeof config.trigger_events}`);
        console.log(`  - É array? ${Array.isArray(config.trigger_events)}`);
        console.log(`  - Inclui 'lead_created'? ${config.trigger_events?.includes('lead_created')}`);
        console.log(`  - Passa no filtro? ${config.is_active && config.trigger_events?.includes('lead_created')}`);
      });
    }
    
    const activeConfigs = configs?.filter(config => 
      config.is_active && 
      config.trigger_events?.includes('lead_created')
    ) || [];
    
    console.log(`📋 Encontradas ${activeConfigs.length} configurações ativas para lead_created`);
    console.log('🔍 activeConfigs detalhadas:', JSON.stringify(activeConfigs, null, 2));
    
    // 2. Disparar cada webhook
    console.log('🔄 INICIANDO LOOP DE CONFIGURAÇÕES ATIVAS');
    console.log(`📊 Quantidade de configs para processar: ${activeConfigs.length}`);
    
    if (activeConfigs.length === 0) {
      console.log('❌ PROBLEMA: Nenhuma configuração ativa encontrada para lead_created!');
      console.log('🔍 Possíveis causas:');
      console.log('  - trigger_events não contém "lead_created"');
      console.log('  - is_active é false');
      console.log('  - Configuração não existe');
      return;
    }
    
    for (const config of activeConfigs) {
      console.log(`🎯 ENTRANDO NO LOOP - Disparando webhook: ${config.name}`);
      console.log(`📋 Config ID: ${config.id}`);
      
      // Construir payload dinâmico baseado nos campos selecionados
      console.log('🔍 Configuração payload_fields:', config.payload_fields);
      
      // Campos padrão (fallback) se não houver configuração
      const defaultLeadFields = ['name', 'email', 'phone', 'status', 'origin'];
      const selectedLeadFields = config.payload_fields?.lead || defaultLeadFields;
      
      console.log('📋 Campos selecionados do lead:', selectedLeadFields);
      
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
          console.log(`✅ Campo do lead incluído: ${field} = ${availableLeadData[field]}`);
        } else {
          console.log(`⚠️ Campo do lead não disponível: ${field}`);
        }
      });
      
      // Adicionar campos da empresa do lead selecionados
      const selectedCompanyFields = config.payload_fields?.empresa || [];
      console.log('🏢 Campos selecionados da empresa do lead:', selectedCompanyFields);
      
      selectedCompanyFields.forEach(field => {
        if (availableLeadData[field] !== undefined && availableLeadData[field] !== null) {
          leadPayload[field] = availableLeadData[field];
          console.log(`✅ Campo da empresa do lead incluído: ${field} = ${availableLeadData[field]}`);
        } else {
          console.log(`⚠️ Campo da empresa do lead não disponível: ${field}`);
        }
      });
      
      console.log('🚀 CHEGOU NA SEÇÃO DE CAMPOS PERSONALIZADOS');
      
      // Adicionar campos personalizados selecionados - NOVO E SEGURO
      const selectedCustomFields = config.payload_fields?.custom_fields || [];
      console.log('🎯 DEBUG CAMPOS PERSONALIZADOS - INÍCIO');
      console.log('📋 Configuração completa payload_fields:', JSON.stringify(config.payload_fields, null, 2));
      console.log('🎯 Campos personalizados selecionados:', selectedCustomFields);
      console.log('📊 Tipo dos campos selecionados:', typeof selectedCustomFields, Array.isArray(selectedCustomFields));
      console.log('📈 Quantidade de campos selecionados:', selectedCustomFields.length);
      console.log('🔍 VERIFICAÇÃO CRÍTICA:');
      console.log('  - config.payload_fields existe?', !!config.payload_fields);
      console.log('  - config.payload_fields.custom_fields existe?', !!config.payload_fields?.custom_fields);
      console.log('  - É array?', Array.isArray(config.payload_fields?.custom_fields));
      console.log('  - Conteúdo bruto:', config.payload_fields?.custom_fields);
      
      if (selectedCustomFields.length > 0) {
        try {
          console.log('🔍 USANDO CAMPOS PERSONALIZADOS JÁ PROCESSADOS (CORREÇÃO TIMING ISSUE)');
          console.log('📊 Lead ID:', leadData.lead_id);
          console.log('🎯 Campos que estamos procurando:', selectedCustomFields);
          
          // CORREÇÃO: Usar dados já processados em vez de buscar no banco
          // Isso evita o timing issue onde a busca acontece antes do commit
          const customFieldsFromProcessed = leadData.custom_fields_processed || [];
          console.log('📊 Campos processados recebidos:', customFieldsFromProcessed.length);
          
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
          
          console.log('📋 DADOS CONVERTIDOS PARA PROCESSAMENTO:');
          console.log('- Dados encontrados:', customValues?.length || 0);
          console.log('- Valores completos:', JSON.stringify(customValues, null, 2));
          
          if (customValues && customValues.length > 0) {
            console.log('✅ Valores de campos personalizados encontrados:', customValues.length);
            
            // Adicionar campos personalizados selecionados ao payload
            console.log('🔄 PROCESSANDO CADA CAMPO PERSONALIZADO:');
            customValues.forEach((customValue, index) => {
              const fieldNumericId = customValue.lead_custom_fields?.numeric_id?.toString();
              const fieldId = customValue.field_id;
              
              console.log(`📋 Campo ${index + 1}:`);
              console.log(`  - field_id: ${fieldId}`);
              console.log(`  - numeric_id: ${customValue.lead_custom_fields?.numeric_id}`);
              console.log(`  - numeric_id (string): ${fieldNumericId}`);
              console.log(`  - field_label: ${customValue.lead_custom_fields?.field_label}`);
              console.log(`  - value: ${customValue.value}`);
              console.log(`  - Está nos selecionados (numeric_id)? ${selectedCustomFields.includes(fieldNumericId)}`);
              console.log(`  - Está nos selecionados (field_id)? ${selectedCustomFields.includes(fieldId)}`);
              
              // Verificar se este campo foi selecionado (por ID numérico ou UUID)
              if (selectedCustomFields.includes(fieldNumericId) || selectedCustomFields.includes(fieldId)) {
                const fieldKey = fieldNumericId || fieldId;
                leadPayload[fieldKey] = customValue.value;
                console.log(`✅ Campo personalizado incluído: ${fieldKey} = ${customValue.value}`);
              } else {
                console.log(`⚠️ Campo personalizado NÃO incluído (não selecionado)`);
              }
            });
          } else {
            console.log('ℹ️ Nenhum valor de campo personalizado encontrado para este lead');
          }
        } catch (error) {
          console.error('❌ Erro ao processar campos personalizados:', error);
          // Falha silenciosa para não quebrar o webhook
        }
      } else {
        console.log('ℹ️ Nenhum campo personalizado selecionado na configuração');
        console.log('🔍 DIAGNÓSTICO:');
        console.log('  - selectedCustomFields.length:', selectedCustomFields.length);
        console.log('  - selectedCustomFields:', JSON.stringify(selectedCustomFields));
        console.log('  - config.payload_fields?.custom_fields:', JSON.stringify(config.payload_fields?.custom_fields));
      }
      
      console.log('🎯 DEBUG CAMPOS PERSONALIZADOS - FIM');
      console.log('📊 Payload final do lead:', JSON.stringify(leadPayload, null, 2));
      
      const payload = {
        event: 'lead_created',
        timestamp: new Date().toISOString(),
        data: {
          lead: leadPayload
        }
      };
      
      console.log('📤 Payload:', JSON.stringify(payload, null, 2));
      
      // Fazer requisição HTTP
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
        
        // Registrar log no banco de dados
        try {
          const { data: logResult, error: logError } = await supabase
            .from('webhook_trigger_logs')
            .insert({
              config_id: config.id,
              trigger_event: 'lead_created',
              success: response.ok,
              response_status: response.status,
              response_body: responseText,
              error_message: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
              created_at: new Date().toISOString()
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
        
        // Registrar erro no log
        try {
          await supabase
            .from('webhook_trigger_logs')
            .insert({
              config_id: config.id,
              trigger_event: 'lead_created',
              success: false,
              response_status: null,
              response_body: null,
              error_message: fetchError.message,
              created_at: new Date().toISOString()
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

export default async function handler(req, res) {
  console.log('🚀 WEBHOOK LEAD INICIADO - VERSÃO HÍBRIDA COM IDs - V6 + WEBHOOKS AVANÇADOS');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Deploy Version: 2025-11-11-09:53 - Correção Estrutura Dados');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);

  // Set CORS headers (mesmo padrão do webhook-visitor)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - retornando 200');
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    console.log('📥 PAYLOAD RECEBIDO:', req.body);
    console.log('📊 PAYLOAD DETALHADO:');
    console.log('- Tipo do payload:', typeof req.body);
    console.log('- Keys do payload:', Object.keys(req.body || {}));
    console.log('- Valores do payload:', JSON.stringify(req.body, null, 2));
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
    // Usando chave anon que funcionava + RPC com SECURITY DEFINER para contornar RLS
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔑 USANDO CHAVE ANON + RPC SECURITY DEFINER PARA CONTORNAR RLS');
    console.log('Processando webhook para API key:', params.api_key);
    console.log('Visitor ID recebido:', params.form_data.visitor_id || 'não fornecido');
    
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
          company_email: detectedFields.company_email || null,
          visitor_id: params.form_data.visitor_id || null  // CRÍTICO: Passar visitor_id para RPC
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
    
    // 3. Processar conexão visitor-lead (Sistema Híbrido)
    if (params.form_data.visitor_id) {
      console.log('Visitor ID detectado:', params.form_data.visitor_id);
      await processVisitorConnection(supabase, lead.lead_id, lead.company_id, params.form_data.visitor_id, detectedFields);
    } else {
      console.log('Visitor ID não fornecido - tentando busca retroativa inteligente');
      await processRetroactiveVisitorSearch(supabase, lead.lead_id, lead.company_id, detectedFields);
    }
    
    // 4. Processar campos personalizados (mapeamento inteligente)
    console.log('🔧 INICIANDO PROCESSAMENTO DE CAMPOS PERSONALIZADOS');
    console.log('Lead Company ID:', lead.company_id);
    console.log('Form Data para campos personalizados:', params.form_data);
    const customFieldsProcessed = await processCustomFields(supabase, lead.company_id, params.form_data, detectedFields);
    console.log('🔧 CAMPOS PERSONALIZADOS PROCESSADOS:', customFieldsProcessed);
    
    // 5. Inserir valores dos campos personalizados
    console.log('💾 INSERINDO VALORES DOS CAMPOS PERSONALIZADOS');
    if (customFieldsProcessed.length > 0) {
      const customValues = customFieldsProcessed.map(field => ({
        lead_id: lead.lead_id,
        field_id: field.field_id,
        value: String(field.value)
      }));
      
      console.log('💾 Valores a serem inseridos:', customValues);
      
      // Usar RPC para inserir valores contornando RLS (mesmo padrão dos campos)
      console.log('💾 Chamando RPC insert_custom_field_values_webhook...');
      const { data: insertResult, error: customError } = await supabase
        .rpc('insert_custom_field_values_webhook', {
          lead_id_param: lead.lead_id,
          field_values: customValues
        });
      
      console.log('💾 Resultado da RPC inserção:', { insertResult, customError });
      
      if (customError) {
        console.error('❌ ERRO ao inserir valores dos campos personalizados via RPC:', customError);
      } else if (insertResult && insertResult.success) {
        console.log(`✅ ${insertResult.inserted_count} valores de campos personalizados inseridos com sucesso via RPC`);
      } else {
        console.error('❌ RPC retornou erro:', insertResult);
      }
    } else {
      console.log('⚠️ Nenhum campo personalizado para inserir');
    }
    
    // 6. DISPARAR WEBHOOKS AVANÇADOS AUTOMATICAMENTE
    console.log('🚀 INICIANDO DISPARO DE WEBHOOKS AVANÇADOS');
    console.log('📊 DADOS PARA WEBHOOK:');
    console.log('  - lead_id:', lead.lead_id);
    console.log('  - company_id:', lead.company_id);
    console.log('  - name:', detectedFields.name || 'Lead sem nome');
    console.log('  - email:', detectedFields.email || null);
    console.log('  - phone:', detectedFields.phone || null);
    
    try {
      console.log('🎯 CHAMANDO triggerAdvancedWebhooks...');
      console.log('📊 Passando campos personalizados processados:', customFieldsProcessed.length);
      await triggerAdvancedWebhooks({
        lead_id: lead.lead_id,
        name: detectedFields.name || 'Lead sem nome',
        email: detectedFields.email || null,
        phone: detectedFields.phone || null,
        custom_fields_processed: customFieldsProcessed // NOVO: passar dados já processados
      }, lead.company_id);
      console.log('✅ Webhooks avançados disparados com sucesso');
    } catch (webhookError) {
      console.error('❌ Erro ao disparar webhooks avançados:', webhookError);
      console.error('❌ Stack trace:', webhookError.stack);
      // Não falhar a criação do lead por causa do webhook
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
    // Campos básicos do lead:
    name: ['name', 'nome', 'full_name', 'fullname', 'first_name', 'firstname', 'cliente', 'usuario'],
    email: ['email', 'e-mail', 'mail', 'email_address', 'user_email'],
    phone: ['phone', 'telefone', 'tel', 'celular', 'whatsapp', 'mobile', 'contact'],
    interest: ['interest', 'interesse', 'subject', 'assunto', 'message', 'mensagem', 'produto', 'servico'],
    origin: ['origin', 'origem', 'source', 'fonte'], // ← ADICIONADO
    status: ['status', 'situacao', 'estado'], // ← ADICIONADO
    
    // Campos da empresa:
    company_name: ['company', 'empresa', 'company_name', 'nome_empresa'],
    company_cnpj: ['cnpj', 'company_cnpj', 'documento'],
    company_email: ['company_email', 'email_empresa', 'corporate_email'],
    company_phone: ['company_phone', 'telefone_empresa', 'corporate_phone'],
    company_razao_social: ['company_razao_social', 'razao_social', 'razao'], // ← ADICIONADO
    company_nome_fantasia: ['company_nome_fantasia', 'nome_fantasia', 'fantasia'], // ← ADICIONADO
    company_cep: ['company_cep', 'cep', 'codigo_postal'], // ← ADICIONADO
    company_cidade: ['company_cidade', 'cidade', 'city'], // ← ADICIONADO
    company_estado: ['company_estado', 'estado', 'uf', 'state'], // ← ADICIONADO
    company_endereco: ['company_endereco', 'endereco', 'address'], // ← ADICIONADO
    company_site: ['company_site', 'site', 'website', 'url'] // ← ADICIONADO
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
    console.log('=== INICIANDO PROCESSAMENTO DE CAMPOS PERSONALIZADOS ===');
    console.log('🔧 SISTEMA HÍBRIDO ATIVO:');
    console.log('  - Campos padrão: Processados por nome (nome, email, telefone, etc.)');
    console.log('  - Campos personalizados por ID: Processados automaticamente (1, 2, 3, etc.)');
    console.log('  - Campos personalizados por nome: Modo manual (criar na interface)');
    console.log('Company ID:', companyId);
    console.log('Form Data recebido:', formData);
    console.log('Detected Fields:', detectedFields);
    
    // Converter para objeto se necessário
    const data = typeof formData === 'string' ? JSON.parse(formData) : formData;
    console.log('Dados convertidos:', data);
    
    // Obter campos padrão que já foram detectados
    const standardFields = new Set([
      // Campos básicos do lead:
      'name', 'nome', 'full_name', 'fullname', 'first_name', 'firstname', 'cliente', 'usuario',
      'email', 'e-mail', 'mail', 'email_address', 'user_email',
      'phone', 'telefone', 'tel', 'celular', 'whatsapp', 'mobile', 'contact',
      'interest', 'interesse', 'subject', 'assunto', 'message', 'mensagem', 'produto', 'servico',
      'origin', 'origem', 'source', 'fonte', // ← ADICIONADO
      'status', 'situacao', 'estado', // ← ADICIONADO
      
      // Campos da empresa:
      'company', 'empresa', 'company_name', 'nome_empresa',
      'cnpj', 'company_cnpj', 'documento',
      'company_email', 'email_empresa', 'corporate_email',
      'company_phone', 'telefone_empresa', 'corporate_phone',
      'company_razao_social', 'razao_social', 'razao', // ← ADICIONADO
      'company_nome_fantasia', 'nome_fantasia', 'fantasia', // ← ADICIONADO
      'company_cep', 'cep', 'codigo_postal', // ← ADICIONADO
      'company_cidade', 'cidade', 'city', // ← ADICIONADO
      'company_estado', 'estado', 'uf', 'state', // ← ADICIONADO
      'company_endereco', 'endereco', 'address', // ← ADICIONADO
      'company_site', 'site', 'website', 'url', // ← ADICIONADO
      
      // Campos técnicos:
      'responsible_user_id', 'responsavel', 'usuario_responsavel', // ← ADICIONADO
      'api_key', // Excluir api_key dos campos personalizados
      'visitor_id', 'session_id',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'referrer', 'user_agent', 'ip_address', 'device_type'
    ]);
    
    console.log('Campos padrão definidos:', Array.from(standardFields));
    
    // Identificar campos personalizados (que não são padrão)
    const customFields = [];
    
    console.log('=== ANALISANDO CADA CAMPO DO FORMULÁRIO ===');
    for (const [fieldName, fieldValue] of Object.entries(data)) {
      console.log(`Analisando campo: "${fieldName}" = "${fieldValue}"`);
      
      // Verificar se é campo padrão
      const isStandardField = standardFields.has(fieldName.toLowerCase());
      // Verificar se é ID numérico (campo personalizado por ID)
      const isNumericId = /^\d+$/.test(fieldName);
      
      console.log(`  - É campo padrão? ${isStandardField}`);
      console.log(`  - É ID numérico? ${isNumericId}`);
      console.log(`  - Tem valor? ${!!fieldValue}`);
      
      // Pular campos padrão e campos vazios
      if (isStandardField || !fieldValue) {
        console.log(`  - PULANDO campo: ${isStandardField ? 'é padrão' : 'está vazio'}`);
        continue;
      }
      
      // Processar campo personalizado (por nome ou ID)
      if (isNumericId) {
        console.log(`  - 📋 CAMPO PERSONALIZADO POR ID DETECTADO: ${fieldName} = ${fieldValue}`);
        // Processar campo por ID numérico
        const customField = await processCustomFieldById(supabase, companyId, parseInt(fieldName), fieldValue);
        if (customField) {
          customFields.push(customField);
        }
      } else {
        console.log(`  - 📋 CAMPO PERSONALIZADO POR NOME DETECTADO (MODO MANUAL): ${fieldName} = ${fieldValue}`);
        console.log(`  - 🚨 CRIAÇÃO AUTOMÁTICA DESABILITADA - Campo não será criado`);
        console.log(`  - 📋 Para usar este campo, crie-o manualmente na interface de Campos Personalizados`);
        console.log(`  - 📋 Nome sugerido: "${fieldName.toLowerCase().replace(/[^a-z0-9]/g, '_')}"`);
      }
    }
    
    console.log(`=== RESULTADO FINAL: ${customFields.length} campos personalizados processados ===`);
    console.log('Campos processados:', customFields);
    return customFields;
    
  } catch (error) {
    console.error('Erro ao processar campos personalizados:', error);
    return [];
  }
}

async function processCustomField(supabase, companyId, fieldName, fieldValue) {
  try {
    console.log(`    === PROCESSANDO CAMPO INDIVIDUAL: ${fieldName} ===`);
    
    // 1. Normalizar nome do campo
    const normalizedFieldName = normalizeFieldName(fieldName);
    const fieldLabel = generateFieldLabel(fieldName);
    
    console.log(`    - Campo original: "${fieldName}"`);
    console.log(`    - Campo normalizado: "${normalizedFieldName}"`);
    console.log(`    - Label gerado: "${fieldLabel}"`);
    console.log(`    - Valor: "${fieldValue}"`);
    
    // 2. Verificar se campo já existe
    console.log(`    - Verificando se campo já existe na empresa ${companyId}...`);
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
    console.log(`=== PROCESSANDO CAMPO POR ID: ${numericId} ===`);
    console.log(`- Company ID: ${companyId}`);
    console.log(`- Numeric ID: ${numericId}`);
    console.log(`- Valor: ${value}`);
    
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

// DEPLOY FORÇADO - Webhook Lead V2 - 1730642100

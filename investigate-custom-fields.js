// SCRIPT DE INVESTIGAÇÃO - APENAS LEITURA
// Investigar problema dos campos personalizados ID 9 e 10

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateCustomFields() {
  console.log('🔍 INVESTIGAÇÃO CAMPOS PERSONALIZADOS - LEAD ID 121');
  console.log('🎯 Campos esperados: ID 9 (Interesse Principal) e ID 10 (Tempo que pretende fazer)');
  console.log('=' .repeat(80));
  
  try {
    // 1. VERIFICAR CONFIGURAÇÃO SALVA NO BANCO
    console.log('\n1️⃣ VERIFICANDO CONFIGURAÇÃO WEBHOOK SALVA:');
    const { data: configs, error: configError } = await supabase
      .from('webhook_trigger_configs')
      .select('*')
      .eq('is_active', true);
    
    if (configError) {
      console.error('❌ Erro ao buscar configs:', configError);
      return;
    }
    
    console.log(`📋 Encontradas ${configs.length} configurações ativas:`);
    configs.forEach((config, index) => {
      console.log(`\n📋 Config ${index + 1}:`);
      console.log(`  - ID: ${config.id}`);
      console.log(`  - Nome: ${config.name}`);
      console.log(`  - URL: ${config.webhook_url}`);
      console.log(`  - Ativa: ${config.is_active}`);
      console.log(`  - Eventos: ${JSON.stringify(config.trigger_events)}`);
      console.log(`  - payload_fields completo:`, JSON.stringify(config.payload_fields, null, 4));
      
      // VERIFICAÇÃO ESPECÍFICA DOS CAMPOS PERSONALIZADOS
      const customFields = config.payload_fields?.custom_fields || [];
      console.log(`  - 🎯 Campos personalizados salvos: ${JSON.stringify(customFields)}`);
      console.log(`  - 📊 Quantidade: ${customFields.length}`);
      console.log(`  - 🔍 Contém ID 9? ${customFields.includes('9')}`);
      console.log(`  - 🔍 Contém ID 10? ${customFields.includes('10')}`);
    });
    
    // 2. VERIFICAR DADOS DO LEAD 121
    console.log('\n2️⃣ VERIFICANDO DADOS DO LEAD 121:');
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', 121)
      .single();
    
    if (leadError) {
      console.error('❌ Erro ao buscar lead:', leadError);
      return;
    }
    
    console.log('📋 Dados básicos do lead:');
    console.log(`  - ID: ${leadData.id}`);
    console.log(`  - Nome: ${leadData.name}`);
    console.log(`  - Email: ${leadData.email}`);
    console.log(`  - Company ID: ${leadData.company_id}`);
    console.log(`  - Created: ${leadData.created_at}`);
    
    // 3. VERIFICAR CAMPOS PERSONALIZADOS DO LEAD 121
    console.log('\n3️⃣ VERIFICANDO CAMPOS PERSONALIZADOS DO LEAD 121:');
    const { data: customValues, error: customError } = await supabase
      .from('lead_custom_values')
      .select(`
        field_id,
        value,
        lead_custom_fields (
          id,
          numeric_id,
          field_name,
          field_label,
          field_type,
          company_id
        )
      `)
      .eq('lead_id', 121);
    
    if (customError) {
      console.error('❌ Erro ao buscar campos personalizados:', customError);
      return;
    }
    
    console.log(`📋 Encontrados ${customValues.length} valores de campos personalizados:`);
    customValues.forEach((value, index) => {
      console.log(`\n📋 Campo ${index + 1}:`);
      console.log(`  - field_id: ${value.field_id}`);
      console.log(`  - value: ${value.value}`);
      console.log(`  - numeric_id: ${value.lead_custom_fields?.numeric_id}`);
      console.log(`  - field_label: ${value.lead_custom_fields?.field_label}`);
      console.log(`  - field_type: ${value.lead_custom_fields?.field_type}`);
      console.log(`  - É o campo 9? ${value.lead_custom_fields?.numeric_id === 9}`);
      console.log(`  - É o campo 10? ${value.lead_custom_fields?.numeric_id === 10}`);
    });
    
    // 4. VERIFICAR CAMPOS PERSONALIZADOS DISPONÍVEIS DA EMPRESA
    console.log('\n4️⃣ VERIFICANDO CAMPOS DISPONÍVEIS DA EMPRESA:');
    const { data: availableFields, error: fieldsError } = await supabase
      .from('lead_custom_fields')
      .select('*')
      .eq('company_id', leadData.company_id)
      .order('numeric_id', { ascending: true });
    
    if (fieldsError) {
      console.error('❌ Erro ao buscar campos disponíveis:', fieldsError);
      return;
    }
    
    console.log(`📋 Encontrados ${availableFields.length} campos disponíveis na empresa:`);
    availableFields.forEach((field, index) => {
      console.log(`\n📋 Campo Disponível ${index + 1}:`);
      console.log(`  - ID: ${field.id}`);
      console.log(`  - numeric_id: ${field.numeric_id}`);
      console.log(`  - field_name: ${field.field_name}`);
      console.log(`  - field_label: ${field.field_label}`);
      console.log(`  - field_type: ${field.field_type}`);
      console.log(`  - É o campo 9? ${field.numeric_id === 9}`);
      console.log(`  - É o campo 10? ${field.numeric_id === 10}`);
    });
    
    // 5. ANÁLISE CRUZADA - IDENTIFICAR PROBLEMAS
    console.log('\n5️⃣ ANÁLISE CRUZADA - IDENTIFICANDO PROBLEMAS:');
    
    const activeConfig = configs.find(c => c.is_active);
    const selectedCustomFields = activeConfig?.payload_fields?.custom_fields || [];
    
    console.log('🔍 VERIFICAÇÕES CRÍTICAS:');
    console.log(`  - Configuração ativa encontrada? ${!!activeConfig}`);
    console.log(`  - Campos personalizados selecionados: ${JSON.stringify(selectedCustomFields)}`);
    console.log(`  - Quantidade selecionada: ${selectedCustomFields.length}`);
    
    if (selectedCustomFields.length === 0) {
      console.log('❌ PROBLEMA: Nenhum campo personalizado selecionado na configuração!');
    } else {
      console.log('✅ Campos selecionados encontrados na configuração');
      
      // Verificar se os campos selecionados existem nos dados do lead
      selectedCustomFields.forEach(selectedId => {
        const foundValue = customValues.find(cv => 
          cv.lead_custom_fields?.numeric_id?.toString() === selectedId ||
          cv.field_id === selectedId
        );
        
        if (foundValue) {
          console.log(`✅ Campo ${selectedId} encontrado nos dados: ${foundValue.value}`);
        } else {
          console.log(`❌ Campo ${selectedId} NÃO encontrado nos dados do lead!`);
        }
      });
    }
    
    // 6. SIMULAÇÃO DO PROCESSAMENTO DO WEBHOOK
    console.log('\n6️⃣ SIMULAÇÃO DO PROCESSAMENTO DO WEBHOOK:');
    console.log('🔄 Simulando lógica do webhook-lead.js...');
    
    if (selectedCustomFields.length > 0) {
      console.log(`✅ Entraria no processamento (${selectedCustomFields.length} campos selecionados)`);
      
      if (customValues && customValues.length > 0) {
        console.log(`✅ Dados encontrados (${customValues.length} valores)`);
        
        let includedFields = 0;
        customValues.forEach(customValue => {
          const fieldNumericId = customValue.lead_custom_fields?.numeric_id?.toString();
          const fieldId = customValue.field_id;
          
          if (selectedCustomFields.includes(fieldNumericId) || selectedCustomFields.includes(fieldId)) {
            console.log(`✅ Campo seria incluído: ${fieldNumericId || fieldId} = ${customValue.value}`);
            includedFields++;
          } else {
            console.log(`⚠️ Campo NÃO seria incluído: ${fieldNumericId || fieldId} (não está nos selecionados)`);
          }
        });
        
        console.log(`📊 RESULTADO: ${includedFields} campos seriam incluídos no payload`);
      } else {
        console.log('❌ Nenhum dado encontrado - não entraria no processamento');
      }
    } else {
      console.log('❌ Não entraria no processamento (nenhum campo selecionado)');
    }
    
  } catch (error) {
    console.error('❌ Erro geral na investigação:', error);
  }
}

// Executar investigação
investigateCustomFields();

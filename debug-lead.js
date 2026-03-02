// Script de debug para verificar dados do lead ID 119
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugLead119() {
  console.log('🔍 INVESTIGANDO LEAD ID 119...\n');
  
  try {
    // 1. Verificar dados básicos do lead
    console.log('1️⃣ DADOS BÁSICOS DO LEAD:');
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', 119)
      .single();
    
    if (leadError) {
      console.error('❌ Erro ao buscar lead:', leadError);
      return;
    }
    
    console.log('📋 Lead encontrado:', {
      id: leadData.id,
      name: leadData.name,
      email: leadData.email,
      phone: leadData.phone,
      company_name: leadData.company_name,
      company_cnpj: leadData.company_cnpj,
      created_at: leadData.created_at
    });
    
    // 2. Verificar configurações de webhook ativas
    console.log('\n2️⃣ CONFIGURAÇÕES DE WEBHOOK:');
    const { data: configs, error: configError } = await supabase
      .from('webhook_trigger_configs')
      .select('*')
      .eq('is_active', true);
    
    if (configError) {
      console.error('❌ Erro ao buscar configs:', configError);
      return;
    }
    
    console.log(`📋 Encontradas ${configs.length} configurações ativas:`);
    configs.forEach(config => {
      console.log(`  - ${config.name}:`);
      console.log(`    payload_fields:`, config.payload_fields);
      console.log(`    trigger_events:`, config.trigger_events);
    });
    
    // 3. Verificar campos personalizados do lead
    console.log('\n3️⃣ CAMPOS PERSONALIZADOS DO LEAD:');
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
          field_type
        )
      `)
      .eq('lead_id', 119);
    
    if (customError) {
      console.error('❌ Erro ao buscar campos personalizados:', customError);
    } else {
      console.log(`📋 Encontrados ${customValues.length} valores de campos personalizados:`);
      customValues.forEach(value => {
        console.log(`  - Campo ${value.lead_custom_fields?.numeric_id} (${value.lead_custom_fields?.field_label}): ${value.value}`);
      });
    }
    
    // 4. Verificar campos personalizados disponíveis da empresa
    console.log('\n4️⃣ CAMPOS PERSONALIZADOS DISPONÍVEIS:');
    const { data: availableFields, error: fieldsError } = await supabase
      .from('lead_custom_fields')
      .select('*')
      .eq('company_id', leadData.company_id);
    
    if (fieldsError) {
      console.error('❌ Erro ao buscar campos disponíveis:', fieldsError);
    } else {
      console.log(`📋 Encontrados ${availableFields.length} campos personalizados disponíveis:`);
      availableFields.forEach(field => {
        console.log(`  - ID ${field.numeric_id}: ${field.field_label} (${field.field_type})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

debugLead119();

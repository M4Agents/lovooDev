// DEBUG SIMPLES - USANDO CREDENCIAIS DO WEBHOOK
import { createClient } from '@supabase/supabase-js';

// Usar as mesmas credenciais do webhook-lead.js
const supabaseUrl = 'https://etzdsynlpbgxkphiul.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSimple() {
  console.log('🔍 DEBUG SIMPLES - CAMPOS PERSONALIZADOS');
  console.log('=' .repeat(60));
  
  try {
    // 1. Verificar configurações de webhook
    console.log('\n1️⃣ VERIFICANDO CONFIGURAÇÕES:');
    const companyId = 'c9bf54cf-c944-4b66-82b6-dbd3c61d3d6d'; // Do log anterior
    
    const { data: configs, error: configError } = await supabase
      .from('webhook_trigger_configs')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true);
    
    if (configError) {
      console.error('❌ Erro configs:', configError);
      return;
    }
    
    console.log(`📋 Configs encontradas: ${configs?.length || 0}`);
    if (configs && configs.length > 0) {
      const config = configs[0];
      console.log('📊 Primeira config:');
      console.log(`  - Nome: ${config.name}`);
      console.log(`  - Ativa: ${config.is_active}`);
      console.log(`  - payload_fields:`, JSON.stringify(config.payload_fields, null, 2));
      
      const customFields = config.payload_fields?.custom_fields || [];
      console.log(`🎯 Campos personalizados: ${JSON.stringify(customFields)}`);
      console.log(`📈 Quantidade: ${customFields.length}`);
    }
    
    // 2. Verificar dados do lead 121
    console.log('\n2️⃣ VERIFICANDO LEAD 121:');
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('id, name, email, company_id')
      .eq('id', 121)
      .single();
    
    if (leadError) {
      console.error('❌ Erro lead:', leadError);
      return;
    }
    
    console.log('📋 Lead encontrado:');
    console.log(`  - ID: ${leadData.id}`);
    console.log(`  - Nome: ${leadData.name}`);
    console.log(`  - Company ID: ${leadData.company_id}`);
    
    // 3. Verificar campos personalizados do lead
    console.log('\n3️⃣ VERIFICANDO CAMPOS PERSONALIZADOS:');
    const { data: customValues, error: customError } = await supabase
      .from('lead_custom_values')
      .select(`
        field_id,
        value,
        lead_custom_fields (
          numeric_id,
          field_label
        )
      `)
      .eq('lead_id', 121);
    
    if (customError) {
      console.error('❌ Erro custom values:', customError);
      return;
    }
    
    console.log(`📋 Valores encontrados: ${customValues?.length || 0}`);
    if (customValues && customValues.length > 0) {
      customValues.forEach((value, index) => {
        console.log(`📊 Campo ${index + 1}:`);
        console.log(`  - numeric_id: ${value.lead_custom_fields?.numeric_id}`);
        console.log(`  - label: ${value.lead_custom_fields?.field_label}`);
        console.log(`  - value: ${value.value}`);
      });
    }
    
    // 4. Análise final
    console.log('\n4️⃣ ANÁLISE:');
    if (configs && configs.length > 0) {
      const config = configs[0];
      const selectedFields = config.payload_fields?.custom_fields || [];
      
      if (selectedFields.length === 0) {
        console.log('❌ PROBLEMA: Nenhum campo personalizado selecionado na config');
      } else {
        console.log(`✅ ${selectedFields.length} campos selecionados: ${JSON.stringify(selectedFields)}`);
        
        if (customValues && customValues.length > 0) {
          console.log('✅ Lead tem valores de campos personalizados');
          
          // Verificar correspondência
          let matches = 0;
          customValues.forEach(value => {
            const numericId = value.lead_custom_fields?.numeric_id?.toString();
            if (selectedFields.includes(numericId)) {
              matches++;
              console.log(`✅ MATCH: Campo ${numericId} selecionado e tem valor`);
            } else {
              console.log(`⚠️ Campo ${numericId} tem valor mas não está selecionado`);
            }
          });
          
          console.log(`📊 RESULTADO: ${matches} campos correspondem`);
        } else {
          console.log('❌ Lead não tem valores de campos personalizados');
        }
      }
    } else {
      console.log('❌ Nenhuma configuração de webhook encontrada');
    }
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

debugSimple();

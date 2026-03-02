// TESTE ESPECÍFICO DA LÓGICA DO WEBHOOK - APENAS ANÁLISE
// Simular exatamente o que acontece no webhook-lead.js para o lead 121

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testWebhookLogic() {
  console.log('🧪 TESTE DA LÓGICA DO WEBHOOK - LEAD ID 121');
  console.log('🎯 Simulando exatamente o que acontece no webhook-lead.js');
  console.log('=' .repeat(80));
  
  try {
    // Simular dados do lead que chegam no webhook
    const leadData = {
      lead_id: 121,
      name: "Mb Marketing E Mídia Eireli",
      email: "marcio.battistin@gmail.com",
      phone: "+5511999198369",
      status: "new",
      origin: "webhook",
      company_id: "c9bf54cf-c944-4b66-82b6-dbd3c61d3d6d" // Assumindo baseado nos logs
    };
    
    console.log('📊 DADOS DO LEAD SIMULADOS:');
    console.log(JSON.stringify(leadData, null, 2));
    
    // 1. BUSCAR CONFIGURAÇÕES (como no webhook)
    console.log('\n1️⃣ BUSCANDO CONFIGURAÇÕES DE WEBHOOK:');
    const { data: configs, error: configError } = await supabase.rpc('get_webhook_trigger_configs', {
      p_company_id: leadData.company_id
    });
    
    if (configError) {
      console.error('❌ Erro ao buscar configurações:', configError);
      return;
    }
    
    const activeConfigs = configs?.filter(config => 
      config.is_active && 
      config.trigger_events?.includes('lead_created')
    ) || [];
    
    console.log(`📋 Encontradas ${activeConfigs.length} configurações ativas para lead_created`);
    
    if (activeConfigs.length === 0) {
      console.log('❌ PROBLEMA: Nenhuma configuração ativa encontrada!');
      return;
    }
    
    // 2. PROCESSAR CADA CONFIGURAÇÃO (como no webhook)
    for (const config of activeConfigs) {
      console.log(`\n2️⃣ PROCESSANDO CONFIGURAÇÃO: ${config.name}`);
      console.log('🔍 Configuração payload_fields:', JSON.stringify(config.payload_fields, null, 2));
      
      // Construir payload básico
      const availableLeadData = {
        id: leadData.lead_id,
        name: leadData.name,
        email: leadData.email,
        phone: leadData.phone,
        status: leadData.status || 'new',
        origin: leadData.origin || 'webhook'
      };
      
      // Campos selecionados do lead
      const selectedLeadFields = config.payload_fields?.lead || ['name', 'email', 'phone', 'status', 'origin'];
      console.log('📋 Campos selecionados do lead:', selectedLeadFields);
      
      let leadPayload = {};
      selectedLeadFields.forEach(field => {
        if (availableLeadData[field] !== undefined && availableLeadData[field] !== null) {
          leadPayload[field] = availableLeadData[field];
        }
      });
      
      console.log('📊 Payload básico construído:', JSON.stringify(leadPayload, null, 2));
      
      // 3. PROCESSAR CAMPOS PERSONALIZADOS (FOCO PRINCIPAL)
      console.log('\n3️⃣ PROCESSANDO CAMPOS PERSONALIZADOS:');
      const selectedCustomFields = config.payload_fields?.custom_fields || [];
      
      console.log('🎯 DEBUG CAMPOS PERSONALIZADOS - INÍCIO');
      console.log('📋 Configuração completa payload_fields:', JSON.stringify(config.payload_fields, null, 2));
      console.log('🎯 Campos personalizados selecionados:', selectedCustomFields);
      console.log('📊 Tipo dos campos selecionados:', typeof selectedCustomFields, Array.isArray(selectedCustomFields));
      console.log('📈 Quantidade de campos selecionados:', selectedCustomFields.length);
      
      if (selectedCustomFields.length > 0) {
        console.log('✅ Entrando no processamento de campos personalizados...');
        
        try {
          console.log('🔍 INICIANDO BUSCA DE CAMPOS PERSONALIZADOS');
          console.log('📊 Lead ID para busca:', leadData.lead_id);
          console.log('🎯 Campos que estamos procurando:', selectedCustomFields);
          
          // Buscar valores dos campos personalizados do lead (EXATA como no webhook)
          const { data: customValues, error: customError } = await supabase
            .from('lead_custom_values')
            .select(`
              field_id,
              value,
              lead_custom_fields (
                numeric_id,
                field_name,
                field_label
              )
            `)
            .eq('lead_id', leadData.lead_id);
          
          console.log('📋 RESULTADO DA BUSCA:');
          console.log('- Erro:', customError);
          console.log('- Dados encontrados:', customValues?.length || 0);
          console.log('- Valores completos:', JSON.stringify(customValues, null, 2));
          
          if (customError) {
            console.error('❌ Erro ao buscar campos personalizados:', customError);
          } else if (customValues && customValues.length > 0) {
            console.log('✅ Valores de campos personalizados encontrados:', customValues.length);
            
            // Processar cada campo (EXATO como no webhook)
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
              
              // Verificar se este campo foi selecionado (EXATO como no webhook)
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
        }
      } else {
        console.log('ℹ️ Nenhum campo personalizado selecionado na configuração');
      }
      
      console.log('🎯 DEBUG CAMPOS PERSONALIZADOS - FIM');
      console.log('📊 Payload final do lead:', JSON.stringify(leadPayload, null, 2));
      
      // 4. CONSTRUIR PAYLOAD FINAL
      const payload = {
        event: 'lead_created',
        timestamp: new Date().toISOString(),
        data: {
          lead: leadPayload
        }
      };
      
      console.log('\n4️⃣ PAYLOAD FINAL QUE SERIA ENVIADO:');
      console.log(JSON.stringify(payload, null, 2));
      
      // 5. ANÁLISE FINAL
      console.log('\n5️⃣ ANÁLISE FINAL:');
      const hasCustomFields = Object.keys(leadPayload).some(key => 
        !['id', 'name', 'email', 'phone', 'status', 'origin'].includes(key)
      );
      
      if (hasCustomFields) {
        console.log('✅ SUCESSO: Campos personalizados incluídos no payload!');
      } else {
        console.log('❌ PROBLEMA: Nenhum campo personalizado incluído no payload!');
        
        // Diagnóstico
        if (selectedCustomFields.length === 0) {
          console.log('🔍 CAUSA: Nenhum campo personalizado selecionado na configuração');
        } else if (!customValues || customValues.length === 0) {
          console.log('🔍 CAUSA: Lead não possui valores em campos personalizados');
        } else {
          console.log('🔍 CAUSA: IDs não correspondem entre selecionados e encontrados');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Erro geral no teste:', error);
  }
}

// Executar teste
testWebhookLogic();

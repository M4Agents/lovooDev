// =====================================================
// SYNC WHATSAPP STATUS - EDGE FUNCTION
// =====================================================
// Sincroniza status das instâncias WhatsApp com Uazapi
// Chamado automaticamente a cada 10 minutos via cron
// Também pode ser chamado manualmente ao abrir página de integrações

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    console.log('🔄 SYNC WHATSAPP STATUS - Iniciando sincronização...');
    
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'company_id é obrigatório'
      });
    }
    
    // Usar service role key para bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Buscar instâncias conectadas da empresa
    const { data: instances, error: fetchError } = await supabase
      .from('whatsapp_life_instances')
      .select('id, instance_name, provider_instance_id, provider_token, status')
      .eq('company_id', company_id)
      .eq('status', 'connected')
      .eq('provider_type', 'uazapi');
    
    if (fetchError) {
      console.error('❌ Erro ao buscar instâncias:', fetchError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar instâncias',
        details: fetchError.message
      });
    }
    
    if (!instances || instances.length === 0) {
      console.log('ℹ️ Nenhuma instância conectada encontrada');
      return res.status(200).json({
        success: true,
        message: 'Nenhuma instância conectada para sincronizar',
        updated_count: 0
      });
    }
    
    console.log(`📊 Verificando ${instances.length} instâncias...`);
    
    let updatedCount = 0;
    const results = [];
    
    // Verificar status de cada instância no Uazapi
    for (const instance of instances) {
      try {
        console.log(`🔍 Verificando instância: ${instance.instance_name}`);
        
        // Chamar endpoint Uazapi para verificar status
        const uazapiResponse = await fetch(
          `https://lovoo.uazapi.com/instance/status`,
          {
            method: 'GET',
            headers: {
              'token': instance.provider_token,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!uazapiResponse.ok) {
          console.error(`❌ Erro ao verificar status no Uazapi: ${uazapiResponse.status}`);
          results.push({
            instance_name: instance.instance_name,
            success: false,
            error: `HTTP ${uazapiResponse.status}`
          });
          continue;
        }
        
        const uazapiData = await uazapiResponse.json();
        console.log(`📥 Status Uazapi:`, uazapiData);
        
        // Verificar se instância está desconectada no Uazapi
        // Uazapi retorna: { instance: {...}, status: { connected: true/false } }
        const isConnected = uazapiData.status?.connected;
        
        if (isConnected === false) {
          console.log(`⚠️ Instância ${instance.instance_name} desconectada no Uazapi - Atualizando banco...`);
          
          // Atualizar status no banco
          const { error: updateError } = await supabase
            .from('whatsapp_life_instances')
            .update({
              status: 'disconnected',
              updated_at: new Date().toISOString()
            })
            .eq('id', instance.id);
          
          if (updateError) {
            console.error(`❌ Erro ao atualizar instância ${instance.instance_name}:`, updateError);
            results.push({
              instance_name: instance.instance_name,
              success: false,
              error: updateError.message
            });
          } else {
            console.log(`✅ Instância ${instance.instance_name} atualizada para disconnected`);
            updatedCount++;
            results.push({
              instance_name: instance.instance_name,
              success: true,
              old_status: 'connected',
              new_status: 'disconnected'
            });
          }
        } else {
          console.log(`✅ Instância ${instance.instance_name} ainda conectada`);
          results.push({
            instance_name: instance.instance_name,
            success: true,
            status: 'still_connected'
          });
        }
        
      } catch (error) {
        console.error(`❌ Erro ao processar instância ${instance.instance_name}:`, error);
        results.push({
          instance_name: instance.instance_name,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`✅ Sincronização concluída: ${updatedCount} instâncias atualizadas`);
    
    return res.status(200).json({
      success: true,
      message: `Sincronização concluída`,
      total_instances: instances.length,
      updated_count: updatedCount,
      results
    });
    
  } catch (error) {
    console.error('❌ Erro na sincronização:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

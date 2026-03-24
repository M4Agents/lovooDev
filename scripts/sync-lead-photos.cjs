#!/usr/bin/env node

/**
 * Script de Sincronização de Fotos de Leads
 * 
 * Objetivo: Migrar fotos de perfil de leads do WhatsApp CDN (URLs temporárias)
 * para Supabase Storage (URLs permanentes)
 * 
 * Uso:
 *   node scripts/sync-lead-photos.js
 * 
 * Pode ser agendado via cron job para rodar diariamente às 3h da manhã
 */

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Configuração Supabase
const SUPABASE_URL = 'https://etzdsywunlpbgxkphuil.supabase.co';
// Usar SERVICE_ROLE_KEY para bypass do RLS e acesso completo aos dados
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODE5MjMwMywiZXhwIjoyMDYzNzY4MzAzfQ.tT3zHJXOb_2lhAnii_wKQKdBvOlPbxYJQPWKGUQEKPo';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Estatísticas
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

/**
 * Verifica se URL é do WhatsApp CDN (temporária)
 */
function isWhatsAppUrl(url) {
  if (!url) return false;
  return url.includes('pps.whatsapp.net') || url.includes('mmg.whatsapp.net');
}

/**
 * Baixa foto do WhatsApp e faz upload para Supabase Storage
 */
async function downloadAndStorePhoto(profileUrl, companyId, phoneNumber) {
  try {
    console.log(`  📥 Baixando foto: ${profileUrl.substring(0, 80)}...`);

    // 1. Download da foto
    const response = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LovooCRM/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    console.log(`  ✅ Download concluído: ${buffer.length} bytes`);

    // 2. Upload para Supabase Storage
    const timestamp = Date.now();
    const fileName = `avatars/${companyId}/${phoneNumber}_${timestamp}.jpg`;

    console.log(`  📤 Upload para Storage: ${fileName}`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Upload error: ${uploadError.message}`);
    }

    console.log(`  ✅ Upload concluído: ${uploadData.path}`);

    // 3. Obter URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(fileName);

    console.log(`  🔗 URL permanente gerada: ${publicUrl.substring(0, 80)}...`);

    return publicUrl;

  } catch (error) {
    console.error(`  ❌ Erro ao baixar/armazenar foto: ${error.message}`);
    throw error;
  }
}

/**
 * Busca foto de perfil via API Uazapi
 */
async function fetchPhotoFromUazapi(instanceName, token, phoneNumber) {
  try {
    const url = `https://api.uazapi.com/chat/GetNameAndImageURL/${instanceName}`;

    console.log(`  📡 Chamando API Uazapi: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': token,
      },
      body: JSON.stringify({ phone: phoneNumber }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data?.success || !data?.data?.profilePictureUrl) {
      console.log(`  ⚠️  Contato sem foto de perfil no WhatsApp`);
      return null;
    }

    console.log(`  ✅ Foto obtida da API Uazapi`);
    return data.data.profilePictureUrl;

  } catch (error) {
    console.error(`  ❌ Erro ao buscar foto da API: ${error.message}`);
    throw error;
  }
}

/**
 * Sincroniza foto de um contato
 */
async function syncContactPhoto(contact, instance, company) {
  const { id, phone_number, profile_picture_url, company_id } = contact;

  console.log(`\n📞 Processando: ${phone_number}`);
  console.log(`  ID: ${id}`);
  console.log(`  Foto atual: ${profile_picture_url?.substring(0, 80) || 'sem foto'}...`);

  try {
    // 1. Buscar foto via API Uazapi
    const whatsappPhotoUrl = await fetchPhotoFromUazapi(
      instance.provider_instance_id,
      company.api_key,
      phone_number
    );

    if (!whatsappPhotoUrl) {
      console.log(`  ⏭️  Pulando: sem foto no WhatsApp`);
      stats.skipped++;
      return;
    }

    // 2. Baixar e armazenar no Storage
    const permanentUrl = await downloadAndStorePhoto(
      whatsappPhotoUrl,
      company_id,
      phone_number
    );

    // 3. Atualizar banco de dados
    console.log(`  💾 Atualizando banco de dados...`);

    const { error: updateError } = await supabase
      .from('chat_contacts')
      .update({
        profile_picture_url: permanentUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(`Erro ao atualizar BD: ${updateError.message}`);
    }

    console.log(`  🎉 SUCESSO! Foto sincronizada e salva permanentemente`);
    stats.success++;

  } catch (error) {
    console.error(`  ❌ ERRO: ${error.message}`);
    stats.failed++;
    stats.errors.push({
      phone_number,
      error: error.message
    });
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 INICIANDO SINCRONIZAÇÃO DE FOTOS DE LEADS');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('');

  try {
    // 1. Buscar todos os contatos com fotos
    console.log('🔍 Buscando contatos com fotos...');

    const { data: allContacts, error: contactsError } = await supabase
      .from('chat_contacts')
      .select('id, phone_number, profile_picture_url, company_id')
      .not('profile_picture_url', 'is', null)
      .limit(200); // Processar 200 por vez

    if (contactsError) {
      throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
    }

    console.log(`📊 Total de contatos com foto: ${allContacts?.length || 0}`);

    // Filtrar apenas URLs do WhatsApp (expiradas)
    const contacts = (allContacts || []).filter(contact => 
      contact.profile_picture_url && 
      (contact.profile_picture_url.includes('pps.whatsapp.net') || 
       contact.profile_picture_url.includes('mmg.whatsapp.net'))
    );

    stats.total = contacts.length;

    console.log(`✅ Encontrados ${stats.total} contatos com fotos expiradas (WhatsApp CDN)`);
    console.log('');

    if (stats.total === 0) {
      console.log('✨ Nenhuma foto para sincronizar!');
      return;
    }

    // 2. Agrupar por empresa para buscar instâncias
    const companiesByContact = {};

    for (const contact of contacts) {
      if (!companiesByContact[contact.company_id]) {
        companiesByContact[contact.company_id] = [];
      }
      companiesByContact[contact.company_id].push(contact);
    }

    console.log(`📊 Contatos distribuídos em ${Object.keys(companiesByContact).length} empresa(s)`);
    console.log('');

    // 3. Processar cada empresa
    for (const [companyId, companyContacts] of Object.entries(companiesByContact)) {
      console.log(`\n🏢 Processando empresa: ${companyId}`);
      console.log(`   Contatos: ${companyContacts.length}`);

      // Buscar dados da empresa
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id, name, api_key')
        .eq('id', companyId)
        .single();

      if (companyError || !company) {
        console.error(`   ❌ Empresa não encontrada, pulando contatos`);
        stats.skipped += companyContacts.length;
        continue;
      }

      console.log(`   Nome: ${company.name}`);

      // Buscar instância WhatsApp da empresa
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_life_instances')
        .select('id, provider_instance_id')
        .eq('company_id', companyId)
        .eq('status', 'connected')
        .limit(1)
        .single();

      if (instanceError || !instance) {
        console.error(`   ❌ Instância WhatsApp não encontrada, pulando contatos`);
        stats.skipped += companyContacts.length;
        continue;
      }

      console.log(`   Instância: ${instance.provider_instance_id}`);

      // Processar contatos da empresa
      for (const contact of companyContacts) {
        await syncContactPhoto(contact, instance, company);
        
        // Pequeno delay para não sobrecarregar API
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 4. Relatório final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL');
    console.log('='.repeat(60));
    console.log(`Total de contatos: ${stats.total}`);
    console.log(`✅ Sucesso: ${stats.success}`);
    console.log(`⏭️  Pulados: ${stats.skipped}`);
    console.log(`❌ Falhas: ${stats.failed}`);
    console.log('');

    if (stats.errors.length > 0) {
      console.log('❌ ERROS:');
      stats.errors.forEach(({ phone_number, error }) => {
        console.log(`   ${phone_number}: ${error}`);
      });
      console.log('');
    }

    console.log('✅ SINCRONIZAÇÃO CONCLUÍDA!');
    console.log('⏰ Finalizado em:', new Date().toISOString());

  } catch (error) {
    console.error('\n❌ ERRO FATAL:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executar
main().catch(error => {
  console.error('❌ Erro não tratado:', error);
  process.exit(1);
});

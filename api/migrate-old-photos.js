// Endpoint de Migração Única de Fotos Antigas
// Endpoint: /api/migrate-old-photos
// Método: GET ou POST
// 
// Objetivo: Migrar fotos antigas do WhatsApp CDN para Supabase Storage
// Execução: UMA ÚNICA VEZ para processar fotos existentes
// 
// Após migração completa, este endpoint pode ser desativado/removido

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚀 INICIANDO MIGRAÇÃO ÚNICA DE FOTOS ANTIGAS');
  console.log('⏰ Timestamp:', new Date().toISOString());

  const startTime = Date.now();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const stats = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    // 1. Buscar TODOS os contatos com fotos do WhatsApp CDN
    console.log('🔍 Buscando contatos com fotos do WhatsApp CDN...');
    
    const { data: allContacts, error: contactsError } = await supabase
      .from('chat_contacts')
      .select('id, phone_number, profile_picture_url, company_id')
      .not('profile_picture_url', 'is', null);

    if (contactsError) {
      throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
    }

    // Filtrar apenas URLs do WhatsApp
    const contacts = (allContacts || []).filter(contact => 
      contact.profile_picture_url && 
      (contact.profile_picture_url.includes('pps.whatsapp.net') || 
       contact.profile_picture_url.includes('mmg.whatsapp.net'))
    );

    stats.total = contacts.length;
    console.log(`✅ Encontrados ${stats.total} contatos com fotos do WhatsApp CDN`);

    if (stats.total === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nenhuma foto para migrar',
        stats,
        time: `${Date.now() - startTime}ms`
      });
    }

    // 2. Agrupar por empresa
    const companiesByContact = {};
    for (const contact of contacts) {
      if (!companiesByContact[contact.company_id]) {
        companiesByContact[contact.company_id] = [];
      }
      companiesByContact[contact.company_id].push(contact);
    }

    console.log(`📊 Contatos em ${Object.keys(companiesByContact).length} empresa(s)`);

    // 3. Processar cada empresa
    for (const [companyId, companyContacts] of Object.entries(companiesByContact)) {
      console.log(`\n🏢 Processando empresa: ${companyId} (${companyContacts.length} contatos)`);

      // Buscar dados da empresa
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id, name, api_key')
        .eq('id', companyId)
        .single();

      if (companyError || !company) {
        console.error(`❌ Empresa não encontrada`);
        stats.skipped += companyContacts.length;
        continue;
      }

      // Buscar instância WhatsApp
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_life_instances')
        .select('id, provider_instance_id')
        .eq('company_id', companyId)
        .eq('status', 'connected')
        .limit(1)
        .single();

      if (instanceError || !instance) {
        console.error(`❌ Instância WhatsApp não encontrada`);
        stats.skipped += companyContacts.length;
        continue;
      }

      console.log(`✅ Empresa: ${company.name}`);
      console.log(`✅ Instância: ${instance.provider_instance_id}`);

      // Processar contatos (em lotes de 50 para evitar timeout)
      const batchSize = 50;
      const limit = Math.min(companyContacts.length, batchSize);

      for (let i = 0; i < limit; i++) {
        const contact = companyContacts[i];
        stats.processed++;

        console.log(`\n📞 [${stats.processed}/${stats.total}] ${contact.phone_number}`);

        try {
          // Buscar foto via API Uazapi
          const url = `https://api.uazapi.com/chat/GetNameAndImageURL/${instance.provider_instance_id}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': company.api_key,
            },
            body: JSON.stringify({ phone: contact.phone_number }),
          });

          if (!response.ok) {
            throw new Error(`API HTTP ${response.status}`);
          }

          const data = await response.json();
          const profileUrl = data?.data?.profilePictureUrl;

          if (!profileUrl) {
            console.log(`  ⏭️  Sem foto no WhatsApp`);
            stats.skipped++;
            continue;
          }

          // Download da foto
          const photoResponse = await fetch(profileUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });

          if (!photoResponse.ok) {
            throw new Error(`Download falhou: ${photoResponse.status}`);
          }

          const arrayBuffer = await photoResponse.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);

          // Upload para Storage
          const timestamp = Date.now();
          const fileName = `avatars/${companyId}/${contact.phone_number}_${timestamp}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from('chat-media')
            .upload(fileName, buffer, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (uploadError) {
            throw new Error(`Upload: ${uploadError.message}`);
          }

          // URL pública
          const { data: { publicUrl } } = supabase.storage
            .from('chat-media')
            .getPublicUrl(fileName);

          // Atualizar banco com foto E timestamp de atualização
          const { error: updateError } = await supabase
            .from('chat_contacts')
            .update({
              profile_picture_url: publicUrl,
              photo_updated_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', contact.id);

          if (updateError) {
            throw new Error(`Update: ${updateError.message}`);
          }

          console.log(`  🎉 SUCESSO`);
          stats.success++;

        } catch (error) {
          console.error(`  ❌ ERRO: ${error.message}`);
          stats.failed++;
          stats.errors.push({
            phone: contact.phone_number,
            error: error.message
          });
        }

        // Delay para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Se há mais contatos, informar
      if (companyContacts.length > batchSize) {
        console.log(`\n⚠️  Restam ${companyContacts.length - batchSize} contatos nesta empresa`);
        console.log(`⚠️  Execute novamente para processar o próximo lote`);
      }
    }

    const totalTime = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL');
    console.log('='.repeat(60));
    console.log(`Total encontrado: ${stats.total}`);
    console.log(`Processados: ${stats.processed}`);
    console.log(`✅ Sucesso: ${stats.success}`);
    console.log(`⏭️  Pulados: ${stats.skipped}`);
    console.log(`❌ Falhas: ${stats.failed}`);
    console.log(`⏱️  Tempo: ${(totalTime / 1000).toFixed(2)}s`);

    return res.status(200).json({
      success: true,
      message: `Migração concluída: ${stats.success} fotos migradas`,
      stats: {
        ...stats,
        remaining: stats.total - stats.processed
      },
      time: `${(totalTime / 1000).toFixed(2)}s`
    });

  } catch (error) {
    console.error('❌ ERRO FATAL:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      time: `${(Date.now() - startTime) / 1000}s`
    });
  }
}

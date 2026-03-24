// API Endpoint para Sincronização de Fotos de Leads
// Endpoint: /api/sync-photos
// Método: POST ou GET
// Sincroniza fotos de leads do WhatsApp CDN para Supabase Storage

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Permitir GET e POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚀 Iniciando sincronização de fotos via API');

  try {
    // Criar cliente Supabase com SERVICE_ROLE_KEY (bypass RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Estatísticas
    const stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    // 1. Buscar contatos com fotos do WhatsApp
    console.log('🔍 Buscando contatos com fotos do WhatsApp...');
    
    const { data: allContacts, error: contactsError } = await supabase
      .from('chat_contacts')
      .select('id, phone_number, profile_picture_url, company_id')
      .not('profile_picture_url', 'is', null)
      .limit(200);

    if (contactsError) {
      throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
    }

    // Filtrar URLs do WhatsApp
    const contacts = (allContacts || []).filter(contact => 
      contact.profile_picture_url && 
      (contact.profile_picture_url.includes('pps.whatsapp.net') || 
       contact.profile_picture_url.includes('mmg.whatsapp.net'))
    );

    stats.total = contacts.length;
    console.log(`✅ Encontrados ${stats.total} contatos com fotos do WhatsApp`);

    if (stats.total === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nenhuma foto para sincronizar',
        stats
      });
    }

    // 2. Processar cada contato (limitar a 10 por execução para não timeout)
    const limit = Math.min(contacts.length, 10);
    console.log(`📊 Processando ${limit} fotos nesta execução...`);

    for (let i = 0; i < limit; i++) {
      const contact = contacts[i];
      console.log(`\n📞 [${i+1}/${limit}] Processando: ${contact.phone_number}`);

      try {
        // Buscar empresa e instância
        const { data: company } = await supabase
          .from('companies')
          .select('id, name, api_key')
          .eq('id', contact.company_id)
          .single();

        if (!company) {
          console.log(`  ⏭️  Empresa não encontrada`);
          stats.skipped++;
          continue;
        }

        const { data: instance } = await supabase
          .from('whatsapp_life_instances')
          .select('id, provider_instance_id')
          .eq('company_id', contact.company_id)
          .eq('status', 'connected')
          .limit(1)
          .single();

        if (!instance) {
          console.log(`  ⏭️  Instância WhatsApp não encontrada`);
          stats.skipped++;
          continue;
        }

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
          throw new Error(`API Uazapi HTTP ${response.status}`);
        }

        const data = await response.json();
        const profileUrl = data?.data?.profilePictureUrl;

        if (!profileUrl) {
          console.log(`  ⏭️  Sem foto no WhatsApp`);
          stats.skipped++;
          continue;
        }

        console.log(`  ✅ Foto obtida da API`);

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
        console.log(`  📥 Download: ${buffer.length} bytes`);

        // Upload para Storage
        const timestamp = Date.now();
        const fileName = `avatars/${contact.company_id}/${contact.phone_number}_${timestamp}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: false,
          });

        if (uploadError) {
          throw new Error(`Upload falhou: ${uploadError.message}`);
        }

        // Obter URL pública
        const { data: { publicUrl } } = supabase.storage
          .from('chat-media')
          .getPublicUrl(fileName);

        console.log(`  📤 Upload concluído`);

        // Atualizar banco
        const { error: updateError } = await supabase
          .from('chat_contacts')
          .update({
            profile_picture_url: publicUrl,
            updated_at: new Date().toISOString()
          })
          .eq('id', contact.id);

        if (updateError) {
          throw new Error(`Update falhou: ${updateError.message}`);
        }

        console.log(`  🎉 SUCESSO!`);
        stats.success++;

      } catch (error) {
        console.error(`  ❌ ERRO: ${error.message}`);
        stats.failed++;
        stats.errors.push({
          phone: contact.phone_number,
          error: error.message
        });
      }

      // Pequeno delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n📊 RELATÓRIO:');
    console.log(`Total: ${stats.total}`);
    console.log(`Processados: ${limit}`);
    console.log(`Sucesso: ${stats.success}`);
    console.log(`Falhas: ${stats.failed}`);
    console.log(`Pulados: ${stats.skipped}`);

    return res.status(200).json({
      success: true,
      message: `Sincronização concluída: ${stats.success} fotos migradas`,
      stats: {
        ...stats,
        processed: limit,
        remaining: stats.total - limit
      }
    });

  } catch (error) {
    console.error('❌ ERRO FATAL:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

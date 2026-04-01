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

    const offset = parseInt(req.query?.offset || req.body?.offset || '0', 10) || 0;
    const batchSize = 10;

    // 1. Buscar contatos com fotos do WhatsApp CDN (filtro no banco + paginação)
    console.log(`🔍 Buscando contatos com fotos do WhatsApp (offset=${offset})...`);

    const { data: contacts, error: contactsError, count } = await supabase
      .from('chat_contacts')
      .select('id, phone_number, profile_picture_url, company_id', { count: 'exact' })
      .or('profile_picture_url.ilike.%pps.whatsapp.net%,profile_picture_url.ilike.%mmg.whatsapp.net%')
      .order('id')
      .range(offset, offset + batchSize - 1);

    if (contactsError) {
      throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
    }

    stats.total = count || 0;
    console.log(`✅ Total com CDN WhatsApp: ${stats.total} | Processando ${(contacts || []).length} (offset=${offset})`);

    if (!contacts || contacts.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nenhuma foto para sincronizar',
        stats: { ...stats, processed: 0, remaining: 0, nextOffset: null }
      });
    }

    // 2. Processar o lote atual
    const limit = contacts.length;
    console.log(`📊 Processando ${limit} fotos nesta execução...`);

    for (let i = 0; i < limit; i++) {
      const contact = contacts[i];
      console.log(`\n📞 [${i+1}/${limit}] Processando: ${contact.phone_number}`);

      try {
        const profileUrl = contact.profile_picture_url;

        // Tentar baixar diretamente da URL existente no banco.
        // URLs recentes do CDN WhatsApp ainda podem ser válidas.
        // URLs expiradas retornarão 403 e serão puladas.
        const photoResponse = await fetch(profileUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!photoResponse.ok) {
          if (photoResponse.status === 403 || photoResponse.status === 404) {
            console.log(`  ⏭️  URL expirada (${photoResponse.status}) — necessário novo evento de webhook`);
            stats.skipped++;
            continue;
          }
          throw new Error(`Download falhou: ${photoResponse.status}`);
        }

        const arrayBuffer = await photoResponse.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        console.log(`  📥 Download: ${buffer.length} bytes`);

        // Upload para Storage
        const cleanPhone = contact.phone_number.replace(/\D/g, '');
        const fileName = `avatars/${contact.company_id}/${cleanPhone}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
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
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('chat_contacts')
          .update({
            profile_picture_url: publicUrl,
            photo_updated_at: now,
            updated_at: now
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

    // Contatos migrados saem da query (URL mudou para Storage).
    // O próximo offset avança pelo lote menos os migrados (que saíram da lista).
    const nextOffset = offset + limit - stats.success;
    const remaining = Math.max(0, stats.total - offset - limit);

    return res.status(200).json({
      success: true,
      message: `Sincronização concluída: ${stats.success} fotos migradas`,
      stats: {
        ...stats,
        processed: limit,
        remaining,
        nextOffset: remaining > 0 ? nextOffset : null
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

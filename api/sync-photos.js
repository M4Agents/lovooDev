// API Endpoint para Sincronização de Fotos de Leads
// Endpoint: /api/sync-photos
// Método: POST ou GET
// Migra fotos de chat_contacts para o bucket público contact-avatars.
// Processa dois tipos de URL:
//   1. CDN WhatsApp (pps.whatsapp.net / mmg.whatsapp.net) — download externo, se ainda válida
//   2. Storage privado chat-media — download via service key, re-upload para contact-avatars

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Extrai o caminho relativo de uma URL do bucket chat-media.
// Formato esperado: .../storage/v1/object/public/chat-media/{filePath}
function extractChatMediaPath(url) {
  const match = url.match(/\/object\/(?:public|sign)\/chat-media\/(.+?)(?:\?|$)/);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚀 Iniciando sincronização de fotos via API');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    const offset = parseInt(req.query?.offset || req.body?.offset || '0', 10) || 0;
    const batchSize = 10;

    // Buscar contatos com URL que precisa ser migrada:
    //   - CDN WhatsApp (pps.whatsapp.net, mmg.whatsapp.net) — expiram
    //   - Storage privado chat-media — bucket privado, URL pública inválida
    console.log(`🔍 Buscando contatos para migração (offset=${offset})...`);

    const { data: contacts, error: contactsError, count } = await supabase
      .from('chat_contacts')
      .select('id, phone_number, profile_picture_url, company_id', { count: 'exact' })
      .or([
        'profile_picture_url.ilike.%pps.whatsapp.net%',
        'profile_picture_url.ilike.%mmg.whatsapp.net%',
        'profile_picture_url.ilike.%/chat-media/%'
      ].join(','))
      .order('id')
      .range(offset, offset + batchSize - 1);

    if (contactsError) {
      throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
    }

    stats.total = count || 0;
    console.log(`✅ Total pendente: ${stats.total} | Processando ${(contacts || []).length} (offset=${offset})`);

    if (!contacts || contacts.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nenhuma foto para migrar',
        stats: { ...stats, processed: 0, remaining: 0, nextOffset: null }
      });
    }

    const limit = contacts.length;

    for (let i = 0; i < limit; i++) {
      const contact = contacts[i];
      const profileUrl = contact.profile_picture_url;
      console.log(`\n📞 [${i+1}/${limit}] ${contact.phone_number} | ${profileUrl?.substring(0, 60)}...`);

      try {
        let buffer;
        const isChatMedia = profileUrl.includes('/chat-media/');

        if (isChatMedia) {
          // Download via service key do bucket privado chat-media
          const filePath = extractChatMediaPath(profileUrl);
          if (!filePath) {
            console.log(`  ⚠️  Não foi possível extrair path de chat-media, pulando`);
            stats.skipped++;
            continue;
          }

          const { data: fileBlob, error: downloadError } = await supabase.storage
            .from('chat-media')
            .download(filePath);

          if (downloadError || !fileBlob) {
            console.log(`  ⏭️  Arquivo não encontrado no chat-media: ${filePath}`);
            stats.skipped++;
            continue;
          }

          buffer = new Uint8Array(await fileBlob.arrayBuffer());
          console.log(`  📥 Download do Storage (chat-media): ${buffer.length} bytes`);
        } else {
          // Download externo da URL CDN do WhatsApp
          const photoResponse = await fetch(profileUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });

          if (!photoResponse.ok) {
            if (photoResponse.status === 403 || photoResponse.status === 404) {
              console.log(`  ⏭️  URL expirada (${photoResponse.status}) — aguardando novo evento de webhook`);
              stats.skipped++;
              continue;
            }
            throw new Error(`Download CDN falhou: ${photoResponse.status}`);
          }

          buffer = new Uint8Array(await photoResponse.arrayBuffer());
          console.log(`  📥 Download CDN: ${buffer.length} bytes`);
        }

        // Upload para o bucket público contact-avatars
        const cleanPhone = contact.phone_number.replace(/\D/g, '');
        const fileName = `avatars/${contact.company_id}/${cleanPhone}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('contact-avatars')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Upload falhou: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from('contact-avatars')
          .getPublicUrl(fileName);

        console.log(`  📤 Upload concluído → contact-avatars`);

        // Atualizar banco com URL estável pública
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

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n📊 RELATÓRIO: total=${stats.total} success=${stats.success} skipped=${stats.skipped} failed=${stats.failed}`);

    // Contatos migrados com sucesso saem da query (URL trocada).
    // Offset avança pelo lote menos os migrados.
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

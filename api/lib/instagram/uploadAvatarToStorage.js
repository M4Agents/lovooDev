// =============================================================================
// HELPER: uploadAvatarToStorage
//
// Baixa uma imagem de uma URL CDN temporária e faz upload permanente para o
// bucket público 'contact-avatars' do Supabase Storage.
//
// Uso:
//   import { uploadAvatarToStorage } from '../../lib/instagram/uploadAvatarToStorage.js'
//   const url = await uploadAvatarToStorage(svc, {
//     cdnUrl:    'https://...cdn.instagram.com/...',
//     companyId: 'uuid',
//     filename:  'ig_123456.jpg',
//   })
//
// Retorna a URL pública permanente, ou null em caso de falha (nunca lança).
// =============================================================================

const BUCKET = 'contact-avatars';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {{ cdnUrl: string, companyId: string, filename: string }} opts
 * @returns {Promise<string|null>}
 */
export async function uploadAvatarToStorage(svc, { cdnUrl, companyId, filename }) {
  if (!cdnUrl || !companyId || !filename) return null;

  try {
    // 1. Baixar a imagem da URL temporária da Meta
    const response = await fetch(cdnUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[uploadAvatarToStorage] download falhou (${response.status}) para ${filename}`);
      return null;
    }

    const buffer = new Uint8Array(await response.arrayBuffer());

    if (buffer.length === 0) {
      console.warn(`[uploadAvatarToStorage] buffer vazio para ${filename}`);
      return null;
    }

    // 2. Fazer upload para o bucket contact-avatars
    const storagePath = `avatars/${companyId}/${filename}`;

    const { error: uploadErr } = await svc.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType:  'image/jpeg',
        upsert:       true,
        cacheControl: '3600',
      });

    if (uploadErr) {
      console.warn(`[uploadAvatarToStorage] upload falhou para ${storagePath}:`, uploadErr.message);
      return null;
    }

    // 3. Retornar URL pública permanente
    const { data: { publicUrl } } = svc.storage.from(BUCKET).getPublicUrl(storagePath);
    return publicUrl ?? null;

  } catch (err) {
    console.warn(`[uploadAvatarToStorage] erro inesperado para ${filename}:`, err?.message ?? err);
    return null;
  }
}

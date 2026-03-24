// Funções auxiliares para sincronização de fotos de leads
// Usado pelo webhook para manter fotos atualizadas no Supabase Storage

import fetch from 'node-fetch';

/**
 * Verifica se foto precisa ser atualizada (throttle de 24h)
 */
export function shouldUpdatePhoto(contact) {
  // Se não tem foto, não precisa atualizar
  if (!contact.profile_picture_url) {
    return false;
  }

  // Se foto é do WhatsApp CDN (expirada), SEMPRE atualizar
  const isWhatsAppUrl = 
    contact.profile_picture_url.includes('pps.whatsapp.net') ||
    contact.profile_picture_url.includes('mmg.whatsapp.net');
  
  if (isWhatsAppUrl) {
    return true;
  }

  // Se foto já está no Storage, verificar throttle de 24h
  if (!contact.photo_updated_at) {
    // Nunca foi atualizada, atualizar agora
    return true;
  }

  const now = new Date();
  const lastUpdate = new Date(contact.photo_updated_at);
  const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

  // Atualizar se passou mais de 24h
  return hoursSinceUpdate >= 24;
}

/**
 * Busca foto de perfil via API Uazapi
 */
export async function fetchPhotoFromUazapi(instanceName, apiKey, phoneNumber) {
  try {
    const url = `https://api.uazapi.com/chat/GetNameAndImageURL/${instanceName}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
      },
      body: JSON.stringify({ phone: phoneNumber }),
    });

    if (!response.ok) {
      throw new Error(`API Uazapi HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (!data?.success || !data?.data?.profilePictureUrl) {
      return null;
    }

    return data.data.profilePictureUrl;
  } catch (error) {
    console.error(`[photoSync] Erro ao buscar foto da API: ${error.message}`);
    return null;
  }
}

/**
 * Baixa foto e faz upload para Supabase Storage
 */
export async function downloadAndStorePhoto(supabase, photoUrl, companyId, phoneNumber) {
  try {
    // Download da foto
    const response = await fetch(photoUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LovooCRM/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Download falhou: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Upload para Storage
    const timestamp = Date.now();
    const fileName = `avatars/${companyId}/${phoneNumber}_${timestamp}.jpg`;

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

    return publicUrl;
  } catch (error) {
    console.error(`[photoSync] Erro ao baixar/armazenar foto: ${error.message}`);
    throw error;
  }
}

/**
 * Sincroniza foto de contato (função principal)
 * Usa throttle de 24h - só atualiza se necessário
 */
export async function syncContactPhoto(supabase, contact, instance, company) {
  try {
    // 1. Verificar se precisa atualizar (throttle 24h)
    if (!shouldUpdatePhoto(contact)) {
      console.log(`[photoSync] Foto recente, pulando: ${contact.phone_number}`);
      return { updated: false, reason: 'throttle' };
    }

    console.log(`[photoSync] Sincronizando foto: ${contact.phone_number}`);

    // 2. Buscar foto via API Uazapi
    const photoUrl = await fetchPhotoFromUazapi(
      instance.provider_instance_id,
      company.api_key,
      contact.phone_number
    );

    if (!photoUrl) {
      console.log(`[photoSync] Sem foto no WhatsApp: ${contact.phone_number}`);
      return { updated: false, reason: 'no_photo' };
    }

    // 3. Download e upload para Storage
    const permanentUrl = await downloadAndStorePhoto(
      supabase,
      photoUrl,
      contact.company_id,
      contact.phone_number
    );

    // 4. Atualizar banco de dados
    const { error: updateError } = await supabase
      .from('chat_contacts')
      .update({
        profile_picture_url: permanentUrl,
        photo_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', contact.id);

    if (updateError) {
      throw new Error(`Erro ao atualizar banco: ${updateError.message}`);
    }

    console.log(`[photoSync] ✅ Foto sincronizada: ${contact.phone_number}`);
    return { updated: true, url: permanentUrl };

  } catch (error) {
    console.error(`[photoSync] ❌ Erro ao sincronizar foto de ${contact.phone_number}:`, error.message);
    return { updated: false, reason: 'error', error: error.message };
  }
}

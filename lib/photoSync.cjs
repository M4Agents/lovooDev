// Funções auxiliares para sincronização de fotos de leads
// Usado pelo webhook para manter fotos atualizadas no Supabase Storage
// Versão CommonJS para compatibilidade com webhook

const fetch = require('node-fetch');

/**
 * Verifica se foto precisa ser atualizada (throttle de 24h)
 */
function shouldUpdatePhoto(contact) {
  if (!contact.profile_picture_url) {
    return false;
  }

  const isWhatsAppUrl = 
    contact.profile_picture_url.includes('pps.whatsapp.net') ||
    contact.profile_picture_url.includes('mmg.whatsapp.net');
  
  if (isWhatsAppUrl) {
    return true;
  }

  if (!contact.photo_updated_at) {
    return true;
  }

  const now = new Date();
  const lastUpdate = new Date(contact.photo_updated_at);
  const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

  return hoursSinceUpdate >= 24;
}

/**
 * Busca foto de perfil via API Uazapi
 */
async function fetchPhotoFromUazapi(instanceName, apiKey, phoneNumber) {
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
async function downloadAndStorePhoto(supabase, photoUrl, companyId, phoneNumber) {
  try {
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
async function syncContactPhoto(supabase, contact, instance, company) {
  try {
    if (!shouldUpdatePhoto(contact)) {
      console.log(`[photoSync] Foto recente, pulando: ${contact.phone_number}`);
      return { updated: false, reason: 'throttle' };
    }

    console.log(`[photoSync] Sincronizando foto: ${contact.phone_number}`);

    const photoUrl = await fetchPhotoFromUazapi(
      instance.provider_instance_id,
      company.api_key,
      contact.phone_number
    );

    if (!photoUrl) {
      console.log(`[photoSync] Sem foto no WhatsApp: ${contact.phone_number}`);
      return { updated: false, reason: 'no_photo' };
    }

    const permanentUrl = await downloadAndStorePhoto(
      supabase,
      photoUrl,
      contact.company_id,
      contact.phone_number
    );

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

module.exports = {
  shouldUpdatePhoto,
  fetchPhotoFromUazapi,
  downloadAndStorePhoto,
  syncContactPhoto
};

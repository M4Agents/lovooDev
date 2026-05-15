// Funções auxiliares para sincronização de fotos de leads
// Usado pelo webhook para manter fotos atualizadas no Supabase Storage
// Versão CommonJS para compatibilidade com webhook

const fetch = require('node-fetch');

/**
 * Normaliza telefone para uso no path do Storage.
 * Remove sufixos WhatsApp (@s.whatsapp.net, @g.us etc), espaços,
 * sinal de + e qualquer caractere não numérico.
 * Formato resultante: apenas dígitos (ex: "5511987654321").
 */
function normalizePhone(phoneNumber) {
  // Remove sufixo WhatsApp antes de strip numérico
  const withoutSuffix = String(phoneNumber || '').split('@')[0];
  return withoutSuffix.replace(/\D/g, '');
}

/**
 * Retorna true se a URL for do CDN temporário do WhatsApp.
 */
function isWhatsAppCdnPhoto(url) {
  return !!(url && (
    url.includes('pps.whatsapp.net') ||
    url.includes('mmg.whatsapp.net')
  ));
}

/**
 * Verifica se a foto precisa ser atualizada:
 * - sem foto → tentar obter
 * - URL temporária do CDN WhatsApp → migrar para Storage
 * - URL estável mas sem registro de atualização → sincronizar
 * - URL estável com throttle de 24h vencido → sincronizar
 */
function shouldUpdatePhoto(contact) {
  const currentUrl = contact.profile_picture_url;

  if (!currentUrl) {
    return true;
  }

  if (isWhatsAppCdnPhoto(currentUrl)) {
    return true;
  }

  // URL estável no Storage — aplicar throttle de 24h
  if (!contact.photo_updated_at) {
    return true;
  }

  const hoursSinceUpdate = (Date.now() - new Date(contact.photo_updated_at).getTime()) / (1000 * 60 * 60);
  return hoursSinceUpdate >= 24;
}

/**
 * Busca foto de perfil via API Uazapi
 */
async function fetchPhotoFromUazapi(instanceName, apiKey, phoneNumber) {
  try {
    const url = `https://lovoo.uazapi.com/chat/GetNameAndImageURL/${instanceName}`;
    
    const cleanPhone = String(phoneNumber || '').split('@')[0].replace(/\D/g, '')
    const response = await fetch(`${url}?phone=${encodeURIComponent(cleanPhone)}`, {
      method: 'GET',
      headers: {
        'token': apiKey,
      },
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
 * Baixa foto e faz upload para Supabase Storage.
 * Usa nome estável (sem timestamp) + upsert:true para evitar acumulação de arquivos.
 * Formato: avatars/{companyId}/{phone_normalizado}.jpg
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

    const cleanPhone = normalizePhone(phoneNumber);
    const fileName = `avatars/${companyId}/${cleanPhone}.jpg`;

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
  normalizePhone,
  isWhatsAppCdnPhoto,
  shouldUpdatePhoto,
  fetchPhotoFromUazapi,
  downloadAndStorePhoto,
  syncContactPhoto
};

// api/lib/photoSync.cjs
// Utilitários de sincronização de foto de perfil de contatos WhatsApp.
//
// Garante que profile_picture_url seja uma URL permanente no Supabase Storage,
// evitando URLs temporárias do CDN do WhatsApp (que expiram em horas).
//
// Exporta:
//   isWhatsAppCdnPhoto(url)
//   downloadAndStorePhoto(supabase, cdnUrl, companyId, phoneNumber)
//   syncContactPhoto(supabase, contactData, instance, company)

'use strict';

const fetch = require('node-fetch');

const WA_CDN_HOSTS = ['pps.whatsapp.net', 'mmg.whatsapp.net'];

// Throttle: não re-sincroniza via Uazapi API se a foto já foi atualizada nas últimas 24h
const THROTTLE_MS = 24 * 60 * 60 * 1000;

/**
 * Retorna true se a URL for uma URL temporária do CDN do WhatsApp.
 */
function isWhatsAppCdnPhoto(url) {
  if (!url || typeof url !== 'string') return false;
  return WA_CDN_HOSTS.some(host => url.includes(host));
}

/**
 * Faz download de uma URL de foto e salva permanentemente no Supabase Storage.
 *
 * @param {object} supabase    - Cliente Supabase com service_role
 * @param {string} cdnUrl      - URL temporária do CDN do WhatsApp
 * @param {string} companyId   - UUID da empresa
 * @param {string} phoneNumber - Número do contato
 * @returns {Promise<string>}  URL pública permanente no Storage
 */
async function downloadAndStorePhoto(supabase, cdnUrl, companyId, phoneNumber) {
  const photoResponse = await fetch(cdnUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  if (!photoResponse.ok) {
    throw new Error(`Download falhou: HTTP ${photoResponse.status}`);
  }

  const arrayBuffer = await photoResponse.arrayBuffer();
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
}

/**
 * Sincroniza a foto do contato via Uazapi API, com throttle de 24h.
 *
 * Retorna { updated: boolean, reason?: string }.
 * Nunca lança exceção — erros são convertidos em { updated: false }.
 *
 * @param {object} supabase     - Cliente Supabase com service_role
 * @param {object} contactData  - { id, phone_number, profile_picture_url, photo_updated_at, company_id }
 * @param {object} instance     - { provider_instance_id }
 * @param {object} company      - { api_key }
 */
async function syncContactPhoto(supabase, contactData, instance, company) {
  // Já é URL permanente → proteger
  if (
    contactData.profile_picture_url &&
    !isWhatsAppCdnPhoto(contactData.profile_picture_url)
  ) {
    return { updated: false, reason: 'already_permanent' };
  }

  // Throttle: não re-sincroniza se já atualizou nas últimas 24h
  if (contactData.photo_updated_at) {
    const lastUpdate = new Date(contactData.photo_updated_at).getTime();
    if (Date.now() - lastUpdate < THROTTLE_MS) {
      return { updated: false, reason: 'throttle_24h' };
    }
  }

  // api_key necessária para chamada Uazapi
  if (!instance?.provider_instance_id || !company?.api_key) {
    return { updated: false, reason: 'missing_instance_or_api_key' };
  }

  // Buscar URL de foto via Uazapi
  const apiUrl = `https://api.uazapi.com/chat/GetNameAndImageURL/${instance.provider_instance_id}`;
  const apiResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': company.api_key,
    },
    body: JSON.stringify({ phone: contactData.phone_number }),
  });

  if (!apiResponse.ok) {
    throw new Error(`Uazapi API: HTTP ${apiResponse.status}`);
  }

  const apiData = await apiResponse.json();
  const profileUrl = apiData?.data?.profilePictureUrl;

  if (!profileUrl) {
    return { updated: false, reason: 'no_photo_in_whatsapp' };
  }

  // Download e upload permanente no Storage
  const permanentUrl = await downloadAndStorePhoto(
    supabase,
    profileUrl,
    contactData.company_id,
    contactData.phone_number
  );

  const { error: updateError } = await supabase
    .from('chat_contacts')
    .update({
      profile_picture_url: permanentUrl,
      photo_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactData.id);

  if (updateError) {
    throw new Error(`Update falhou: ${updateError.message}`);
  }

  return { updated: true };
}

module.exports = { isWhatsAppCdnPhoto, downloadAndStorePhoto, syncContactPhoto };

const WA_CDN_HOSTS = ['pps.whatsapp.net', 'mmg.whatsapp.net']

/**
 * Retorna true se a URL pertence ao CDN temporário do WhatsApp.
 * Essas URLs expiram e geram erros 403 no navegador.
 */
export function isWhatsAppCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return WA_CDN_HOSTS.some(host => url.includes(host))
}

/**
 * Resolve a URL de foto para uso no componente Avatar.
 * Se a URL for do CDN temporário do WhatsApp, retorna undefined,
 * forçando o Avatar a renderizar o placeholder imediatamente.
 */
export function resolvePhotoUrl(url: string | null | undefined): string | undefined {
  if (!url || isWhatsAppCdnUrl(url)) return undefined
  return url
}

// Utilitários para formatação de redes sociais
// Data: 2025-11-28

/**
 * Formatar username do Instagram para URL completa
 * @param username Username sem @ ou com @
 * @returns URL completa do Instagram
 */
export const formatInstagram = (username: string): string => {
  if (!username) return '';
  
  // Remove @ se existir e espaços
  const cleanUsername = username.replace('@', '').trim();
  
  if (!cleanUsername) return '';
  
  return `https://www.instagram.com/${cleanUsername}`;
};

/**
 * Formatar username do LinkedIn para URL completa
 * @param username Username do LinkedIn
 * @returns URL completa do LinkedIn
 */
export const formatLinkedIn = (username: string): string => {
  if (!username) return '';
  
  // Remove espaços e caracteres especiais
  const cleanUsername = username.trim();
  
  if (!cleanUsername) return '';
  
  return `https://www.linkedin.com/in/${cleanUsername}`;
};

/**
 * Formatar username do TikTok com @
 * @param username Username sem @ ou com @
 * @returns Username formatado com @
 */
export const formatTikTok = (username: string): string => {
  if (!username) return '';
  
  // Remove @ se existir e espaços
  const cleanUsername = username.replace('@', '').trim();
  
  if (!cleanUsername) return '';
  
  return `@${cleanUsername}`;
};

/**
 * Extrair username do Instagram de uma URL
 * @param url URL completa do Instagram
 * @returns Username limpo
 */
export const extractInstagramUsername = (url: string): string => {
  if (!url) return '';
  
  // Se já é só o username
  if (!url.includes('instagram.com')) {
    return url.replace('@', '').trim();
  }
  
  // Extrair da URL
  const match = url.match(/instagram\.com\/([^\/\?]+)/);
  return match ? match[1] : '';
};

/**
 * Extrair username do LinkedIn de uma URL
 * @param url URL completa do LinkedIn
 * @returns Username limpo
 */
export const extractLinkedInUsername = (url: string): string => {
  if (!url) return '';
  
  // Se já é só o username
  if (!url.includes('linkedin.com')) {
    return url.trim();
  }
  
  // Extrair da URL
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  return match ? match[1] : '';
};

/**
 * Extrair username do TikTok
 * @param username Username com ou sem @
 * @returns Username limpo sem @
 */
export const extractTikTokUsername = (username: string): string => {
  if (!username) return '';
  
  return username.replace('@', '').trim();
};

/**
 * Validar se username é válido (apenas letras, números, underscore, ponto)
 * @param username Username para validar
 * @returns true se válido
 */
export const isValidSocialUsername = (username: string): boolean => {
  if (!username) return true; // Campo opcional
  
  const cleanUsername = username.replace('@', '').trim();
  
  // Regex para username válido: letras, números, underscore, ponto
  const usernameRegex = /^[a-zA-Z0-9_.]+$/;
  
  return usernameRegex.test(cleanUsername) && cleanUsername.length >= 1 && cleanUsername.length <= 30;
};

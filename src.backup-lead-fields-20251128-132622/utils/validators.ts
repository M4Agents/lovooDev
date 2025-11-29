// Validadores para o módulo de Leads

export const validateCNPJ = (cnpj: string): boolean => {
  if (!cnpj) return true; // Campo não obrigatório
  
  // Remove caracteres não numéricos
  const cleanCNPJ = cnpj.replace(/\D/g, '');
  
  // Verifica se tem 14 dígitos
  if (cleanCNPJ.length !== 14) return false;
  
  // Verifica se todos os dígitos são iguais
  if (/^(\d)\1{13}$/.test(cleanCNPJ)) return false;
  
  // Validação dos dígitos verificadores
  let sum = 0;
  let weight = 2;
  
  // Primeiro dígito verificador
  for (let i = 11; i >= 0; i--) {
    sum += parseInt(cleanCNPJ.charAt(i)) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  
  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(cleanCNPJ.charAt(12)) !== digit) return false;
  
  // Segundo dígito verificador
  sum = 0;
  weight = 2;
  
  for (let i = 12; i >= 0; i--) {
    sum += parseInt(cleanCNPJ.charAt(i)) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  
  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return parseInt(cleanCNPJ.charAt(13)) === digit;
};

export const validateEmail = (email: string): boolean => {
  if (!email) return true; // Campo não obrigatório
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateURL = (url: string): boolean => {
  if (!url) return true; // Campo não obrigatório
  
  try {
    // Adiciona http:// se não tiver protocolo
    const urlToTest = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://${url}`;
    
    new URL(urlToTest);
    return true;
  } catch {
    return false;
  }
};

export const validateCEP = (cep: string): boolean => {
  if (!cep) return true; // Campo não obrigatório
  
  const cleanCEP = cep.replace(/\D/g, '');
  return cleanCEP.length === 8;
};

export const validatePhone = (phone: string): boolean => {
  if (!phone) return true; // Campo não obrigatório
  
  const cleanPhone = phone.replace(/\D/g, '');
  return cleanPhone.length >= 10 && cleanPhone.length <= 11;
};

export const validateUF = (uf: string): boolean => {
  if (!uf) return true; // Campo não obrigatório
  
  const validUFs = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];
  
  return validUFs.includes(uf.toUpperCase());
};

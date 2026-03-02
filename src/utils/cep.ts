// Utilitário de busca de CEP para o módulo de Leads
// Integração com API ViaCEP (gratuita e pública)

export interface CEPData {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  gia: string;
  ddd: string;
  siafi: string;
  erro?: boolean;
}

export interface CEPResult {
  success: boolean;
  data?: CEPData;
  error?: string;
}

/**
 * Busca dados de endereço pela API ViaCEP
 * @param cep CEP com ou sem máscara
 * @returns Dados do endereço ou erro
 */
export const fetchCEPData = async (cep: string): Promise<CEPResult> => {
  try {
    // Limpar CEP (remover pontos, traços, espaços)
    const cleanCEP = cep.replace(/\D/g, '');
    
    // Validar formato básico
    if (cleanCEP.length !== 8) {
      return {
        success: false,
        error: 'CEP deve ter 8 dígitos'
      };
    }

    // Fazer requisição para ViaCEP
    const response = await fetch(`https://viacep.com.br/ws/${cleanCEP}/json/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'Erro na consulta do CEP'
      };
    }

    const data: CEPData = await response.json();

    // Verificar se CEP foi encontrado
    if (data.erro) {
      return {
        success: false,
        error: 'CEP não encontrado'
      };
    }

    return {
      success: true,
      data
    };

  } catch (error) {
    console.error('Error fetching CEP:', error);
    return {
      success: false,
      error: 'Erro de conexão ao buscar CEP'
    };
  }
};

/**
 * Formatar endereço completo a partir dos dados do CEP
 * @param data Dados retornados pela API ViaCEP
 * @returns Endereço formatado
 */
export const formatAddress = (data: CEPData): string => {
  const parts = [];
  
  if (data.logradouro) parts.push(data.logradouro);
  if (data.bairro) parts.push(data.bairro);
  
  return parts.join(', ');
};

/**
 * Validar se CEP está no formato correto para busca
 * @param cep CEP com ou sem máscara
 * @returns true se válido para busca
 */
export const isValidCEPForSearch = (cep: string): boolean => {
  const cleanCEP = cep.replace(/\D/g, '');
  return cleanCEP.length === 8;
};

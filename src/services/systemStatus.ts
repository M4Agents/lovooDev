// =====================================================
// DETECÇÃO DE STATUS DO SISTEMA - CONFIGURAÇÃO AUTOMÁTICA
// =====================================================

import { supabase } from '../lib/supabase';

export interface SystemStatus {
  adminApiAvailable: boolean;
  smtpConfigured: boolean;
  mode: 'production' | 'development' | 'compatibility';
  features: {
    realUserCreation: boolean;
    emailInvites: boolean;
    fullAuthentication: boolean;
  };
}

let cachedStatus: SystemStatus | null = null;
let lastCheck = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Verifica o status completo do sistema
 */
export const getSystemStatus = async (): Promise<SystemStatus> => {
  const now = Date.now();
  
  // Usar cache se disponível e válido
  if (cachedStatus && (now - lastCheck) < CACHE_DURATION) {
    return cachedStatus;
  }

  console.log('SystemStatus: Checking system capabilities...');

  const status: SystemStatus = {
    adminApiAvailable: false,
    smtpConfigured: false,
    mode: 'compatibility',
    features: {
      realUserCreation: false,
      emailInvites: false,
      fullAuthentication: false
    }
  };

  try {
    // Testar Admin API
    status.adminApiAvailable = await testAdminApi();
    
    // Testar SMTP (indiretamente)
    status.smtpConfigured = await testSmtpConfiguration();
    
    // Determinar modo de operação
    if (status.adminApiAvailable && status.smtpConfigured) {
      status.mode = 'production';
      status.features = {
        realUserCreation: true,
        emailInvites: true,
        fullAuthentication: true
      };
    } else if (status.adminApiAvailable) {
      status.mode = 'development';
      status.features = {
        realUserCreation: true,
        emailInvites: false,
        fullAuthentication: false
      };
    } else {
      status.mode = 'compatibility';
      status.features = {
        realUserCreation: false,
        emailInvites: false,
        fullAuthentication: false
      };
    }

    console.log('SystemStatus: System status determined:', status);
    
    // Atualizar cache
    cachedStatus = status;
    lastCheck = now;
    
    return status;
  } catch (error) {
    console.error('SystemStatus: Error checking system status:', error);
    
    // Retornar modo compatibilidade em caso de erro
    const fallbackStatus: SystemStatus = {
      adminApiAvailable: false,
      smtpConfigured: false,
      mode: 'compatibility',
      features: {
        realUserCreation: false,
        emailInvites: false,
        fullAuthentication: false
      }
    };
    
    cachedStatus = fallbackStatus;
    lastCheck = now;
    
    return fallbackStatus;
  }
};

/**
 * Testa se Admin API está disponível
 */
const testAdminApi = async (): Promise<boolean> => {
  try {
    const { error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });
    
    return !error;
  } catch (error) {
    console.log('SystemStatus: Admin API not available:', error);
    return false;
  }
};

/**
 * Testa configuração SMTP indiretamente
 */
const testSmtpConfiguration = async (): Promise<boolean> => {
  try {
    // Por enquanto, assumir que SMTP não está configurado
    // TODO: Implementar teste real quando configuração estiver disponível
    return false;
  } catch (error) {
    console.log('SystemStatus: SMTP test failed:', error);
    return false;
  }
};

/**
 * Força atualização do cache
 */
export const refreshSystemStatus = async (): Promise<SystemStatus> => {
  cachedStatus = null;
  lastCheck = 0;
  return await getSystemStatus();
};

/**
 * Obtém status do cache (sem fazer nova verificação)
 */
export const getCachedSystemStatus = (): SystemStatus | null => {
  return cachedStatus;
};

/**
 * Verifica se funcionalidade específica está disponível
 */
export const isFeatureAvailable = async (feature: keyof SystemStatus['features']): Promise<boolean> => {
  const status = await getSystemStatus();
  return status.features[feature];
};

/**
 * Obtém mensagem de status para usuário
 */
export const getStatusMessage = (status: SystemStatus): string => {
  switch (status.mode) {
    case 'production':
      return 'Sistema operando em modo completo';
    case 'development':
      return 'Sistema em modo de desenvolvimento - emails não configurados';
    case 'compatibility':
      return 'Sistema em modo compatibilidade - funcionalidades limitadas';
    default:
      return 'Status do sistema desconhecido';
  }
};

/**
 * Obtém cor do status para interface
 */
export const getStatusColor = (status: SystemStatus): string => {
  switch (status.mode) {
    case 'production':
      return 'green';
    case 'development':
      return 'yellow';
    case 'compatibility':
      return 'blue';
    default:
      return 'gray';
  }
};

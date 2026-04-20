// =====================================================
// WHATSAPP LIFE - TIPOS TYPESCRIPT
// =====================================================
// Tipos isolados para o sistema de instâncias WhatsApp

// =====================================================
// TIPOS PRINCIPAIS
// =====================================================

export interface WhatsAppLifeInstance {
  id: string;
  company_id: string;
  
  // Dados visíveis ao usuário
  instance_name: string;
  phone_number?: string;
  profile_name?: string;
  profile_picture_url?: string;
  
  // Status da conexão
  status: WhatsAppInstanceStatus;
  
  // Dados técnicos (não expostos ao frontend)
  provider_type: 'uazapi';
  provider_instance_id?: string;
  provider_token?: string;
  qr_code?: string;
  qr_expires_at?: string;
  
  // Timestamps
  connected_at?: string;
  last_activity_at?: string;
  created_at: string;
  updated_at: string;
}

export type WhatsAppInstanceStatus = 
  | 'disconnected'   // Desconectado
  | 'connecting'     // Conectando (criando instância)
  | 'qr_pending'     // Aguardando scan do QR Code
  | 'connected'      // Conectado e funcionando
  | 'error';         // Erro na conexão

// =====================================================
// TIPOS PARA PLANOS E LIMITES
// =====================================================

export interface PlanLimits {
  canAdd: boolean;
  currentCount: number;
  maxAllowed: number | null;  // null = ilimitado (Elite/custom)
  planType: string;
  remaining: number | null;   // null = ilimitado (Elite/custom)
}

export interface PlanConfig {
  planType: 'starter' | 'growth' | 'pro' | 'elite';
  maxInstances: number | null;  // null = ilimitado
  price: string;
  features: string[];
}

// Slugs oficiais: starter, growth, pro, elite
// maxInstances NULL = ilimitado (Elite/custom)
export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  starter: {
    planType: 'starter',
    maxInstances: 3,
    price: 'R$ 347/mês',
    features: ['3 canais WhatsApp', '2 usuários', '5.000 leads'],
  },
  growth: {
    planType: 'growth',
    maxInstances: 5,
    price: 'R$ 697/mês',
    features: ['5 canais WhatsApp', '5 usuários', '15.000 leads'],
  },
  pro: {
    planType: 'pro',
    maxInstances: 10,
    price: 'R$ 1.097/mês',
    features: ['10 canais WhatsApp', '15 usuários', '30.000 leads'],
  },
  elite: {
    planType: 'elite',
    maxInstances: null,
    price: 'Sob consulta',
    features: ['Ilimitado', 'Suporte dedicado', 'SLA personalizado'],
  },
};

// =====================================================
// TIPOS PARA UAZAPI
// =====================================================

export interface UazapiInstance {
  id: string;
  name: string;
  token: string;
  status: 'disconnected' | 'connecting' | 'connected';
  paircode?: string;
  qrcode?: string;
  profileName?: string;
  profilePicture?: string;
  phoneNumber?: string;
}

export interface UazapiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CreateInstanceRequest {
  name: string;
  company_id: string;
}

export interface CreateInstanceResponse {
  success: boolean;
  instanceId?: string;
  error?: string;
  message?: string;
  planInfo?: PlanLimits;
  tempData?: {
    temp_instance_id: string;
    qrcode: string;
    expires_at: string;
    instance_name: string;
    company_id: string;
  };
}

// =====================================================
// TIPOS PARA COMPONENTES
// =====================================================

export interface InstanceCardProps {
  instance: WhatsAppLifeInstance;
  onRefetch: () => void;
  onDelete?: (instanceId: string) => void;
  onReconnect?: (instanceId: string) => void;
}

export interface QRCodeDisplayProps {
  qrCode: string;
  instanceName: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export interface AddInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  planLimits: PlanLimits;
}

// =====================================================
// TIPOS PARA HOOKS
// =====================================================

export interface UseInstancesReturn {
  instances: WhatsAppLifeInstance[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createInstance: (name: string) => Promise<CreateInstanceResponse>;
  generateQRCode: (name: string) => Promise<{
    success: boolean;
    data?: {
      temp_instance_id: string;
      qrcode: string;
      expires_at: string;
      instance_name: string;
      company_id: string;
      async_mode?: boolean;
      status?: string;
      message?: string;
      webhook_url?: string;
      uazapi_instance_id?: string;
      uazapi_name?: string;
    };
    error?: string;
    planInfo?: any;
  }>;
  confirmConnection: (
    tempInstanceId: string,
    companyId: string,
    instanceName: string,
    phoneNumber?: string,
    profileName?: string
  ) => Promise<CreateInstanceResponse>;
  checkConnectionStatus: (tempInstanceId: string) => Promise<{
    success: boolean;
    status?: string;
    message?: string;
    error?: string;
  }>;
  getTempInstanceStatus: (tempInstanceId: string) => Promise<{
    success: boolean;
    data?: {
      temp_instance_id: string;
      status: string;
      qrcode?: string;
      paircode?: string;
      error_message?: string;
      instance_name: string;
      created_at: string;
      updated_at: string;
      expires_at: string;
    };
    error?: string;
  }>;
  getInstanceStatus: (instanceId: string) => Promise<{
    success: boolean;
    temp_instance_id?: string;
    instance_name?: string;
    status?: string;
    connected?: boolean;
    logged_in?: boolean;
    profile_name?: string;
    phone_number?: string;
    provider_instance_id?: string;
    error?: string;
  }>;
  getQRCode: (instanceId: string) => Promise<{
    success: boolean;
    data?: { qrcode: string; expires_at?: string; status?: string };
    error?: string;
  }>;
  deleteInstance: (instanceId: string) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }>;
  updateInstance: (instanceId: string, updates: Partial<WhatsAppLifeInstance>) => Promise<void>;
  syncWithUazapi: () => Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }>;
  updateInstanceName: (instanceId: string, newName: string) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }>;
  fetchInstances: () => Promise<void>;
  syncProfileData: (instanceId: string) => Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }>;
}

export interface UseQRCodeReturn {
  qrCode: string | null;
  loading: boolean;
  error: string | null;
  generateQRCode: (instanceId: string) => Promise<void>;
  clearQRCode: () => void;
}

export interface UsePlanLimitsReturn {
  planLimits: PlanLimits;
  loading: boolean;
  error: string | null;
  canAddInstance: boolean;
  planConfig: PlanConfig;
  refetch: () => Promise<void>;
}

// =====================================================
// TIPOS PARA API RESPONSES
// =====================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ListInstancesResponse extends ApiResponse {
  data?: WhatsAppLifeInstance[];
}

export interface GetInstanceResponse extends ApiResponse {
  data?: WhatsAppLifeInstance;
}

export interface UpdateInstanceResponse extends ApiResponse {
  data?: WhatsAppLifeInstance;
}

export interface DeleteInstanceResponse extends ApiResponse {
  message?: string;
}

// =====================================================
// TIPOS PARA CONFIGURAÇÕES
// =====================================================

export interface WhatsAppLifeConfig {
  uazapi: {
    baseUrl: string;
    adminToken: string;
    timeout: number;
    retryAttempts: number;
  };
  qrCode: {
    expirationMinutes: number;
    refreshInterval: number;
  };
  instance: {
    maxNameLength: number;
    allowedStatuses: WhatsAppInstanceStatus[];
  };
}

// =====================================================
// CONSTANTES
// =====================================================

export const WHATSAPP_LIFE_CONSTANTS = {
  MAX_INSTANCE_NAME_LENGTH: 50,
  QR_CODE_EXPIRATION_MINUTES: 5,
  QR_CODE_REFRESH_INTERVAL: 30000, // 30 segundos
  STATUS_CHECK_INTERVAL: 10000, // 10 segundos
  MAX_RETRY_ATTEMPTS: 3,
  
  ROUTES: {
    MAIN: '/settings/whatsapp-life',
    INSTANCES: '/settings/whatsapp-life/instances',
  },
  
  API_ENDPOINTS: {
    INSTANCES: '/api/whatsapp-life/instances',
    QR_CODE: '/api/whatsapp-life/qrcode',
    PLAN_LIMITS: '/api/whatsapp-life/plan-limits',
  }
} as const;

// =====================================================
// GUARDS E VALIDAÇÕES
// =====================================================

export const isValidInstanceStatus = (status: string): status is WhatsAppInstanceStatus => {
  return ['disconnected', 'connecting', 'qr_pending', 'connected', 'error'].includes(status);
};

export const isValidPlanType = (plan: string): plan is keyof typeof PLAN_CONFIGS => {
  return ['starter', 'growth', 'pro', 'elite'].includes(plan);
};

export const getStatusColor = (status: WhatsAppInstanceStatus): string => {
  switch (status) {
    case 'connected':
      return 'text-green-600 bg-green-50 border-green-200';
    case 'connecting':
    case 'qr_pending':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'error':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'disconnected':
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200';
  }
};

export const getStatusLabel = (status: WhatsAppInstanceStatus): string => {
  switch (status) {
    case 'connected':
      return 'Conectado';
    case 'connecting':
      return 'Conectando';
    case 'qr_pending':
      return 'Aguardando QR Code';
    case 'error':
      return 'Erro';
    case 'disconnected':
    default:
      return 'Desconectado';
  }
};

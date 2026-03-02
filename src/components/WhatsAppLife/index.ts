// =====================================================
// WHATSAPP LIFE - EXPORTS PRINCIPAIS
// =====================================================
// Arquivo de índice para exportar todos os componentes do WhatsApp Life

// Componente principal
export { WhatsAppLifeModule } from './WhatsAppLifeModule';

// Hooks (re-export para conveniência)
export { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances';
export { usePlanLimits } from '../../hooks/usePlanLimits';
export { useQRCode } from '../../hooks/useQRCode';

// Tipos (re-export para conveniência)
export type {
  WhatsAppLifeInstance,
  WhatsAppInstanceStatus,
  PlanLimits,
  PlanConfig,
  CreateInstanceResponse,
  UseInstancesReturn,
  UsePlanLimitsReturn,
  UseQRCodeReturn,
} from '../../types/whatsapp-life';

// Constantes
export { WHATSAPP_LIFE_CONSTANTS, PLAN_CONFIGS } from '../../types/whatsapp-life';

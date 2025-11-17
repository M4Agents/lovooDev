// =====================================================
// HOOK: useWhatsAppInstances (WEBHOOK 100% VERSION)
// =====================================================
// Versão otimizada com webhook 100% - mais rápida e confiável

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  WhatsAppLifeInstance, 
  CreateInstanceResponse, 
  UseInstancesReturn,
  WHATSAPP_LIFE_CONSTANTS 
} from '../types/whatsapp-life';

// =====================================================
// HOOK PRINCIPAL (WEBHOOK 100%)
// =====================================================
export const useWhatsAppInstancesWebhook100 = (companyId?: string): UseInstancesReturn => {
  const [instances, setInstances] = useState<WhatsAppLifeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // =====================================================
  // BUSCAR INSTÂNCIAS
  // =====================================================
  const fetchInstances = useCallback(async () => {
    if (!companyId) {
      setInstances([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('whatsapp_life_instances')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      setInstances(data || []);
    } catch (err) {
      console.error('[useWhatsAppInstancesWebhook100] Erro ao buscar instâncias:', err);
      setError(err instanceof Error ? err.message : 'Erro ao buscar instâncias');
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // =====================================================
  // GERAR QR CODE (WEBHOOK 100% - OTIMIZADO)
  // =====================================================
  const generateQRCode = useCallback(async (name: string): Promise<{
    success: boolean;
    data?: {
      temp_instance_id: string;
      qrcode: string;
      expires_at: string;
      instance_name: string;
      company_id: string;
      async_mode?: boolean;
      approach?: string;
    };
    error?: string;
    planInfo?: any;
  }> => {
    if (!companyId) {
      return {
        success: false,
        error: 'ID da empresa não encontrado',
      };
    }

    try {
      console.log('[useWhatsAppInstancesWebhook100] 🎯 WEBHOOK 100% PURO - SEM EDGE FUNCTION!');
      console.log('[useWhatsAppInstancesWebhook100] Generating QR Code for:', name);
      
      // USAR VERSÃO WEBHOOK 100% PURA (apenas init + webhook real)
      const { data, error } = await supabase.rpc('generate_whatsapp_qr_code_pure_webhook', {
        p_company_id: companyId,
        p_instance_name: name,
      });

      console.log('[useWhatsAppInstancesWebhook100] QR Code response (Pure Webhook 100%):', { data, error });

      if (error) {
        console.error('[useWhatsAppInstancesWebhook100] Erro RPC:', error);
        return {
          success: false,
          error: `RPC Error: ${error.message || JSON.stringify(error)}`,
        };
      }

      if (data && data.success) {
        return {
          success: true,
          data: data.data,
        };
      } else {
        return {
          success: false,
          error: data?.error || 'Erro desconhecido',
          planInfo: data?.planInfo,
        };
      }
    } catch (err) {
      console.error('[useWhatsAppInstancesWebhook100] Erro ao gerar QR Code:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao gerar QR Code',
      };
    }
  }, [companyId]);

  // =====================================================
  // VERIFICAR STATUS DE INSTÂNCIA TEMPORÁRIA
  // =====================================================
  const getTempInstanceStatus = useCallback(async (tempInstanceId: string): Promise<{
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
  }> => {
    try {
      const { data, error } = await supabase.rpc('get_temp_instance_status', {
        p_temp_instance_id: tempInstanceId,
      });

      if (error) {
        return {
          success: false,
          error: error.message,
        };
      }

      return data || { success: false, error: 'Resposta inválida' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao verificar status temporário',
      };
    }
  }, []);

  // =====================================================
  // FUNÇÕES COMPATIBILIDADE (STUBS)
  // =====================================================
  const confirmConnection = useCallback(async (
    tempInstanceId: string,
    companyId: string,
    instanceName: string,
    phoneNumber?: string,
    profileName?: string
  ): Promise<CreateInstanceResponse> => {
    // Implementação futura
    return {
      success: false,
      error: 'Função não implementada na versão Webhook 100%'
    };
  }, []);

  const checkConnectionStatus = useCallback(async (tempInstanceId: string) => {
    // Usar getTempInstanceStatus como fallback
    const result = await getTempInstanceStatus(tempInstanceId);
    return {
      success: result.success,
      status: result.data?.status,
      error: result.error
    };
  }, [getTempInstanceStatus]);

  const getQRCode = useCallback(async (instanceId: string) => {
    return {
      success: false,
      error: 'Função não implementada na versão Webhook 100%'
    };
  }, []);

  const createInstance = useCallback(async (name: string): Promise<CreateInstanceResponse> => {
    console.warn('[useWhatsAppInstancesWebhook100] createInstance is deprecated. Use generateQRCode instead.');
    
    const qrResult = await generateQRCode(name);
    if (!qrResult.success) {
      return {
        success: false,
        error: qrResult.error || 'Erro ao gerar QR Code',
        planInfo: qrResult.planInfo,
      };
    }

    return {
      success: true,
      instanceId: qrResult.data?.temp_instance_id || '',
      message: 'QR Code gerado. Escaneie para conectar.',
      tempData: qrResult.data,
    };
  }, [generateQRCode]);

  const updateInstance = useCallback(async (
    instanceId: string, 
    updates: Partial<WhatsAppLifeInstance>
  ): Promise<void> => {
    // Implementação futura
    console.warn('[useWhatsAppInstancesWebhook100] updateInstance not implemented');
  }, []);

  const deleteInstance = useCallback(async (instanceId: string): Promise<void> => {
    // Implementação futura
    console.warn('[useWhatsAppInstancesWebhook100] deleteInstance not implemented');
  }, []);

  const refetch = useCallback(async () => {
    await fetchInstances();
  }, [fetchInstances]);

  // =====================================================
  // EFFECTS
  // =====================================================
  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // =====================================================
  // RETORNO DO HOOK
  // =====================================================
  return {
    instances,
    loading,
    error,
    refetch,
    createInstance,
    generateQRCode,
    confirmConnection,
    checkConnectionStatus,
    getTempInstanceStatus,
    getQRCode,
    deleteInstance,
    updateInstance,
  };
};

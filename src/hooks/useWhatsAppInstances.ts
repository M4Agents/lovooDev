// =====================================================
// HOOK: useWhatsAppInstances
// =====================================================
// Hook para gerenciar instâncias WhatsApp Life

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  WhatsAppLifeInstance, 
  CreateInstanceResponse, 
  UseInstancesReturn,
  WHATSAPP_LIFE_CONSTANTS 
} from '../types/whatsapp-life';

// =====================================================
// HOOK PRINCIPAL
// =====================================================
export const useWhatsAppInstances = (companyId?: string): UseInstancesReturn => {
  const [instances, setInstances] = useState<WhatsAppLifeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // =====================================================
  // BUSCAR INSTÂNCIAS (ANTI-CORS)
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

      console.log('[useWhatsAppInstances] Fetching instances for company:', companyId);

      // ✅ ANTI-CORS: Usar Supabase diretamente em vez de fetch
      const { data, error } = await supabase
        .from('whatsapp_life_instances')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      console.log('[useWhatsAppInstances] Supabase response:', { data, error });

      if (error) {
        console.error('[useWhatsAppInstances] Supabase error:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      // data é um array de instâncias diretamente do Supabase
      setInstances(data || []);
    } catch (err) {
      console.error('[useWhatsAppInstances] Erro ao buscar instâncias:', err);
      setError(err instanceof Error ? err.message : 'Erro ao buscar instâncias');
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // =====================================================
  // GERAR QR CODE (WEBHOOK 100% - VERSÃO OTIMIZADA)
  // =====================================================

      if (error) {
        console.error('[useWhatsAppInstances] Erro RPC:', error);
        return {
          success: false,
          error: `RPC Error: ${error.message || JSON.stringify(error)}`,
        };
      }

      if (data?.success) {
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
      console.error('[useWhatsAppInstances] Erro ao gerar QR Code:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao gerar QR Code',
      };
    }
  }, [companyId]);

  // =====================================================
  // CONFIRMAR CONEXÃO E CRIAR INSTÂNCIA
  // =====================================================
  const confirmConnection = useCallback(async (
    tempInstanceId: string,
    companyId: string,
    instanceName: string,
    phoneNumber?: string,
    profileName?: string
  ): Promise<CreateInstanceResponse> => {
    try {
      console.log('[useWhatsAppInstances] Confirming connection:', { tempInstanceId, instanceName });
      
      const { data, error } = await supabase.rpc('confirm_whatsapp_connection', {
        p_temp_instance_id: tempInstanceId,
        p_company_id: companyId,
        p_instance_name: instanceName,
        p_phone_number: phoneNumber,
        p_profile_name: profileName,
      });

      console.log('[useWhatsAppInstances] Confirm response:', { data, error });

      if (error) {
        console.error('[useWhatsAppInstances] Erro RPC confirm:', error);
        return {
          success: false,
          error: `RPC Error: ${error.message || JSON.stringify(error)}`,
        };
      }

      if (data?.success) {
        // Atualizar lista local
        await fetchInstances();
        
        return {
          success: true,
          instanceId: data.instanceId,
          message: data.message,
        };
      } else {
        return {
          success: false,
          error: data?.error || 'Erro ao confirmar conexão',
        };
      }
    } catch (err) {
      console.error('[useWhatsAppInstances] Erro ao confirmar conexão:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao confirmar conexão',
      };
    }
  }, [fetchInstances]);

  // =====================================================
  // VERIFICAR STATUS DE CONEXÃO
  // =====================================================
  const checkConnectionStatus = useCallback(async (tempInstanceId: string): Promise<{
    success: boolean;
    connected?: boolean;
    status?: string;
    message?: string;
    error?: string;
  }> => {
    try {
      const { data, error } = await supabase.rpc('check_whatsapp_connection_status', {
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
        error: err instanceof Error ? err.message : 'Erro ao verificar status',
      };
    }
  }, []);

  // =====================================================
  // VERIFICAR STATUS DE INSTÂNCIA TEMPORÁRIA (WEBHOOK)
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
  // MANTER COMPATIBILIDADE: createInstance (DEPRECATED)
  // =====================================================
  const createInstance = useCallback(async (name: string): Promise<CreateInstanceResponse> => {
    console.warn('[useWhatsAppInstances] createInstance is deprecated. Use generateQRCode + confirmConnection instead.');
    
    // Para compatibilidade, gerar QR Code
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

  // =====================================================
  // OBTER QR CODE (ANTI-CORS)
  // =====================================================
  const getQRCode = useCallback(async (instanceId: string): Promise<{
    success: boolean;
    data?: { qrcode: string; expires_at?: string };
    error?: string;
  }> => {
    try {
      console.log('[useWhatsAppInstances] Getting QR Code for:', instanceId);
      
      // ✅ ANTI-CORS: Chamar apenas RPC Function
      const { data, error } = await supabase.rpc('get_whatsapp_life_qrcode_rpc', {
        p_instance_id: instanceId,
      });

      console.log('[useWhatsAppInstances] RPC QR response:', { data, error });

      if (error) {
        console.error('[useWhatsAppInstances] Erro RPC QR:', error);
        return {
          success: false,
          error: `RPC Error: ${error.message || JSON.stringify(error)}`,
        };
      }

      if (data?.success) {
        return {
          success: true,
          data: data.data,
        };
      } else {
        return {
          success: false,
          error: data?.error || 'Erro ao obter QR Code',
        };
      }
    } catch (err) {
      console.error('[useWhatsAppInstances] Erro ao obter QR Code:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao obter QR Code',
      };
    }
  }, []);

  // =====================================================
  // GERAR QR CODE (NOVO FLUXO)
  // =====================================================
  const generateQRCode = useCallback(async (name: string): Promise<{
    success: boolean;
    data?: {
      temp_instance_id: string;
      qrcode: string;
      expires_at: string;
      instance_name: string;
      company_id: string;
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
      console.log('[useWhatsAppInstances] Generating QR Code for:', name);
      
      // USAR NOVA VERSÃO WEBHOOK 100% (mais rápida e confiável)
      const { data, error } = await supabase.rpc('generate_whatsapp_qr_code_webhook_100', {
        p_company_id: companyId,
        p_instance_name: name,
      });

      console.log('[useWhatsAppInstances] QR Code response (Webhook 100%):', { data, error });

      if (error) {
        console.error('[useWhatsAppInstances] Erro RPC:', error);
        
        // Fallback para versão original se nova falhar
        console.log('[useWhatsAppInstances] Tentando fallback para versão original...');
        const fallbackResult = await supabase.rpc('generate_whatsapp_qr_code_async', {
          p_company_id: companyId,
          p_instance_name: name,
        });
        
        if (fallbackResult.error) {
          return {
            success: false,
            error: `Erro em ambas as versões: ${error.message}`,
          };
        }
        
        return {
          success: fallbackResult.data?.success || false,
          data: fallbackResult.data?.data,
          error: fallbackResult.data?.error,
          planInfo: fallbackResult.data?.planInfo,
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
      console.error('[useWhatsAppInstances] Erro ao gerar QR Code:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao gerar QR Code',
      };
    }
  }, [companyId]);

  // =====================================================
  // ATUALIZAR INSTÂNCIA
  // =====================================================
  const updateInstance = useCallback(async (
    instanceId: string, 
    updates: Partial<WhatsAppLifeInstance>
  ): Promise<void> => {
    try {
      const response = await fetch(
        `${WHATSAPP_LIFE_CONSTANTS.API_ENDPOINTS.INSTANCES}?instance_id=${instanceId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao atualizar instância');
      }

      if (data.success && data.data) {
        // Atualizar lista local
        setInstances(prev => 
          prev.map(instance => 
            instance.id === instanceId ? data.data : instance
          )
        );
      }
    } catch (err) {
      console.error('[useWhatsAppInstances] Erro ao atualizar instância:', err);
      throw err;
    }
  }, []);

  // =====================================================
  // DELETAR INSTÂNCIA
  // =====================================================
  const deleteInstance = useCallback(async (instanceId: string): Promise<void> => {
    try {
      const response = await fetch(
        `${WHATSAPP_LIFE_CONSTANTS.API_ENDPOINTS.INSTANCES}?instance_id=${instanceId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao deletar instância');
      }

      if (data.success) {
        // Remover da lista local
        setInstances(prev => prev.filter(instance => instance.id !== instanceId));
      }
    } catch (err) {
      console.error('[useWhatsAppInstances] Erro ao deletar instância:', err);
      throw err;
    }
  }, []);

  // =====================================================
  // REFETCH (ALIAS PARA FETCH)
  // =====================================================
  const refetch = useCallback(async () => {
    await fetchInstances();
  }, [fetchInstances]);

  // =====================================================
  // EFFECT: CARREGAR INSTÂNCIAS
  // =====================================================
  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // =====================================================
  // EFFECT: POLLING PARA ATUALIZAR STATUS
  // =====================================================
  useEffect(() => {
    if (!companyId || instances.length === 0) return;

    // Verificar se há instâncias que precisam de monitoramento
    const needsMonitoring = instances.some(
      instance => instance.status === 'connecting' || instance.status === 'qr_pending'
    );

    if (!needsMonitoring) return;

    const interval = setInterval(() => {
      fetchInstances();
    }, WHATSAPP_LIFE_CONSTANTS.STATUS_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [companyId, instances, fetchInstances]);

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

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
  // GERAR QR CODE (NOVO FLUXO - NÃO CRIA INSTÂNCIA)
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
        error: 'ID da empresa não fornecido',
      };
    }

    if (!name.trim()) {
      return {
        success: false,
        error: 'Nome da instância é obrigatório',
      };
    }

    if (name.length > WHATSAPP_LIFE_CONSTANTS.MAX_INSTANCE_NAME_LENGTH) {
      return {
        success: false,
        error: `Nome deve ter no máximo ${WHATSAPP_LIFE_CONSTANTS.MAX_INSTANCE_NAME_LENGTH} caracteres`,
      };
    }

    try {
      console.log('[useWhatsAppInstances] Generating QR Code:', { companyId, name: name.trim() });
      
      // ✅ ANTI-CORS: Gerar QR Code sem criar instância
      const { data, error } = await supabase.rpc('generate_whatsapp_qr_code', {
        p_company_id: companyId,
        p_instance_name: name.trim(),
      });

      console.log('[useWhatsAppInstances] RPC QR response:', { data, error });

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
    getQRCode,
    deleteInstance,
    updateInstance,
  };
};

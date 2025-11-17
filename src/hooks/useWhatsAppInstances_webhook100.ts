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
      console.log('[useWhatsAppInstancesWebhook100] 🎯 VERSÃO DIRETA BASEADA NA REFERÊNCIA!');
      console.log('[useWhatsAppInstancesWebhook100] Generating QR Code for:', name);
      
      // USAR VERSÃO COM TIMEOUT DE 180 SEGUNDOS - QR CODE DIRETO NO MODAL
      const { data, error } = await supabase.rpc('generate_whatsapp_qr_code_180s_timeout', {
        p_company_id: companyId,
        p_instance_name: name,
      });

      console.log('[useWhatsAppInstancesWebhook100] QR Code response (180s Timeout):', { data, error });

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
  const getTempInstanceStatus = useCallback(async (tempInstanceId: string) => {
    console.log('[useWhatsAppInstancesWebhook100] Getting temp instance status:', tempInstanceId);
    
    try {
      // VERIFICAR STATUS DE CONEXÃO REAL
      const { data, error } = await supabase.rpc('check_instance_connection_status', {
        p_temp_instance_id: tempInstanceId,
      });

      console.log('[useWhatsAppInstancesWebhook100] Connection status response:', { data, error });

      if (error) {
        console.error('[useWhatsAppInstancesWebhook100] Erro ao verificar status:', error);
        return {
          success: false,
          error: `Erro ao verificar status: ${error.message}`,
        };
      }

      return {
        success: data?.success || false,
        data: data?.data || null,
        error: data?.error || null,
      };
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

  // deleteInstance implementado abaixo com funcionalidade real

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
  // =====================================================
  // SINCRONIZAR COM UAZAPI
  // =====================================================
  const syncWithUazapi = useCallback(async () => {
    if (!companyId) return { success: false, error: 'Company ID não disponível' };

    try {
      const { data, error } = await supabase.rpc('sync_instances_with_uazapi', {
        p_company_id: companyId,
      });

      if (error) {
        throw new Error(`Erro na sincronização: ${error.message}`);
      }

      // Recarregar instâncias após sincronização
      await fetchInstances();

      return { success: true, data };
    } catch (err) {
      console.error('[useWhatsAppInstancesWebhook100] Erro na sincronização:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro na sincronização',
      };
    }
  }, [companyId, fetchInstances]);

  // =====================================================
  // EXCLUIR INSTÂNCIA
  // =====================================================
  const deleteInstance = useCallback(async (instanceId: string) => {
    if (!companyId) return { success: false, error: 'Company ID não disponível' };

    try {
      const { data, error } = await supabase.rpc('delete_whatsapp_instance', {
        p_instance_id: instanceId,
        p_company_id: companyId,
      });

      if (error) {
        throw new Error(`Erro ao excluir: ${error.message}`);
      }

      // Recarregar instâncias após exclusão
      await fetchInstances();

      return { success: true, data };
    } catch (err) {
      console.error('[useWhatsAppInstancesWebhook100] Erro ao excluir:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao excluir instância',
      };
    }
  }, [companyId, fetchInstances]);

  // =====================================================
  // ALTERAR NOME DA INSTÂNCIA
  // =====================================================
  const updateInstanceName = useCallback(async (instanceId: string, newName: string) => {
    if (!companyId) return { success: false, error: 'Company ID não disponível' };

    try {
      const { data, error } = await supabase.rpc('update_instance_name', {
        p_instance_id: instanceId,
        p_company_id: companyId,
        p_new_name: newName,
      });

      if (error) {
        throw new Error(`Erro ao alterar nome: ${error.message}`);
      }

      // Recarregar instâncias após alteração
      await fetchInstances();

      return { success: true, data };
    } catch (err) {
      console.error('[useWhatsAppInstancesWebhook100] Erro ao alterar nome:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao alterar nome',
      };
    }
  }, [companyId, fetchInstances]);

  // =====================================================
  // NOVA FUNÇÃO: SINCRONIZAR DADOS DO PERFIL
  // =====================================================
  const syncProfileData = useCallback(async (instanceId: string) => {
    if (!companyId) {
      return { success: false, error: 'Company ID não disponível' };
    }

    try {
      console.log('[syncProfileData] Iniciando sincronização para instância:', instanceId);
      
      const { data, error } = await supabase.rpc('sync_instance_profile_data', {
        p_instance_id: instanceId,
        p_company_id: companyId
      });

      if (error) {
        console.error('[syncProfileData] Erro no RPC:', error);
        throw error;
      }

      console.log('[syncProfileData] Resultado:', data);

      // Recarregar lista após sincronização bem-sucedida
      if (data?.success) {
        await fetchInstances();
      }

      return data;
    } catch (error) {
      console.error('[syncProfileData] Erro ao sincronizar dados do perfil:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  }, [companyId, supabase, fetchInstances]);

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
    syncWithUazapi,
    updateInstanceName,
    fetchInstances,
    syncProfileData
  };
};

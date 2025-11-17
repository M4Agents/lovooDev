// =====================================================
// WHATSAPP LIFE MODULE - COMPONENTE PRINCIPAL
// =====================================================
// Módulo principal isolado para gerenciar instâncias WhatsApp

import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Smartphone, Crown } from 'lucide-react';
import { useWhatsAppInstancesWebhook100 } from '../../hooks/useWhatsAppInstances_webhook100';
import { usePlanLimits } from '../../hooks/usePlanLimits';
import { useCompany } from '../../hooks/useCompany';
import { AddInstanceModal } from './AddInstanceModal';
import { QRCodeModal } from './QRCodeModal';

// =====================================================
// COMPONENTE PRINCIPAL (VERSÃO FUNCIONAL)
// =====================================================
export const WhatsAppLifeModule: React.FC = () => {
  const { company } = useCompany();
  
  // Estados dos modais
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [currentInstanceId, setCurrentInstanceId] = useState<string>('');
  const [currentInstanceName, setCurrentInstanceName] = useState<string>('');
  
  // Debug: Log company data
  console.log('[WhatsAppLifeModule] Company:', company);
  console.log('[WhatsAppLifeModule] 🚀 USANDO WEBHOOK 100% - VERSÃO OTIMIZADA!');
  
  const { 
    loading: instancesLoading, 
    error: instancesError,
    generateQRCode,
    getTempInstanceStatus,
    // confirmConnection, // TODO: Usar quando implementar monitoramento
    // checkConnectionStatus, // TODO: Usar quando implementar monitoramento
    getQRCode
  } = useWhatsAppInstancesWebhook100(company?.id);
  
  const { 
    planLimits, 
    canAddInstance, 
    planConfig,
    loading: planLoading,
    error: planError
    // refetch: refetchPlan // TODO: Usar quando implementar atualização após conexão
  } = usePlanLimits(company?.id);

  // Debug: Log hook states
  console.log('[WhatsAppLifeModule] Plan Limits:', planLimits);
  console.log('[WhatsAppLifeModule] Plan Error:', planError);
  console.log('[WhatsAppLifeModule] Instances Error:', instancesError);

  const loading = instancesLoading || planLoading;

  // Handler para abrir modal de criação
  const handleOpenAddModal = () => {
    if (!company?.id) {
      alert('Erro: Dados da empresa não encontrados');
      return;
    }
    
    if (!canAddInstance) {
      alert('Erro: Limite de instâncias atingido para seu plano');
      return;
    }
    
    setShowAddModal(true);
  };

  // Handler para confirmar criação da instância (FLUXO WEBHOOK ASSÍNCRONO)
  const handleConfirmCreateInstance = async (instanceName: string) => {
    console.log('[WhatsAppLifeModule] Generating QR Code for:', instanceName);
    
    try {
      // FLUXO WEBHOOK: Gerar QR Code assíncrono
      const result = await generateQRCode(instanceName);
      console.log('[WhatsAppLifeModule] QR Code result:', result);
      
      if (result.success && result.data) {
        // Fechar modal de criação
        setShowAddModal(false);
        
        // Verificar se é modo assíncrono (webhook)
        if (result.data.async_mode) {
          console.log('[WhatsAppLifeModule] Modo assíncrono detectado, iniciando polling...');
          
          // Armazenar dados iniciais
          setQrCodeData({
            ...result.data,
            status: 'connecting',
            qrcode: null, // Será preenchido pelo polling
            message: 'Gerando QR Code... aguarde até 3 minutos'
          });
          
          // Abrir modal de QR Code
          setCurrentInstanceId(result.data.temp_instance_id);
          setCurrentInstanceName(instanceName);
          setShowQRModal(true);
          
          // Iniciar polling para verificar status
          startTempInstancePolling(result.data.temp_instance_id);
        } else {
          // Modo síncrono (fallback)
          setQrCodeData(result.data);
          setCurrentInstanceId(result.data.temp_instance_id);
          setCurrentInstanceName(instanceName);
          setShowQRModal(true);
        }
      } else {
        throw new Error(result.error || 'Erro ao gerar QR Code');
      }
    } catch (error) {
      console.error('[WhatsAppLifeModule] QR Code error:', error);
      throw error; // Repassar erro para o modal tratar
    }
  };

  // Estado para armazenar dados do QR Code gerado
  const [qrCodeData, setQrCodeData] = useState<any>(null);
  
  // Estado para controlar polling
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Função para iniciar polling de instância temporária
  const startTempInstancePolling = useCallback((tempInstanceId: string) => {
    console.log('[WhatsAppLifeModule] Iniciando polling para:', tempInstanceId);
    
    // Limpar polling anterior se existir
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    let attempts = 0;
    const maxAttempts = 90; // 3 minutos (90 * 2s = 180s)
    
    const interval = setInterval(async () => {
      attempts++;
      console.log(`[WhatsAppLifeModule] Polling attempt ${attempts}/${maxAttempts}`);
      
      try {
        const status = await getTempInstanceStatus(tempInstanceId);
        console.log('[WhatsAppLifeModule] Status response:', status);
        
        if (status.success && status.data) {
          const { qrcode, status: instanceStatus, error_message } = status.data;
          
          // Atualizar dados do QR Code
          setQrCodeData((prev: any) => ({
            ...prev,
            qrcode,
            status: instanceStatus,
            error_message,
            updated_at: status.data?.updated_at
          }));
          
          // Se QR Code está disponível ou houve erro, parar polling
          // INCLUIR TRATAMENTO PARA created_awaiting_connect
          if (qrcode || instanceStatus === 'ready' || instanceStatus === 'error' || instanceStatus === 'created_awaiting_connect' || error_message) {
            console.log('[WhatsAppLifeModule] Polling concluído:', { qrcode: !!qrcode, instanceStatus, error_message });
            clearInterval(interval);
            setPollingInterval(null);
          }
        }
        
        // Parar polling se atingir máximo de tentativas
        if (attempts >= maxAttempts) {
          console.log('[WhatsAppLifeModule] Polling timeout após', maxAttempts, 'tentativas');
          clearInterval(interval);
          setPollingInterval(null);
          
          // Atualizar com erro de timeout
          setQrCodeData((prev: any) => ({
            ...prev,
            error_message: 'Timeout: QR Code não foi gerado em 3 minutos',
            status: 'error'
          }));
        }
      } catch (error) {
        console.error('[WhatsAppLifeModule] Erro no polling:', error);
        
        // Em caso de erro, continuar tentando até o máximo
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setPollingInterval(null);
          
          setQrCodeData((prev: any) => ({
            ...prev,
            error_message: 'Erro ao verificar status da instância',
            status: 'error'
          }));
        }
      }
    }, 2000); // Poll a cada 2 segundos
    
    setPollingInterval(interval);
  }, [getTempInstanceStatus, pollingInterval]);

  // Limpar polling quando componente for desmontado
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Handler para QR Code personalizado (usa dados da geração)
  const handleGetQRCode = async (tempInstanceId: string) => {
    console.log('[WhatsAppLifeModule] Getting QR Code for temp instance:', tempInstanceId);
    
    // Se temos dados do QR Code armazenados, usar eles
    if (qrCodeData && qrCodeData.temp_instance_id === tempInstanceId) {
      return {
        success: true,
        data: {
          qrcode: qrCodeData.qrcode,
          expires_at: qrCodeData.expires_at,
          status: qrCodeData.status, // INCLUIR STATUS
        },
      };
    }
    
    // Para instâncias temporárias sem dados, gerar novamente
    if (tempInstanceId.includes('-')) {
      try {
        // Regenerar QR Code usando o nome da instância atual
        const result = await generateQRCode(currentInstanceName);
        if (result.success && result.data) {
          setQrCodeData(result.data);
          return {
            success: true,
            data: {
              qrcode: result.data.qrcode,
              expires_at: result.data.expires_at,
              status: result.data.status, // INCLUIR STATUS
            },
          };
        }
      } catch (error) {
        console.error('[WhatsAppLifeModule] Erro ao regenerar QR Code:', error);
      }
      
      // Fallback para QR Code de erro
      return {
        success: true,
        data: {
          qrcode: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZmZmNWY1Ii8+PHRleHQgeD0iNTAlIiB5PSI0MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMiIgZmlsbD0iI2Q5NTM0ZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm8gYW8gY2FycmVnYXIgUVIgQ29kZTwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjYwJSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEwIiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Q2xpcXVlIGVtIEF0dWFsaXphcjwvdGV4dD48L3N2Zz4=',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      };
    } else {
      // É uma instância real, usar método normal
      return await getQRCode(tempInstanceId);
    }
  };

  // =====================================================
  // RENDER PRINCIPAL
  // =====================================================
  return (
    <div className="space-y-6">
      {/* Debug Info */}
      {(planError || instancesError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium mb-2">🔍 Debug Info:</h3>
          {planError && <p className="text-red-700 text-sm">Plan Error: {planError}</p>}
          {instancesError && <p className="text-red-700 text-sm">Instances Error: {instancesError}</p>}
          <p className="text-red-700 text-sm">Company ID: {company?.id || 'undefined'}</p>
          <p className="text-red-700 text-sm">Company Name: {company?.name || 'undefined'}</p>
        </div>
      )}
      
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Smartphone className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">WhatsApp Business</h1>
              <p className="text-sm text-gray-600">
                Gerencie suas conexões WhatsApp
              </p>
            </div>
          </div>
          
          <button 
            onClick={handleOpenAddModal}
            disabled={!canAddInstance || loading}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Conectar WhatsApp
          </button>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">{planLimits.currentCount}</div>
            <div className="text-sm text-blue-700">Números Conectados</div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">{planLimits.remaining}</div>
            <div className="text-sm text-green-700">Disponíveis</div>
          </div>
          
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-600">{planLimits.maxAllowed}</div>
            <div className="text-sm text-purple-700">Limite do Plano</div>
          </div>
        </div>

        {/* Lista de Instâncias */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Instâncias WhatsApp</h3>
          
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Smartphone className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Nenhum WhatsApp conectado
              </h3>
              <p className="text-gray-600 mb-4">
                Conecte seu primeiro número WhatsApp para começar a usar o atendimento integrado
              </p>
              <button 
                onClick={handleOpenAddModal}
                disabled={!canAddInstance || loading}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Conectar Primeiro WhatsApp
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Informações do Plano */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Crown className="h-6 w-6 text-purple-600" />
          <div>
            <h3 className="text-lg font-medium text-gray-900">Plano Atual</h3>
            <p className="text-sm text-gray-600">Gerencie seu plano e limites</p>
          </div>
        </div>

        <div className="bg-purple-50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-purple-900">Plano {planConfig.planType}</div>
              <div className="text-sm text-purple-700">Até {planLimits.maxAllowed} números WhatsApp</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-purple-900">{planConfig.price}</div>
              <button className="text-sm text-purple-600 hover:text-purple-800">
                Fazer Upgrade
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modais */}
      <AddInstanceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onConfirm={handleConfirmCreateInstance}
        loading={instancesLoading}
        planLimits={planLimits}
      />

      <QRCodeModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        instanceId={currentInstanceId}
        instanceName={currentInstanceName}
        onGetQRCode={handleGetQRCode}
      />
    </div>
  );
};

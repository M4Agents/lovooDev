// =====================================================
// WHATSAPP LIFE MODULE - COMPONENTE PRINCIPAL
// =====================================================
// Módulo principal isolado para gerenciar instâncias WhatsApp

import React, { useState, useCallback, useEffect } from 'react';
import { Smartphone, Plus, Crown, CheckCircle, RefreshCw, Edit2, Trash2, User } from 'lucide-react';
import { useWhatsAppInstancesWebhook100 } from '../../hooks/useWhatsAppInstances_webhook100';
import { usePlanLimits } from '../../hooks/usePlanLimits';
import { useCompany } from '../../hooks/useCompany';
import { AddInstanceModal } from './AddInstanceModal';
import { QRCodeModal } from './QRCodeModal';
import { InstanceAvatar } from './InstanceAvatar';

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
    instances,
    loading: instancesLoading, 
    error: instancesError,
    generateQRCode,
    getTempInstanceStatus,
    getQRCode,
    syncWithUazapi,
    deleteInstance,
    updateInstanceName,
    fetchInstances,
    syncProfileData
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

  // Handler para confirmar criação da instância (MODAL IMEDIATO + LOADING)
  const handleConfirmCreateInstance = useCallback(async (name: string) => {
    if (!name.trim()) {
      return;
    }

    try {
      console.log('[WhatsAppLifeModule] Creating instance:', name);
      
      // ABRIR MODAL IMEDIATAMENTE COM LOADING
      setCurrentInstanceName(name);
      setShowQRModal(true);
      
      // Inicializar dados com loading
      setQrCodeData({
        temp_instance_id: 'loading',
        status: 'loading',
        message: 'Gerando QR Code...',
        qrcode: null,
        instance_name: name,
      });
      
      const result = await generateQRCode(name);
      console.log('[WhatsAppLifeModule] QR Code result:', result);

      if (result.success && result.data) {
        // Atualizar dados do QR Code
        setQrCodeData(result.data);
        setCurrentInstanceId(result.data.temp_instance_id);
        
        // Iniciar polling para detectar conexão
        if (result.data.temp_instance_id) {
          startTempInstancePolling(result.data.temp_instance_id);
        }
      } else {
        // Atualizar com erro
        setQrCodeData((prev: any) => ({
          ...prev,
          status: 'error',
          message: result.error || 'Erro ao gerar QR Code',
          error_message: result.error,
        }));
      }
    } catch (error) {
      console.error('[WhatsAppLifeModule] Erro ao criar instância:', error);
      setQrCodeData((prev: any) => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'Erro interno',
        error_message: error instanceof Error ? error.message : 'Erro interno',
      }));
    }
  }, [generateQRCode]);

  // Handlers para editar e excluir instâncias
  const handleEditInstance = useCallback(async (instance: any) => {
    const newName = prompt(`Alterar nome da instância "${instance.instance_name}":`, instance.instance_name);
    
    if (newName && newName.trim() && newName.trim() !== instance.instance_name) {
      try {
        const result = await updateInstanceName(instance.id, newName.trim());
        
        if (result.success) {
          alert(`Nome alterado com sucesso!\nDe: "${instance.instance_name}"\nPara: "${newName.trim()}"`);
        } else {
          alert(`Erro ao alterar nome: ${result.error}`);
        }
      } catch (error) {
        alert(`Erro ao alterar nome: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }
  }, [updateInstanceName]);

  const handleDeleteInstance = useCallback(async (instance: any) => {
    const confirmDelete = confirm(
      `Tem certeza que deseja excluir a instância "${instance.instance_name}"?\n\n` +
      `Esta ação irá remover a instância da aplicação e não poderá ser desfeita.\n\n` +
      `Confirmar exclusão?`
    );
    
    if (confirmDelete) {
      try {
        const result = await deleteInstance(instance.id);
        
        if (result.success) {
          alert(`Instância "${instance.instance_name}" excluída com sucesso!`);
        } else {
          alert(`Erro ao excluir instância: ${result.error}`);
        }
      } catch (error) {
        alert(`Erro ao excluir instância: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }
  }, [deleteInstance]);

  // =====================================================
  // HANDLER: SINCRONIZAR PERFIL DA INSTÂNCIA
  // =====================================================
  const handleSyncProfile = useCallback(async (instance: any) => {
    try {
      const result = await syncProfileData(instance.id);
      
      if (result.success) {
        alert(`Perfil da instância "${instance.instance_name}" sincronizado com sucesso!`);
      } else {
        alert(`Erro ao sincronizar perfil: ${result.error}`);
      }
    } catch (error) {
      alert(`Erro ao sincronizar perfil: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  }, [syncProfileData]);

  // Estado para armazenar dados do QR Code gerado
  const [qrCodeData, setQrCodeData] = useState<any>(null);
  
  // Estado para controlar polling
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  
  // Estados para modais de edição/exclusão
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<any>(null);

  // Função para iniciar polling de instância temporária
  const startTempInstancePolling = useCallback((tempInstanceId: string) => {
    console.log('[WhatsAppLifeModule] Iniciando polling para:', tempInstanceId);
    
    // Limpar polling anterior se existir
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    let attempts = 0;
    const maxAttempts = 12; // 3 minutos (12 * 15s = 180s)
    
    const interval = setInterval(async () => {
      attempts++;
      console.log(`[WhatsAppLifeModule] Polling attempt ${attempts}/${maxAttempts} (15s interval)`);
      
      try {
        const status = await getTempInstanceStatus(tempInstanceId);
        console.log('[WhatsAppLifeModule] Status response:', status);
        
        if (status.success && status.data) {
          const { 
            qrcode, 
            status: instanceStatus, 
            error_message,
            connected,
            logged_in,
            profile_name,
            phone_number,
            message
          } = status.data;
          
          // Atualizar dados do QR Code
          setQrCodeData((prev: any) => ({
            ...prev,
            qrcode,
            status: instanceStatus,
            error_message,
            connected,
            logged_in,
            profile_name,
            phone_number,
            message,
            updated_at: status.data?.updated_at
          }));
          
          // DETECTAR CONEXÃO AUTOMÁTICA
          if (connected && logged_in && instanceStatus === 'connected') {
            console.log('[WhatsAppLifeModule] 🎉 WhatsApp conectado com sucesso!', {
              profile_name,
              phone_number
            });
            
            // Parar polling - conexão estabelecida
            clearInterval(interval);
            setPollingInterval(null);
            
            // MOSTRAR MENSAGEM DE SUCESSO NO MODAL (NÃO FECHAR AINDA)
            setQrCodeData((prev: any) => ({
              ...prev,
              status: 'success',
              message: `WhatsApp conectado com sucesso! Perfil: ${profile_name || 'Conectado'}`,
              connected: true,
              logged_in: true,
              profile_name,
              phone_number
            }));
            
            // Fechar modal e recarregar após 3 segundos para usuário ver sucesso
            setTimeout(() => {
              setShowQRModal(false);
              window.location.reload(); // Recarregar para mostrar nova instância
            }, 3000);
            
            return;
          }
          
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
    }, 15000); // A cada 15 segundos (otimizado)
    
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
          ) : instances.length === 0 ? (
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
          ) : (
            <div className="space-y-4">
              {instances.map((instance) => (
                <div key={instance.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <InstanceAvatar
                        profilePictureUrl={instance.profile_picture_url}
                        profileName={instance.profile_name}
                        instanceName={instance.instance_name}
                        status={instance.status}
                        size="md"
                      />
                      <div>
                        <h4 className="font-medium text-gray-900">{instance.instance_name}</h4>
                        <p className="text-sm text-gray-600">
                          {instance.profile_name || 'Perfil não disponível'}
                        </p>
                        {instance.phone_number && (
                          <p className="text-xs text-gray-500">{instance.phone_number}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          instance.status === 'connected' ? 'bg-green-100 text-green-800' :
                          instance.status === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {instance.status === 'connected' ? 'Conectado' :
                           instance.status === 'connecting' ? 'Conectando' : 'Desconectado'}
                        </span>
                        {instance.connected_at && (
                          <p className="text-xs text-gray-500 mt-1">
                            Conectado em {(() => {
                              const date = new Date(instance.connected_at);
                              // Ajustar para horário de São Paulo (UTC-3)
                              const saoPauloTime = new Date(date.getTime() - (3 * 60 * 60 * 1000));
                              return saoPauloTime.toLocaleString('pt-BR', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              });
                            })()}
                          </p>
                        )}
                      </div>
                      
                      {/* Botões de Ação */}
                      <div className="flex gap-1 ml-2">
                        <button
                          onClick={() => handleSyncProfile(instance)}
                          className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
                          title="Sincronizar foto do perfil"
                        >
                          <User className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEditInstance(instance)}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                          title="Alterar nome"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteInstance(instance)}
                          className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                          title="Excluir instância"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
        qrCodeData={qrCodeData}
      />
    </div>
  );
};

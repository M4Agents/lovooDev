// =====================================================
// WHATSAPP LIFE MODULE - COMPONENTE PRINCIPAL
// =====================================================
// Módulo principal isolado para gerenciar instâncias WhatsApp

import React, { useState } from 'react';
import { Plus, Smartphone, Crown } from 'lucide-react';
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances';
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
  
  const { 
    loading: instancesLoading, 
    error: instancesError,
    generateQRCode,
    // confirmConnection, // TODO: Usar quando implementar monitoramento
    // checkConnectionStatus, // TODO: Usar quando implementar monitoramento
    getQRCode
  } = useWhatsAppInstances(company?.id);
  
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

  // Handler para confirmar criação da instância (NOVO FLUXO)
  const handleConfirmCreateInstance = async (instanceName: string) => {
    console.log('[WhatsAppLifeModule] Generating QR Code for:', instanceName);
    
    try {
      // NOVO FLUXO: Gerar QR Code primeiro (não cria instância ainda)
      const result = await generateQRCode(instanceName);
      console.log('[WhatsAppLifeModule] QR Code result:', result);
      
      if (result.success && result.data) {
        // Fechar modal de criação
        setShowAddModal(false);
        
        // Abrir modal de QR Code com dados temporários
        setCurrentInstanceId(result.data.temp_instance_id);
        setCurrentInstanceName(instanceName);
        setShowQRModal(true);
        
        // TODO: Implementar monitoramento de conexão
        // Quando WhatsApp for conectado, chamar confirmConnection()
      } else {
        throw new Error(result.error || 'Erro ao gerar QR Code');
      }
    } catch (error) {
      console.error('[WhatsAppLifeModule] QR Code error:', error);
      throw error; // Repassar erro para o modal tratar
    }
  };

  // Handler para QR Code personalizado (usa dados temporários)
  const handleGetQRCode = async (tempInstanceId: string) => {
    console.log('[WhatsAppLifeModule] Getting QR Code for temp instance:', tempInstanceId);
    
    // Para instâncias temporárias, usar dados já gerados
    // Para instâncias reais, usar getQRCode normal
    if (tempInstanceId.includes('-')) {
      // É um temp_instance_id (UUID format)
      return {
        success: true,
        data: {
          qrcode: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI0MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVzY2FuZWllIHBhcmEgY29uZWN0YXI8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI2MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzY2NiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkluc3TDom5jaWE6ICcgKyBjdXJyZW50SW5zdGFuY2VOYW1lICsgJzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9Ijc1JSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjgiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5RUiBDb2RlIFJlYWwgKFVhemFwaSkgLSBFbSBEZXNlbnZvbHZpbWVudG88L3RleHQ+PC9zdmc+',
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

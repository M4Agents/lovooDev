// =====================================================
// WHATSAPP LIFE MODULE - COMPONENTE PRINCIPAL
// =====================================================
// Módulo principal isolado para gerenciar instâncias WhatsApp

import React from 'react';
import { Plus, Smartphone, Crown } from 'lucide-react';
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances';
import { usePlanLimits } from '../../hooks/usePlanLimits';
import { useCompany } from '../../hooks/useCompany';

// =====================================================
// COMPONENTE PRINCIPAL (VERSÃO FUNCIONAL)
// =====================================================
export const WhatsAppLifeModule: React.FC = () => {
  const { company } = useCompany();
  
  // Debug: Log company data
  console.log('[WhatsAppLifeModule] Company:', company);
  
  const { 
    instances, 
    loading: instancesLoading, 
    error: instancesError,
    createInstance,
    refetch: refetchInstances 
  } = useWhatsAppInstances(company?.id);
  
  const { 
    planLimits, 
    canAddInstance, 
    planConfig,
    loading: planLoading,
    error: planError,
    refetch: refetchPlan
  } = usePlanLimits(company?.id);

  // Debug: Log hook states
  console.log('[WhatsAppLifeModule] Plan Limits:', planLimits);
  console.log('[WhatsAppLifeModule] Plan Error:', planError);
  console.log('[WhatsAppLifeModule] Instances Error:', instancesError);

  const loading = instancesLoading || planLoading;

  // Handler para criar instância
  const handleCreateInstance = async () => {
    console.log('[WhatsAppLifeModule] Creating instance...');
    console.log('[WhatsAppLifeModule] Can add:', canAddInstance);
    console.log('[WhatsAppLifeModule] Company ID:', company?.id);
    
    if (!company?.id) {
      alert('Erro: Dados da empresa não encontrados');
      return;
    }
    
    if (!canAddInstance) {
      alert('Erro: Limite de instâncias atingido ou dados não carregados');
      return;
    }
    
    try {
      const result = await createInstance('Meu WhatsApp');
      console.log('[WhatsAppLifeModule] Create result:', result);
      
      if (result.success) {
        refetchInstances();
        refetchPlan();
        alert('✅ Instância criada com sucesso!\n\nID: ' + result.instanceId);
      } else {
        const errorMsg = result.error || 'Erro desconhecido ao criar instância';
        console.error('[WhatsAppLifeModule] Create failed:', result);
        alert('❌ Falha ao criar instância:\n\n' + errorMsg + '\n\nVerifique o console para mais detalhes.');
      }
    } catch (error) {
      console.error('[WhatsAppLifeModule] Create error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('❌ Erro ao criar instância:\n\n' + errorMsg + '\n\nVerifique o console para mais detalhes.');
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
            onClick={handleCreateInstance}
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
                onClick={handleCreateInstance}
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
    </div>
  );
};

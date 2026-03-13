// =====================================================
// PAGE: AUTOMATIONS
// Data: 13/03/2026
// Objetivo: Página principal de automações (Flow Builder)
// =====================================================

import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { automationApi, statsApi } from '../services/automationApi'
import type { AutomationFlow, CreateFlowForm } from '../types/automation'
import { Plus, Zap, Activity, TrendingUp, AlertCircle } from 'lucide-react'
import CreateFlowModal from '../components/Automation/CreateFlowModal'

export default function Automations() {
  const { user } = useAuth()
  const [flows, setFlows] = useState<AutomationFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [stats, setStats] = useState({
    totalFlows: 0,
    activeFlows: 0,
    totalExecutions: 0,
    successRate: 0
  })

  useEffect(() => {
    loadFlows()
    loadStats()
  }, [user])

  const loadFlows = async () => {
    const companyId = (user as any)?.company?.id
    if (!companyId) return

    try {
      setLoading(true)
      const data = await automationApi.getFlows(companyId)
      setFlows(data)
      setError(null)
    } catch (err) {
      console.error('Erro ao carregar fluxos:', err)
      setError('Erro ao carregar fluxos de automação')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    const companyId = (user as any)?.company?.id
    if (!companyId) return

    try {
      const data = await statsApi.getCompanyStats(companyId)
      setStats(data)
    } catch (err) {
      console.error('Erro ao carregar estatísticas:', err)
    }
  }

  const handleCreateFlow = async (data: CreateFlowForm) => {
    const companyId = (user as any)?.company?.id
    if (!companyId) return

    try {
      await automationApi.createFlow(companyId, data)
      await loadFlows()
      await loadStats()
    } catch (err) {
      console.error('Erro ao criar fluxo:', err)
      throw err
    }
  }

  const handleToggleActive = async (flowId: string, currentStatus: boolean) => {
    try {
      await automationApi.toggleFlowActive(flowId, !currentStatus)
      await loadFlows()
      await loadStats()
    } catch (err) {
      console.error('Erro ao ativar/desativar fluxo:', err)
      alert('Erro ao alterar status do fluxo')
    }
  }

  const handleDeleteFlow = async (flowId: string, flowName: string) => {
    if (!confirm(`Tem certeza que deseja deletar o fluxo "${flowName}"?`)) return

    try {
      await automationApi.deleteFlow(flowId)
      await loadFlows()
      await loadStats()
    } catch (err) {
      console.error('Erro ao deletar fluxo:', err)
      alert('Erro ao deletar fluxo')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando automações...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Zap className="w-7 h-7 text-blue-600" />
                Automações
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Crie fluxos de automação para otimizar seu processo de vendas
              </p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <Plus className="w-5 h-5 mr-2" />
              Novo Fluxo
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Zap className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total de Fluxos</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.totalFlows}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Activity className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Fluxos Ativos</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.activeFlows}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Execuções</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {stats.totalExecutions.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <AlertCircle className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Taxa de Sucesso</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.successRate}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Flows List */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {flows.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Zap className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum fluxo criado</h3>
            <p className="mt-1 text-sm text-gray-500">
              Comece criando seu primeiro fluxo de automação.
            </p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                Criar Primeiro Fluxo
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {flows.map((flow) => (
                <li key={flow.id}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-medium text-gray-900 truncate">
                            {flow.name}
                          </h3>
                          {flow.is_active ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              Inativo
                            </span>
                          )}
                        </div>
                        {flow.description && (
                          <p className="mt-1 text-sm text-gray-500">{flow.description}</p>
                        )}
                        <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                          <span>Execuções: {flow.execution_count}</span>
                          <span>Sucesso: {flow.success_count}</span>
                          <span>Erros: {flow.error_count}</span>
                          {flow.last_executed_at && (
                            <span>
                              Última execução:{' '}
                              {new Date(flow.last_executed_at).toLocaleString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleToggleActive(flow.id, flow.is_active)}
                          className={`px-3 py-1 rounded text-sm font-medium ${
                            flow.is_active
                              ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                              : 'bg-green-100 text-green-800 hover:bg-green-200'
                          }`}
                        >
                          {flow.is_active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          onClick={() => console.log('Editar', flow.id)}
                          className="px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium hover:bg-blue-200"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteFlow(flow.id, flow.name)}
                          className="px-3 py-1 bg-red-100 text-red-800 rounded text-sm font-medium hover:bg-red-200"
                        >
                          Deletar
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Create Flow Modal */}
      <CreateFlowModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateFlow}
      />
    </div>
  )
}

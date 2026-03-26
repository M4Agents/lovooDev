import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Trash2, RefreshCw, AlertCircle, Clock, MessageSquare } from 'lucide-react'

interface DeletedInstance {
  id: string
  instance_name: string
  phone_number: string
  status: string
  deleted_at: string
  conversations_count: number
}

export const DeletedInstances: React.FC = () => {
  const { company } = useAuth()
  const [instances, setInstances] = useState<DeletedInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (company?.id) {
      fetchDeletedInstances()
    }
  }, [company?.id])

  const fetchDeletedInstances = async () => {
    if (!company?.id) return

    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase.rpc('get_deleted_instances', {
        p_company_id: company.id
      })

      if (error) throw error

      setInstances(data?.data || [])
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar instâncias deletadas')
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (instanceId: string) => {
    if (!company?.id) return

    setRestoring(instanceId)
    setError('')

    try {
      const { data, error } = await supabase.rpc('restore_whatsapp_instance', {
        p_instance_id: instanceId,
        p_company_id: company.id
      })

      if (error) throw error

      if (data?.success) {
        await fetchDeletedInstances()
      } else {
        throw new Error(data?.error || 'Erro ao restaurar instância')
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao restaurar instância')
    } finally {
      setRestoring(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Trash2 className="w-8 h-8 text-red-600" />
                Instâncias Deletadas
              </h1>
              <p className="mt-2 text-gray-600">
                Gerencie instâncias WhatsApp que foram deletadas (soft delete)
              </p>
            </div>
            <button
              onClick={fetchDeletedInstances}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800">Erro</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600"></div>
          </div>
        ) : instances.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="mx-auto h-16 w-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Trash2 className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Nenhuma instância deletada
            </h3>
            <p className="text-gray-600">
              Todas as suas instâncias WhatsApp estão ativas
            </p>
          </div>
        ) : (
          /* Instances List */
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Instância
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Telefone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Conversas
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deletada em
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {instances.map((instance) => (
                    <tr key={instance.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 bg-red-100 rounded-lg flex items-center justify-center">
                            <Trash2 className="w-5 h-5 text-red-600" />
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {instance.instance_name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {instance.phone_number || 'Sem telefone'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            {instance.conversations_count}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Clock className="w-4 h-4" />
                          {formatDate(instance.deleted_at)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Deletada
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleRestore(instance.id)}
                          disabled={restoring === instance.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-4 h-4 ${restoring === instance.id ? 'animate-spin' : ''}`} />
                          {restoring === instance.id ? 'Restaurando...' : 'Restaurar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-blue-800 mb-1">
                Sobre Instâncias Deletadas
              </h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Instâncias deletadas ficam ocultas mas podem ser restauradas</li>
                <li>• Todas as conversas são preservadas e continuam acessíveis</li>
                <li>• Ao restaurar, a instância volta como "desconectada"</li>
                <li>• Você precisará reconectar a instância após restaurar</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DeletedInstances

import React, { useState, useEffect } from 'react'
import { Shuffle, Users, Activity, MapPin, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface DistributionFormProps {
  config: any
  setConfig: (config: any) => void
}

const DISTRIBUTION_METHODS = [
  {
    id: 'round_robin',
    label: 'Rodízio (Round Robin)',
    description: 'Distribui leads alternando entre usuários em ordem sequencial',
    icon: <Shuffle className="w-5 h-5" />
  },
  {
    id: 'availability',
    label: 'Disponibilidade',
    description: 'Distribui apenas para usuários online/disponíveis',
    icon: <Activity className="w-5 h-5" />
  },
  {
    id: 'workload',
    label: 'Carga de Trabalho',
    description: 'Distribui para o usuário com menos leads ativos',
    icon: <Users className="w-5 h-5" />
  },
  {
    id: 'region',
    label: 'Por Região',
    description: 'Distribui baseado na região/localização do lead',
    icon: <MapPin className="w-5 h-5" />
  }
]

export function DistributionForm({ config, setConfig }: DistributionFormProps) {
  const { company } = useAuth()
  const [users, setUsers] = useState<any[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<string[]>(config.users || [])
  const [method, setMethod] = useState(config.method || 'round_robin')
  const [skipUnavailable, setSkipUnavailable] = useState(config.skip_unavailable ?? true)
  const [maxLeadsPerUser, setMaxLeadsPerUser] = useState(config.max_leads_per_user || '')
  const [checkOnlineStatus, setCheckOnlineStatus] = useState(config.check_online_status ?? true)
  const [regionMappings, setRegionMappings] = useState(config.region_mappings || [])
  const [defaultUserId, setDefaultUserId] = useState(config.default_user_id || '')

  useEffect(() => {
    if (company?.id) {
      loadUsers()
    }
  }, [company?.id])

  useEffect(() => {
    if (config.method) {
      setMethod(config.method)
      setSelectedUsers(config.users || [])
      setSkipUnavailable(config.skip_unavailable ?? true)
      setMaxLeadsPerUser(config.max_leads_per_user || '')
      setCheckOnlineStatus(config.check_online_status ?? true)
      setRegionMappings(config.region_mappings || [])
      setDefaultUserId(config.default_user_id || '')
    }
  }, [config])

  const loadUsers = async () => {
    setLoadingUsers(true)
    try {
      const { data } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('company_id', company?.id)
        .order('name')
      
      setUsers(data || [])
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    } finally {
      setLoadingUsers(false)
    }
  }

  const handleSave = () => {
    const newConfig: any = {
      method,
      users: selectedUsers,
      skip_unavailable: skipUnavailable,
      check_online_status: checkOnlineStatus
    }

    if (maxLeadsPerUser) {
      newConfig.max_leads_per_user = Number(maxLeadsPerUser)
    }

    if (method === 'region') {
      newConfig.region_mappings = regionMappings
      newConfig.default_user_id = defaultUserId
    }

    setConfig(newConfig)
  }

  const addRegionMapping = () => {
    setRegionMappings([...regionMappings, { region: '', user_id: '' }])
  }

  const removeRegionMapping = (index: number) => {
    setRegionMappings(regionMappings.filter((_: any, i: number) => i !== index))
  }

  const updateRegionMapping = (index: number, field: string, value: string) => {
    const updated = [...regionMappings]
    updated[index] = { ...updated[index], [field]: value }
    setRegionMappings(updated)
  }

  return (
    <div className="space-y-4">
      <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-cyan-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-cyan-800">
            <strong>Distribuição Automática</strong> permite dividir leads entre múltiplos usuários usando diferentes estratégias.
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Método de Distribuição
        </label>
        <div className="space-y-2">
          {DISTRIBUTION_METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                method === m.id
                  ? 'border-cyan-500 bg-cyan-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${method === m.id ? 'text-cyan-600' : 'text-gray-400'}`}>
                  {m.icon}
                </div>
                <div className="flex-1">
                  <div className={`font-medium ${method === m.id ? 'text-cyan-900' : 'text-gray-900'}`}>
                    {m.label}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {m.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Usuários para Distribuição
        </label>
        <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-300 rounded-md p-2">
          {loadingUsers ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Carregando usuários...
            </p>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Nenhum usuário encontrado
            </p>
          ) : (
            users.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
              >
                <input
                  type="checkbox"
                  checked={selectedUsers.includes(user.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedUsers([...selectedUsers, user.id])
                    } else {
                      setSelectedUsers(selectedUsers.filter(id => id !== user.id))
                    }
                  }}
                  className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{user.name}</div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                </div>
              </label>
            ))
          )}
        </div>
        {selectedUsers.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {selectedUsers.length} usuário{selectedUsers.length > 1 ? 's' : ''} selecionado{selectedUsers.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      {method === 'availability' && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={checkOnlineStatus}
              onChange={(e) => setCheckOnlineStatus(e.target.checked)}
              className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
            />
            <span className="text-sm text-gray-700">Verificar status online</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipUnavailable}
              onChange={(e) => setSkipUnavailable(e.target.checked)}
              className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
            />
            <span className="text-sm text-gray-700">Pular usuários indisponíveis</span>
          </label>
        </div>
      )}

      {method === 'workload' && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Máximo de leads por usuário (opcional)
            </label>
            <input
              type="number"
              value={maxLeadsPerUser}
              onChange={(e) => setMaxLeadsPerUser(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
              placeholder="Ex: 50"
              min="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Deixe vazio para sem limite
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipUnavailable}
              onChange={(e) => setSkipUnavailable(e.target.checked)}
              className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
            />
            <span className="text-sm text-gray-700">Pular usuários que atingiram o limite</span>
          </label>
        </div>
      )}

      {method === 'region' && (
        <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mapeamento de Regiões
            </label>
            <div className="space-y-2">
              {regionMappings.map((mapping: any, index: number) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={mapping.region}
                    onChange={(e) => updateRegionMapping(index, 'region', e.target.value)}
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
                    placeholder="Ex: São Paulo"
                  />
                  <select
                    value={mapping.user_id}
                    onChange={(e) => updateRegionMapping(index, 'user_id', e.target.value)}
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
                  >
                    <option value="">Selecione usuário...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeRegionMapping(index)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={addRegionMapping}
                className="w-full px-4 py-2 text-sm text-cyan-600 border border-cyan-300 rounded-md hover:bg-cyan-50"
              >
                + Adicionar Região
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Usuário Padrão (fallback)
            </label>
            <select
              value={defaultUserId}
              onChange={(e) => setDefaultUserId(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
            >
              <option value="">Nenhum (não distribuir)</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Usado quando a região do lead não está mapeada
            </p>
          </div>
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div className="text-xs font-medium text-gray-500 mb-1">Preview:</div>
        <div className="text-sm text-gray-900">
          {method === 'round_robin' && `Rodízio entre ${selectedUsers.length} usuário${selectedUsers.length > 1 ? 's' : ''}`}
          {method === 'availability' && `Distribuir para usuários disponíveis (${selectedUsers.length} no pool)`}
          {method === 'workload' && `Distribuir para usuário com menos leads${maxLeadsPerUser ? ` (máx: ${maxLeadsPerUser})` : ''}`}
          {method === 'region' && `Distribuir por região (${regionMappings.length} região${regionMappings.length !== 1 ? 'ões' : ''} mapeada${regionMappings.length !== 1 ? 's' : ''})`}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={selectedUsers.length === 0}
        className="w-full px-4 py-2 bg-cyan-500 text-white rounded-md hover:bg-cyan-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        Aplicar Configuração
      </button>
    </div>
  )
}

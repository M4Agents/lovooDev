// =====================================================
// COMPONENT: NODE CONFIG PANEL
// Data: 13/03/2026
// Objetivo: Painel lateral para configurar blocos selecionados
// =====================================================

import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import { Node } from 'reactflow'
import { useAuth } from '../../contexts/AuthContext'
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances'
import { supabase } from '../../lib/supabase'

interface NodeConfigPanelProps {
  selectedNode: Node | null
  onClose: () => void
  onSave: (nodeId: string, config: any) => void
}

export default function NodeConfigPanel({ selectedNode, onClose, onSave }: NodeConfigPanelProps) {
  const [config, setConfig] = useState<any>({})
  const { company } = useAuth()
  const { instances, loading: loadingInstances } = useWhatsAppInstances(company?.id)
  
  const [tags, setTags] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [funnels, setFunnels] = useState<any[]>([])
  const [stages, setStages] = useState<any[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingFunnels, setLoadingFunnels] = useState(false)
  const [loadingStages, setLoadingStages] = useState(false)

  useEffect(() => {
    if (selectedNode) {
      setConfig(selectedNode.data.config || {})
    }
  }, [selectedNode])

  useEffect(() => {
    const actionType = selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && 
        (actionType === 'add_tag' || actionType === 'remove_tag')) {
      loadTags()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, company?.id])

  useEffect(() => {
    const actionType = selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && actionType === 'assign_owner') {
      loadUsers()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, company?.id])

  useEffect(() => {
    const actionType = selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && actionType === 'move_opportunity') {
      loadFunnels()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, company?.id])

  useEffect(() => {
    if (config.funnelId) {
      loadStages(config.funnelId)
    }
  }, [config.funnelId])

  const loadTags = async () => {
    console.log('🏷️ [loadTags] Iniciando carregamento de tags...')
    console.log('🏷️ [loadTags] Company ID:', company?.id)
    setLoadingTags(true)
    try {
      const { data, error } = await supabase
        .from('tags')
        .select('id, name, color')
        .eq('company_id', company?.id)
        .order('name')
      
      console.log('🏷️ [loadTags] Resposta Supabase:', { data, error, count: data?.length })
      
      if (error) {
        console.error('❌ [loadTags] Erro do Supabase:', error)
      }
      
      setTags(data || [])
      console.log('🏷️ [loadTags] Tags setadas no estado:', data?.length || 0)
    } catch (error) {
      console.error('❌ [loadTags] Erro ao carregar tags:', error)
    } finally {
      setLoadingTags(false)
    }
  }

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

  const loadFunnels = async () => {
    setLoadingFunnels(true)
    try {
      const { data } = await supabase
        .from('sales_funnels')
        .select('id, name')
        .eq('company_id', company?.id)
        .eq('is_active', true)
        .order('name')
      setFunnels(data || [])
    } catch (error) {
      console.error('Erro ao carregar funis:', error)
    } finally {
      setLoadingFunnels(false)
    }
  }

  const loadStages = async (funnelId: string) => {
    setLoadingStages(true)
    try {
      const { data } = await supabase
        .from('funnel_stages')
        .select('id, name, order_index')
        .eq('funnel_id', funnelId)
        .order('order_index')
      setStages(data || [])
    } catch (error) {
      console.error('Erro ao carregar etapas:', error)
    } finally {
      setLoadingStages(false)
    }
  }

  if (!selectedNode) return null

  const handleSave = () => {
    onSave(selectedNode.id, config)
    onClose()
  }

  const renderConfigFields = () => {
    switch (selectedNode.type) {
      case 'trigger':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de Gatilho
              </label>
              <select
                value={config.triggerType || 'lead.created'}
                onChange={(e) => setConfig({ ...config, triggerType: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="lead.created">Novo Lead Criado</option>
                <option value="message.received">Mensagem Recebida</option>
                <option value="opportunity.created">Oportunidade Criada</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Descrição
              </label>
              <textarea
                value={config.description || ''}
                onChange={(e) => setConfig({ ...config, description: e.target.value })}
                rows={3}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Descreva quando este gatilho deve disparar..."
              />
            </div>
          </div>
        )

      case 'action':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de Ação
              </label>
              <select
                value={config.actionType || 'create_opportunity'}
                onChange={(e) => setConfig({ ...config, actionType: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="create_opportunity">Criar Oportunidade</option>
                <option value="update_lead">Atualizar Lead</option>
                <option value="add_tag">Adicionar Tag</option>
                <option value="remove_tag">Remover Tag</option>
                <option value="assign_owner">Atribuir Responsável</option>
                <option value="move_opportunity">Mover Oportunidade de Etapa</option>
                <option value="win_opportunity">Ganhar Oportunidade</option>
                <option value="lose_opportunity">Perder Oportunidade</option>
              </select>
            </div>

            {/* ADICIONAR TAG */}
            {config.actionType === 'add_tag' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Selecionar Tag Existente
                  </label>
                  {loadingTags ? (
                    <div className="text-sm text-gray-500">Carregando tags...</div>
                  ) : (
                    <select
                      value={config.tagId || ''}
                      onChange={(e) => setConfig({ ...config, tagId: e.target.value, newTagName: '' })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">-- Selecione uma tag --</option>
                      {tags.map(tag => (
                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="text-center text-gray-500 text-sm">ou</div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Criar Nova Tag
                  </label>
                  <input
                    type="text"
                    value={config.newTagName || ''}
                    onChange={(e) => setConfig({ ...config, newTagName: e.target.value, tagId: '' })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Nome da nova tag"
                  />
                </div>
                {config.newTagName && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cor da Tag
                    </label>
                    <input
                      type="color"
                      value={config.tagColor || '#3B82F6'}
                      onChange={(e) => setConfig({ ...config, tagColor: e.target.value })}
                      className="w-full h-10 rounded-md border-gray-300 shadow-sm"
                    />
                  </div>
                )}
              </>
            )}

            {/* REMOVER TAG */}
            {config.actionType === 'remove_tag' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selecionar Tag para Remover
                </label>
                {loadingTags ? (
                  <div className="text-sm text-gray-500">Carregando tags...</div>
                ) : (
                  <select
                    value={config.tagId || ''}
                    onChange={(e) => setConfig({ ...config, tagId: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">-- Selecione uma tag --</option>
                    {tags.map(tag => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* ATRIBUIR RESPONSÁVEL */}
            {config.actionType === 'assign_owner' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Responsável
                </label>
                {loadingUsers ? (
                  <div className="text-sm text-gray-500">Carregando usuários...</div>
                ) : (
                  <select
                    value={config.userId || ''}
                    onChange={(e) => setConfig({ ...config, userId: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">-- Selecione um usuário --</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* MOVER OPORTUNIDADE */}
            {config.actionType === 'move_opportunity' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Funil de Destino
                  </label>
                  {loadingFunnels ? (
                    <div className="text-sm text-gray-500">Carregando funis...</div>
                  ) : (
                    <select
                      value={config.funnelId || ''}
                      onChange={(e) => setConfig({ ...config, funnelId: e.target.value, stageId: '' })}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">-- Selecione um funil --</option>
                      {funnels.map(funnel => (
                        <option key={funnel.id} value={funnel.id}>{funnel.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {config.funnelId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Etapa de Destino
                    </label>
                    {loadingStages ? (
                      <div className="text-sm text-gray-500">Carregando etapas...</div>
                    ) : (
                      <select
                        value={config.stageId || ''}
                        onChange={(e) => setConfig({ ...config, stageId: e.target.value })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="">-- Selecione uma etapa --</option>
                        {stages.map(stage => (
                          <option key={stage.id} value={stage.id}>{stage.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </>
            )}

            {/* GANHAR OPORTUNIDADE */}
            {config.actionType === 'win_opportunity' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valor Final (opcional)
                  </label>
                  <input
                    type="number"
                    value={config.finalValue || ''}
                    onChange={(e) => setConfig({ ...config, finalValue: parseFloat(e.target.value) })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="R$ 0,00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Observações
                  </label>
                  <textarea
                    value={config.notes || ''}
                    onChange={(e) => setConfig({ ...config, notes: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Observações sobre o fechamento..."
                  />
                </div>
              </>
            )}

            {/* PERDER OPORTUNIDADE */}
            {config.actionType === 'lose_opportunity' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Motivo da Perda
                  </label>
                  <select
                    value={config.lossReason || ''}
                    onChange={(e) => setConfig({ ...config, lossReason: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">-- Selecione um motivo --</option>
                    <option value="Preço alto">Preço alto</option>
                    <option value="Concorrência">Concorrência</option>
                    <option value="Sem interesse">Sem interesse</option>
                    <option value="Sem orçamento">Sem orçamento</option>
                    <option value="Timing inadequado">Timing inadequado</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Observações
                  </label>
                  <textarea
                    value={config.notes || ''}
                    onChange={(e) => setConfig({ ...config, notes: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Detalhes sobre a perda..."
                  />
                </div>
              </>
            )}

            {/* DESCRIÇÃO GENÉRICA para outras ações */}
            {!['add_tag', 'remove_tag', 'assign_owner', 'move_opportunity', 'win_opportunity', 'lose_opportunity'].includes(config.actionType) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Descrição
                </label>
                <textarea
                  value={config.description || ''}
                  onChange={(e) => setConfig({ ...config, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Descreva o que esta ação fará..."
                />
              </div>
            )}
          </div>
        )

      case 'message':
        return (
          <div className="space-y-4">
            {/* Seleção de Instância WhatsApp */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instância WhatsApp *
              </label>
              {loadingInstances ? (
                <div className="text-sm text-gray-500">Carregando instâncias...</div>
              ) : instances.length === 0 ? (
                <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
                  ⚠️ Nenhuma instância WhatsApp conectada. Configure uma instância primeiro.
                </div>
              ) : (
                <select
                  value={config.instanceId || ''}
                  onChange={(e) => {
                    const selectedInstance = instances.find(inst => inst.id === e.target.value)
                    setConfig({ 
                      ...config, 
                      instanceId: e.target.value,
                      instanceName: selectedInstance?.instance_name || ''
                    })
                  }}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                  required
                >
                  <option value="">Selecione uma instância</option>
                  {instances
                    .filter(inst => inst.status === 'connected')
                    .map(inst => (
                      <option key={inst.id} value={inst.id}>
                        📱 {inst.instance_name} {inst.phone_number ? `(${inst.phone_number})` : ''}
                      </option>
                    ))}
                </select>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mensagem
              </label>
              <textarea
                value={config.message || ''}
                onChange={(e) => setConfig({ ...config, message: e.target.value })}
                rows={4}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Digite a mensagem que será enviada..."
              />
            </div>
            
            {/* Botões */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Botões de Resposta
              </label>
              <div className="space-y-2">
                {(config.buttons || []).map((button: any, index: number) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={button.text || ''}
                      onChange={(e) => {
                        const newButtons = [...(config.buttons || [])]
                        newButtons[index] = { ...button, text: e.target.value }
                        setConfig({ ...config, buttons: newButtons })
                      }}
                      className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder={`Botão ${index + 1}`}
                    />
                    <button
                      onClick={() => {
                        const newButtons = (config.buttons || []).filter((_: any, i: number) => i !== index)
                        setConfig({ ...config, buttons: newButtons })
                      }}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newButtons = [...(config.buttons || []), { text: '' }]
                    setConfig({ ...config, buttons: newButtons })
                  }}
                  className="w-full px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50"
                >
                  + Adicionar Botão
                </button>
              </div>
            </div>
            
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.useVariables || false}
                  onChange={(e) => setConfig({ ...config, useVariables: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Usar variáveis (ex: {'{nome}'})</span>
              </label>
            </div>
          </div>
        )

      case 'condition':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Campo a Verificar
              </label>
              <input
                type="text"
                value={config.field || ''}
                onChange={(e) => setConfig({ ...config, field: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Ex: nome, email, telefone"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Operador
              </label>
              <select
                value={config.operator || 'equals'}
                onChange={(e) => setConfig({ ...config, operator: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="equals">Igual a</option>
                <option value="not_equals">Diferente de</option>
                <option value="contains">Contém</option>
                <option value="not_contains">Não contém</option>
                <option value="is_empty">Está vazio</option>
                <option value="is_not_empty">Não está vazio</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valor
              </label>
              <input
                type="text"
                value={config.value || ''}
                onChange={(e) => setConfig({ ...config, value: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Valor para comparação"
              />
            </div>
          </div>
        )

      case 'delay':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Duração
              </label>
              <input
                type="number"
                value={config.duration || 1}
                onChange={(e) => setConfig({ ...config, duration: parseInt(e.target.value) })}
                min="1"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Unidade
              </label>
              <select
                value={config.unit || 'minutes'}
                onChange={(e) => setConfig({ ...config, unit: e.target.value })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="minutes">Minutos</option>
                <option value="hours">Horas</option>
                <option value="days">Dias</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.businessHoursOnly || false}
                  onChange={(e) => setConfig({ ...config, businessHoursOnly: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Apenas em horário comercial</span>
              </label>
            </div>
          </div>
        )

      default:
        return (
          <div className="text-sm text-gray-500">
            Nenhuma configuração disponível para este tipo de bloco.
          </div>
        )
    }
  }

  return (
    <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
        <h3 className="text-lg font-semibold text-gray-900">Configurar Bloco</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4">
        <div className="mb-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Tipo</div>
          <div className="text-lg font-semibold text-gray-900 capitalize">
            {selectedNode.type}
          </div>
          <div className="text-sm text-gray-600 mt-1">{selectedNode.data.label}</div>
        </div>

        {renderConfigFields()}

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Save className="w-4 h-4 mr-2" />
            Salvar
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

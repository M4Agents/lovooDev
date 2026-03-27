// =====================================================
// COMPONENT: NODE CONFIG PANEL
// Data: 13/03/2026
// Objetivo: Painel lateral para configurar blocos selecionados
// =====================================================
import { TriggerAutomationForm } from './TriggerAutomationForm'
import { NotificationForm } from './NotificationForm'
import { ConditionForm } from './ConditionForm'
import { DistributionForm } from './DistributionForm'
import { useState, useEffect } from 'react'
import { X, Save, ArrowLeft } from 'lucide-react'
import { Node } from 'reactflow'
import { useAuth } from '../../contexts/AuthContext'
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances'
import { supabase } from '../../lib/supabase'
import ActionTypeSelector, { ACTION_TYPES } from './ActionTypeSelector'
import { CreateActivityForm, UpdateActivityForm, CompleteActivityForm, CancelActivityForm, RescheduleActivityForm } from './ActivityForms'

interface NodeConfigPanelProps {
  selectedNode: Node | null
  flowId?: string
  nodes?: Node[]  // Para detectar instanceId do trigger
  onClose: () => void
  onSave: (nodeId: string, config: any) => void
}

export default function NodeConfigPanel({ selectedNode, flowId, nodes, onClose, onSave }: NodeConfigPanelProps) {
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
  const [customFields, setCustomFields] = useState<any[]>([])
  const [flows, setFlows] = useState<any[]>([])
  const [loadingCustomFields, setLoadingCustomFields] = useState(false)

  useEffect(() => {
    if (selectedNode) {
      const loadedConfig = selectedNode.data.config || {}
      console.log('🔍 [NodeConfigPanel useEffect] Carregando config:', {
        nodeId: selectedNode.id,
        nodeType: selectedNode.type,
        config: loadedConfig,
        hasActionType: !!loadedConfig.actionType,
        actionType: loadedConfig.actionType
      })
      setConfig(loadedConfig)
    }
  }, [selectedNode])

  useEffect(() => {
    const actionType = config.actionType || selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && 
        (actionType === 'add_tag' || actionType === 'remove_tag')) {
      loadTags()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, config.actionType, company?.id])

  useEffect(() => {
    const actionType = config.actionType || selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && actionType === 'assign_owner') {
      loadUsers()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, config.actionType, company?.id])

  useEffect(() => {
    const actionType = config.actionType || selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && (actionType === 'move_opportunity' || actionType === 'create_opportunity')) {
      loadFunnels()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, config.actionType, company?.id])

  useEffect(() => {
    if (config.actionType === 'trigger_automation' && company?.id) {
      loadFlows()
    }
  }, [config.actionType, company?.id])

  useEffect(() => {
    if (config.funnelId) {
      loadStages(config.funnelId)
    }
  }, [config.funnelId])

  useEffect(() => {
    const actionType = config.actionType || selectedNode?.data?.config?.actionType
    
    if (selectedNode?.type === 'action' && company?.id && actionType === 'set_custom_field') {
      loadCustomFields()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, config.actionType, company?.id])

  const loadTags = async () => {
    setLoadingTags(true)
    try {
      const { data, error } = await supabase
        .from('lead_tags')
        .select('id, name, color')
        .eq('company_id', company?.id)
        .eq('is_active', true)
        .order('name')
      
      if (error) {
        console.error('Erro ao carregar tags:', error)
      }
      
      setTags(data || [])
    } catch (error) {
      console.error('Erro ao carregar tags:', error)
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
        .select('id, name, position')
        .eq('funnel_id', funnelId)
        .order('position')
      setStages(data || [])
    } catch (error) {
      console.error('Erro ao carregar etapas:', error)
    } finally {
      setLoadingStages(false)
    }
  }

  const loadFlows = async () => {
    if (!company?.id) {
      console.log('⚠️ loadFlows: company.id não disponível')
      return
    }
    
    console.log('🔄 loadFlows: Carregando automações para company:', company.id)
    
    try {
      const { data, error } = await supabase.from('automation_flows').select('*').eq('company_id', company.id)
      
      if (error) {
        console.error('❌ loadFlows: Erro ao carregar:', error)
        return
      }
      
      console.log('✅ loadFlows: Carregadas', data?.length || 0, 'automações:', data)
      setFlows(data || [])
    } catch (error) {
      console.error('❌ loadFlows: Exceção:', error)
    }
  }

  const loadCustomFields = async () => {
    setLoadingCustomFields(true)
    try {
      const { data } = await supabase.from('lead_custom_fields').select('*').eq('company_id', company?.id)
      setCustomFields(data || [])
    } catch (error) {
      console.error('Erro:', error)
    } finally {
      setLoadingCustomFields(false)
    }
  }

  if (!selectedNode) return null

  const handleSave = () => {
    console.log('🔍 [NodeConfigPanel handleSave] INÍCIO:', {
      nodeId: selectedNode.id,
      nodeType: selectedNode.type,
      config: config,
      hasActionType: !!config.actionType
    })
    
    // ✅ Validação: Bloco de ação DEVE ter actionType
    if (selectedNode.type === 'action' && !config.actionType) {
      console.log('❌ [NodeConfigPanel handleSave] ERRO: actionType não existe!')
      alert('⚠️ Por favor, selecione um tipo de ação antes de salvar.')
      return
    }
    
    console.log('💾 [NodeConfigPanel handleSave] Chamando onSave:', {
      nodeId: selectedNode.id,
      config: config
    })
    
    onSave(selectedNode.id, config)
    
    console.log('✅ [NodeConfigPanel handleSave] onSave chamado, fechando modal')
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
            {!config.actionType ? (
              <>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Ações</h3>
                  <p className="text-sm text-gray-500 mt-1">Escolha uma ação para executar no lead</p>
                </div>
                <ActionTypeSelector 
                  onSelectType={(type) => setConfig({ ...config, actionType: type })} 
                />
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {ACTION_TYPES.find(t => t.id === config.actionType)?.label || 'Ação'}
                  </h3>
                  <button
                    onClick={() => setConfig({ ...config, actionType: undefined })}
                    className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar
                  </button>
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

            {/* DISTRIBUIR LEAD */}
            {config.actionType === 'distribute_lead' && (
              <DistributionForm config={config} setConfig={setConfig} />
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

                {/* CRIAR OPORTUNIDADE */}
                {config.actionType === 'create_opportunity' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Funil *
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
                          Etapa Inicial *
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Título da Oportunidade (opcional)
                      </label>
                      <input
                        type="text"
                        value={config.title || ''}
                        onChange={(e) => setConfig({ ...config, title: e.target.value })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="Ex: Proposta Comercial - {lead.name}"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Valor Estimado (opcional)
                      </label>
                      <input
                        type="number"
                        value={config.value || ''}
                        onChange={(e) => setConfig({ ...config, value: parseFloat(e.target.value) })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="R$ 0,00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Probabilidade % (opcional)
                      </label>
                      <input
                        type="number"
                        value={config.probability || ''}
                        onChange={(e) => setConfig({ ...config, probability: parseInt(e.target.value) })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="0-100"
                        min="0"
                        max="100"
                      />
                    </div>
                  </>
                )}

                {/* ATUALIZAR LEAD */}
                {config.actionType === 'update_lead' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Nome
                      </label>
                      <input
                        type="text"
                        value={config.fields?.name || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, name: e.target.value }
                        })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="Nome do lead"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        E-mail
                      </label>
                      <input
                        type="email"
                        value={config.fields?.email || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, email: e.target.value }
                        })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="email@exemplo.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Telefone
                      </label>
                      <input
                        type="tel"
                        value={config.fields?.phone || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, phone: e.target.value }
                        })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="(11) 99999-9999"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Empresa
                      </label>
                      <input
                        type="text"
                        value={config.fields?.company || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, company: e.target.value }
                        })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="Nome da empresa"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Cargo
                      </label>
                      <input
                        type="text"
                        value={config.fields?.position || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, position: e.target.value }
                        })}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="Cargo do lead"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Observações
                      </label>
                      <textarea
                        value={config.fields?.notes || ''}
                        onChange={(e) => setConfig({ 
                          ...config, 
                          fields: { ...config.fields, notes: e.target.value }
                        })}
                        rows={3}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="Observações sobre o lead..."
                      />
                    </div>
                  </>
                )}

                {/* DEFINIR CAMPO PERSONALIZADO */}
                {config.actionType === 'set_custom_field' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Campo Personalizado *
                      </label>
                      {loadingCustomFields ? (
                        <div className="text-sm text-gray-500">Carregando campos...</div>
                      ) : (
                        <select
                          value={config.customFieldId || ''}
                          onChange={(e) => {
                            const field = customFields.find(f => f.id === e.target.value)
                            setConfig({ 
                              ...config, 
                              customFieldId: e.target.value,
                              customFieldType: field?.field_type,
                              customFieldOptions: field?.options,
                              customFieldValue: ''
                            })
                          }}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">-- Selecione um campo --</option>
                          {customFields.map(field => (
                            <option key={field.id} value={field.id}>
                              {field.field_label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {config.customFieldId && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Valor *
                        </label>
                        {config.customFieldType === 'text' && (
                          <input
                            type="text"
                            value={config.customFieldValue || ''}
                            onChange={(e) => setConfig({ ...config, customFieldValue: e.target.value })}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="Digite o valor..."
                          />
                        )}
                        {config.customFieldType === 'number' && (
                          <input
                            type="number"
                            value={config.customFieldValue || ''}
                            onChange={(e) => setConfig({ ...config, customFieldValue: e.target.value })}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            placeholder="Digite o número..."
                          />
                        )}
                        {config.customFieldType === 'date' && (
                          <input
                            type="date"
                            value={config.customFieldValue || ''}
                            onChange={(e) => setConfig({ ...config, customFieldValue: e.target.value })}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          />
                        )}
                        {config.customFieldType === 'boolean' && (
                          <select
                            value={config.customFieldValue || ''}
                            onChange={(e) => setConfig({ ...config, customFieldValue: e.target.value })}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          >
                            <option value="">-- Selecione --</option>
                            <option value="true">Sim</option>
                            <option value="false">Não</option>
                          </select>
                        )}
                        {config.customFieldType === 'select' && (
                          <select
                            value={config.customFieldValue || ''}
                            onChange={(e) => setConfig({ ...config, customFieldValue: e.target.value })}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          >
                            <option value="">-- Selecione uma opção --</option>
                            {config.customFieldOptions?.map((opt: string, idx: number) => (
                              <option key={idx} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* DISPARAR WEBHOOK */}
                {config.actionType === 'send_webhook' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        URL do Webhook *
                      </label>
                      <input
                        type="url"
                        value={config.webhookUrl || ''}
                        onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                        placeholder="https://api.exemplo.com/webhook"
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Token de Autenticação (opcional)
                      </label>
                      <input
                        type="password"
                        value={config.authToken || ''}
                        onChange={(e) => setConfig({ ...config, authToken: e.target.value })}
                        placeholder="Bearer token123"
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Será enviado no header Authorization
                      </p>
                    </div>
                  </>
                )}

                {config.actionType === 'create_activity' && <CreateActivityForm config={config} setConfig={setConfig} />}
                {config.actionType === 'update_activity' && <UpdateActivityForm config={config} setConfig={setConfig} />}
                {config.actionType === 'complete_activity' && <CompleteActivityForm config={config} setConfig={setConfig} />}
                {config.actionType === 'cancel_activity' && <CancelActivityForm config={config} setConfig={setConfig} />}
                {config.actionType === 'reschedule_activity' && <RescheduleActivityForm config={config} setConfig={setConfig} />}
                {config.actionType === 'send_notification' && <NotificationForm config={config} setConfig={setConfig} users={users} />}
                {config.actionType === 'trigger_automation' && <TriggerAutomationForm config={config} setConfig={setConfig} flows={flows} currentFlowId={flowId} />}
                {/* DESCRIÇÃO GENÉRICA para outras ações */}
                {!['add_tag', 'remove_tag', 'assign_owner', 'move_opportunity', 'win_opportunity', 'lose_opportunity', 'create_opportunity', 'update_lead', 'set_custom_field', 'send_webhook', 'create_activity', 'update_activity', 'complete_activity', 'cancel_activity', 'reschedule_activity', 'send_notification', 'trigger_automation'].includes(config.actionType) && (
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
              </>
            )}
          </div>
        )

      case 'message':
        // Detectar se trigger tem instanceId configurado
        const triggerNode = nodes?.find(n => n.id === 'start-node')
        // Buscar no primeiro trigger habilitado
        const firstTrigger = triggerNode?.data?.triggers?.find((t: any) => t.enabled)
        const triggerInstanceId = firstTrigger?.config?.instanceId
        const triggerInstanceName = firstTrigger?.config?.instanceName
        
        return (
          <div className="space-y-4">
            {/* Mostrar campo APENAS se trigger NÃO tiver instanceId */}
            {!triggerInstanceId ? (
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
            ) : (
              // Mostrar aviso informativo quando instância já está no trigger
              <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded-md">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      <strong>Instância definida no gatilho:</strong> 📱 {triggerInstanceName}
                    </p>
                    <p className="text-xs text-blue-600 mt-1">
                      Esta mensagem será enviada pela instância configurada no primeiro card.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
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
        return <ConditionForm config={config} setConfig={setConfig} />

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

      case 'distribution':
        return <DistributionForm config={config} setConfig={setConfig} />

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

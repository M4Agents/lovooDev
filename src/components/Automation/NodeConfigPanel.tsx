// =====================================================
// COMPONENT: NODE CONFIG PANEL
// Data: 13/03/2026
// Objetivo: Painel lateral para configurar blocos selecionados
// =====================================================
import { TriggerAutomationForm } from './TriggerAutomationForm'
import { NotificationForm } from './NotificationForm'
import { ConditionForm } from './ConditionForm'
import { DistributionForm } from './DistributionForm'
import ExecuteAgentForm from './forms/ExecuteAgentForm'
import NodeExecutionStatus from './NodeExecutionStatus'
import { useState, useEffect } from 'react'
import { X, Save, ArrowLeft } from 'lucide-react'
import { Node } from 'reactflow'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import ActionTypeSelector, { ACTION_TYPES } from './ActionTypeSelector'
import { CreateActivityForm, UpdateActivityForm, CompleteActivityForm, CancelActivityForm, RescheduleActivityForm } from './ActivityForms'
import { companyOwnAgentsApi, type CompanyAgent } from '../../services/companyOwnAgentsApi'

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
  const [agents, setAgents] = useState<CompanyAgent[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)

  useEffect(() => {
    if (selectedNode) {
      setConfig(selectedNode.data.config || {})
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
    const actionType = config.actionType || selectedNode?.data?.config?.actionType
    if (selectedNode?.type === 'action' && company?.id && actionType === 'attach_agent') {
      loadAgents()
    }
  }, [selectedNode?.type, selectedNode?.data?.config?.actionType, config.actionType, company?.id])

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
    if (!company?.id) return
    try {
      const { data, error } = await supabase.from('automation_flows').select('*').eq('company_id', company.id)
      if (error) {
        console.error('Erro ao carregar automações:', error)
        return
      }
      setFlows(data || [])
    } catch (error) {
      console.error('Erro ao carregar automações:', error)
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

  const loadAgents = async () => {
    if (!company?.id) return
    setLoadingAgents(true)
    try {
      const data = await companyOwnAgentsApi.list(company.id)
      setAgents(data || [])
    } catch (error) {
      console.error('[NodeConfigPanel] Erro ao carregar agentes:', error)
    } finally {
      setLoadingAgents(false)
    }
  }

  if (!selectedNode) return null

  const handleSave = () => {
    if (selectedNode.type === 'action' && !config.actionType) {
      alert('⚠️ Por favor, selecione um tipo de ação antes de salvar.')
      return
    }
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

                {/* Ativar Agente de IA */}
                {config.actionType === 'attach_agent' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Agente de IA *
                      </label>
                      {loadingAgents ? (
                        <div className="text-sm text-gray-500">Carregando agentes...</div>
                      ) : agents.length === 0 ? (
                        <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
                          Nenhum agente de IA disponível. Configure um agente para esta empresa primeiro.
                        </div>
                      ) : (
                        <select
                          value={config.agentId || ''}
                          onChange={(e) => setConfig({ ...config, agentId: e.target.value })}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">Selecione um agente</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="text-xs text-blue-600 bg-blue-50 p-3 rounded-md">
                      O agente será ativado para responder automaticamente todas as mensagens desta conversa. Requer que exista uma conversa no contexto da execução (gatilhos: Mensagem Recebida, Oportunidade Movida).
                    </div>
                  </div>
                )}

                {/* Desativar Agente de IA */}
                {config.actionType === 'detach_agent' && (
                  <div className="text-sm text-gray-600 bg-orange-50 border border-orange-200 p-3 rounded-md">
                    O agente de IA será desativado para esta conversa. O atendimento automático será encerrado.
                  </div>
                )}

                {/* DESCRIÇÃO GENÉRICA para outras ações */}
                {!['add_tag', 'remove_tag', 'assign_owner', 'move_opportunity', 'win_opportunity', 'lose_opportunity', 'create_opportunity', 'update_lead', 'set_custom_field', 'send_webhook', 'create_activity', 'update_activity', 'complete_activity', 'cancel_activity', 'reschedule_activity', 'send_notification', 'trigger_automation', 'attach_agent', 'detach_agent'].includes(config.actionType) && (
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
                <option value="seconds">Segundos</option>
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

      case 'execute_agent':
        return <ExecuteAgentForm config={config} setConfig={setConfig} />

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

        {selectedNode.data.debugStatus && (
          <NodeExecutionStatus
            nodeType={selectedNode.type || ''}
            debugStatus={selectedNode.data.debugStatus}
          />
        )}

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

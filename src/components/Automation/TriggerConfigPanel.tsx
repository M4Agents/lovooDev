// =====================================================
// COMPONENT: TRIGGER CONFIG PANEL
// Data: 14/03/2026
// Objetivo: Painel de configuração avançada para triggers
// =====================================================

import { useState, useEffect } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import { Node } from 'reactflow'
import { useAuth } from '../../contexts/AuthContext'
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances'
import { useSalesFunnels } from '../../hooks/useSalesFunnels'
import { useFunnelStages } from '../../hooks/useFunnelStages'
import type { TriggerType, ComparisonType, SessionControl, LostReason } from '../../types/automation'

interface TriggerConfigPanelProps {
  selectedNode: Node | null
  onClose: () => void
  onSave: (nodeId: string, config: any) => void
}

export default function TriggerConfigPanel({ selectedNode, onClose, onSave }: TriggerConfigPanelProps) {
  const [config, setConfig] = useState<any>({
    triggerType: 'message.received',
    comparisonType: 'contains',
    keywords: [],
    sessionControl: 'if_not_active',
    listenGroups: false,
    receiveMetadata: false,
    funnelId: '',
    funnelName: '',
    fromStageId: '',
    fromStageName: '',
    toStageId: '',
    toStageName: '',
    initialStageId: '',
    initialStageName: '',
    lostReason: '',
    stageId: '',
    stageName: '',
    minValue: undefined,
    maxValue: undefined,
    ownerId: '',
    ownerName: '',
    previousStatus: 'won'
  })
  const [currentKeyword, setCurrentKeyword] = useState('')
  const { company } = useAuth()
  const { instances, loading: loadingInstances } = useWhatsAppInstances(company?.id)
  const { funnels, loading: loadingFunnels } = useSalesFunnels(company?.id)
  const { stages, loading: loadingStages } = useFunnelStages(config.funnelId || '')

  useEffect(() => {
    if (selectedNode) {
      const nodeConfig = selectedNode.data.config || {}
      setConfig({
        triggerType: nodeConfig.triggerType || 'message.received',
        comparisonType: nodeConfig.comparisonType || 'contains',
        keywords: nodeConfig.keywords || [],
        sessionControl: nodeConfig.sessionControl || 'if_not_active',
        listenGroups: nodeConfig.listenGroups || false,
        receiveMetadata: nodeConfig.receiveMetadata || false,
        instanceId: nodeConfig.instanceId || '',
        instanceName: nodeConfig.instanceName || '',
        funnelId: nodeConfig.funnelId || '',
        funnelName: nodeConfig.funnelName || '',
        fromStageId: nodeConfig.fromStageId || '',
        fromStageName: nodeConfig.fromStageName || '',
        toStageId: nodeConfig.toStageId || '',
        toStageName: nodeConfig.toStageName || '',
        initialStageId: nodeConfig.initialStageId || '',
        initialStageName: nodeConfig.initialStageName || '',
        lostReason: nodeConfig.lostReason || '',
        stageId: nodeConfig.stageId || '',
        stageName: nodeConfig.stageName || '',
        minValue: nodeConfig.minValue,
        maxValue: nodeConfig.maxValue,
        ownerId: nodeConfig.ownerId || '',
        ownerName: nodeConfig.ownerName || '',
        previousStatus: nodeConfig.previousStatus || 'won'
      })
    }
  }, [selectedNode])

  if (!selectedNode) return null

  const handleSave = () => {
    onSave(selectedNode.id, config)
    onClose()
  }

  const addKeyword = () => {
    if (currentKeyword.trim()) {
      setConfig({
        ...config,
        keywords: [...(config.keywords || []), currentKeyword.trim()]
      })
      setCurrentKeyword('')
    }
  }

  const removeKeyword = (index: number) => {
    setConfig({
      ...config,
      keywords: (config.keywords || []).filter((_: string, i: number) => i !== index)
    })
  }

  const handleKeywordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addKeyword()
    }
  }

  const handleFunnelChange = (funnelId: string) => {
    const funnel = funnels.find(f => f.id === funnelId)
    setConfig({
      ...config,
      funnelId,
      funnelName: funnel?.name || '',
      fromStageId: '',
      fromStageName: '',
      toStageId: '',
      toStageName: '',
      initialStageId: '',
      initialStageName: '',
      stageId: '',
      stageName: ''
    })
  }

  const triggerTypes: { value: TriggerType; label: string }[] = [
    { value: 'message.received', label: '📥 Mensagem Recebida' },
    { value: 'lead.created', label: '👤 Lead Criado' },
    { value: 'tag.added', label: '🏷️ Tag Adicionada' },
    { value: 'tag.removed', label: '🏷️ Tag Removida' },
    { value: 'opportunity.created', label: '💼 Oportunidade Criada' },
    { value: 'opportunity.stage_changed', label: '➡️ Oportunidade Movida' },
    { value: 'opportunity.won', label: '🎉 Oportunidade Ganha' },
    { value: 'opportunity.lost', label: '😔 Oportunidade Perdida' },
    { value: 'opportunity.owner_assigned', label: '👤 Vendedor Atribuído' },
    { value: 'opportunity.owner_removed', label: '👤 Vendedor Removido' },
  ]

  const comparisonTypes: { value: ComparisonType; label: string }[] = [
    { value: 'contains', label: 'Contém' },
    { value: 'equals', label: 'É igual' },
    { value: 'starts_with', label: 'Começa com' },
    { value: 'ends_with', label: 'Termina com' },
    { value: 'not_contains', label: 'Não contém' },
    { value: 'not_equals', label: 'Diferente de' },
    { value: 'regex', label: 'Regex (avançado)' },
  ]

  const sessionControls: { value: SessionControl; label: string; description: string }[] = [
    { 
      value: 'always', 
      label: 'Sempre executar',
      description: 'Executa toda vez que o gatilho for acionado'
    },
    { 
      value: 'if_not_active', 
      label: 'Apenas se não estiver ativo',
      description: 'Não executa se já houver uma sessão ativa desta automação'
    },
    { 
      value: 'new_conversation', 
      label: 'Nova conversa',
      description: 'Executa apenas em novas conversas (24h sem mensagens)'
    },
  ]

  const lostReasons: { value: LostReason; label: string }[] = [
    { value: 'price', label: '💰 Preço' },
    { value: 'timing', label: '⏰ Timing' },
    { value: 'competitor', label: '🏆 Concorrente' },
    { value: 'no_interest', label: '❌ Sem Interesse' },
    { value: 'other', label: '📝 Outro' },
  ]

  const renderOpportunityCreatedConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil (opcional)
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Qualquer funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Etapa Inicial */}
      {config.funnelId && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Etapa Inicial (opcional)
          </label>
          {loadingStages ? (
            <div className="text-sm text-gray-500">Carregando etapas...</div>
          ) : (
            <select
              value={config.initialStageId || ''}
              onChange={(e) => {
                const stage = stages.find(s => s.id === e.target.value)
                setConfig({
                  ...config,
                  initialStageId: e.target.value,
                  initialStageName: stage?.name || ''
                })
              }}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="">Qualquer etapa</option>
              {stages.map(stage => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Valor Mínimo/Máximo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Mínimo (R$)
          </label>
          <input
            type="number"
            value={config.minValue || ''}
            onChange={(e) => setConfig({ ...config, minValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Máximo (R$)
          </label>
          <input
            type="number"
            value={config.maxValue || ''}
            onChange={(e) => setConfig({ ...config, maxValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
      </div>
    </div>
  )

  const renderOpportunityStageChangedConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil *
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : funnels.length === 0 ? (
          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
            ⚠️ Nenhum funil encontrado. Crie um funil primeiro.
          </div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Selecione um funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* De qual etapa */}
      {config.funnelId && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              De qual etapa (opcional)
            </label>
            {loadingStages ? (
              <div className="text-sm text-gray-500">Carregando etapas...</div>
            ) : (
              <select
                value={config.fromStageId || ''}
                onChange={(e) => {
                  const stage = stages.find(s => s.id === e.target.value)
                  setConfig({
                    ...config,
                    fromStageId: e.target.value,
                    fromStageName: stage?.name || ''
                  })
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              >
                <option value="">Qualquer etapa</option>
                {stages.map(stage => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Deixe vazio para disparar quando mover de qualquer etapa
            </p>
          </div>

          {/* Para qual etapa */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Para qual etapa *
            </label>
            {loadingStages ? (
              <div className="text-sm text-gray-500">Carregando etapas...</div>
            ) : (
              <select
                value={config.toStageId || ''}
                onChange={(e) => {
                  const stage = stages.find(s => s.id === e.target.value)
                  setConfig({
                    ...config,
                    toStageId: e.target.value,
                    toStageName: stage?.name || ''
                  })
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              >
                <option value="">Selecione uma etapa</option>
                {stages.map(stage => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Valor Mínimo/Máximo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valor Mínimo (R$)
              </label>
              <input
                type="number"
                value={config.minValue || ''}
                onChange={(e) => setConfig({ ...config, minValue: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="0.00"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valor Máximo (R$)
              </label>
              <input
                type="number"
                value={config.maxValue || ''}
                onChange={(e) => setConfig({ ...config, maxValue: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="0.00"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )

  const renderOpportunityWonConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil (opcional)
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Qualquer funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Valor Mínimo/Máximo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Mínimo (R$)
          </label>
          <input
            type="number"
            value={config.minValue || ''}
            onChange={(e) => setConfig({ ...config, minValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Máximo (R$)
          </label>
          <input
            type="number"
            value={config.maxValue || ''}
            onChange={(e) => setConfig({ ...config, maxValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
      </div>

      <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
        ℹ️ Este gatilho dispara quando uma oportunidade é marcada como "Ganha"
      </div>
    </div>
  )

  const renderOpportunityLostConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil (opcional)
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Qualquer funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Motivo da Perda */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Motivo da Perda (opcional)
        </label>
        <select
          value={config.lostReason || ''}
          onChange={(e) => setConfig({ ...config, lostReason: e.target.value })}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
        >
          <option value="">Qualquer motivo</option>
          {lostReasons.map(reason => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </div>

      {/* Etapa em que foi perdida */}
      {config.funnelId && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Etapa em que foi perdida (opcional)
          </label>
          {loadingStages ? (
            <div className="text-sm text-gray-500">Carregando etapas...</div>
          ) : (
            <select
              value={config.stageId || ''}
              onChange={(e) => {
                const stage = stages.find(s => s.id === e.target.value)
                setConfig({
                  ...config,
                  stageId: e.target.value,
                  stageName: stage?.name || ''
                })
              }}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="">Qualquer etapa</option>
              {stages.map(stage => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Valor Mínimo/Máximo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Mínimo (R$)
          </label>
          <input
            type="number"
            value={config.minValue || ''}
            onChange={(e) => setConfig({ ...config, minValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Valor Máximo (R$)
          </label>
          <input
            type="number"
            value={config.maxValue || ''}
            onChange={(e) => setConfig({ ...config, maxValue: e.target.value ? parseFloat(e.target.value) : undefined })}
            placeholder="0.00"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          />
        </div>
      </div>
    </div>
  )

  const renderOpportunityOwnerAssignedConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil (opcional)
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Qualquer funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
        ℹ️ Este gatilho dispara quando um vendedor é atribuído a uma oportunidade
      </div>
    </div>
  )

  const renderOpportunityOwnerRemovedConfig = () => (
    <div className="space-y-4">
      {/* Funil */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Funil (opcional)
        </label>
        {loadingFunnels ? (
          <div className="text-sm text-gray-500">Carregando funis...</div>
        ) : (
          <select
            value={config.funnelId || ''}
            onChange={(e) => handleFunnelChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
          >
            <option value="">Qualquer funil</option>
            {funnels.map(funnel => (
              <option key={funnel.id} value={funnel.id}>
                {funnel.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
        ℹ️ Este gatilho dispara quando um vendedor é removido de uma oportunidade
      </div>
    </div>
  )

  const renderMessageReceivedConfig = () => (
    <div className="space-y-4">
      {/* Instância WhatsApp */}
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
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
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

      {/* Tipo de Comparação */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tipo de Comparação
        </label>
        <select
          value={config.comparisonType || 'contains'}
          onChange={(e) => setConfig({ ...config, comparisonType: e.target.value })}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
        >
          {comparisonTypes.map(type => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Palavras-chave */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Palavras-chave
        </label>
        <div className="space-y-2">
          {/* Lista de palavras-chave */}
          {(config.keywords || []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {config.keywords.map((keyword: string, index: number) => (
                <div
                  key={index}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                >
                  <span>{keyword}</span>
                  <button
                    onClick={() => removeKeyword(index)}
                    className="hover:bg-green-200 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Input para adicionar */}
          <div className="flex gap-2">
            <input
              type="text"
              value={currentKeyword}
              onChange={(e) => setCurrentKeyword(e.target.value)}
              onKeyPress={handleKeywordKeyPress}
              placeholder="Digite uma palavra-chave e pressione Enter"
              className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            />
            <button
              onClick={addKeyword}
              className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Deixe vazio para disparar em qualquer mensagem
          </p>
        </div>
      </div>

      {/* Controle de Sessão */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Controle de Sessão
        </label>
        <select
          value={config.sessionControl || 'if_not_active'}
          onChange={(e) => setConfig({ ...config, sessionControl: e.target.value })}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
        >
          {sessionControls.map(control => (
            <option key={control.value} value={control.value}>
              {control.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {sessionControls.find(c => c.value === config.sessionControl)?.description}
        </p>
      </div>

      {/* Opções Avançadas */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Opções Avançadas
        </label>
        
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.listenGroups || false}
            onChange={(e) => setConfig({ ...config, listenGroups: e.target.checked })}
            className="rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-sm text-gray-700">Ouvir mensagens de grupos</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.receiveMetadata || false}
            onChange={(e) => setConfig({ ...config, receiveMetadata: e.target.checked })}
            className="rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-sm text-gray-700">Receber metadados da mensagem</span>
        </label>
      </div>
    </div>
  )

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">
          Configurar Gatilho
        </h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-md transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Tipo de Gatilho */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tipo de Gatilho *
            </label>
            <select
              value={config.triggerType || 'message.received'}
              onChange={(e) => setConfig({ ...config, triggerType: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            >
              {triggerTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Configurações específicas por tipo */}
          {config.triggerType === 'message.received' && renderMessageReceivedConfig()}
          
          {config.triggerType === 'lead.created' && (
            <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-md">
              ℹ️ Esta automação será disparada sempre que um novo lead for criado no sistema.
            </div>
          )}

          {(config.triggerType === 'tag.added' || config.triggerType === 'tag.removed') && (
            <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-md">
              ℹ️ Configuração de tags será implementada em breve.
            </div>
          )}

          {/* Gatilhos de Oportunidades */}
          {config.triggerType === 'opportunity.created' && renderOpportunityCreatedConfig()}
          {config.triggerType === 'opportunity.stage_changed' && renderOpportunityStageChangedConfig()}
          {config.triggerType === 'opportunity.won' && renderOpportunityWonConfig()}
          {config.triggerType === 'opportunity.lost' && renderOpportunityLostConfig()}
          {config.triggerType === 'opportunity.owner_assigned' && renderOpportunityOwnerAssignedConfig()}
          {config.triggerType === 'opportunity.owner_removed' && renderOpportunityOwnerRemovedConfig()}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

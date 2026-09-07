// =====================================================
// COMPONENT: TRIGGER CONFIG MODAL
// Data: 16/03/2026
// Objetivo: Modal genérico para configurar gatilhos
// =====================================================

import { useState, useEffect } from 'react'
import { X, Info } from 'lucide-react'
import type { TriggerConfig } from '../../types/automation'
import { useAuth } from '../../contexts/AuthContext'
import { useWhatsAppInstances } from '../../hooks/useWhatsAppInstances'
import { useFunnels } from '../../hooks/useFunnels'
import { useFunnelStages } from '../../hooks/useFunnelStages'
import { LEAD_SOURCE_OPTIONS, LEAD_SOURCE_ANY } from './leadSourceOptions'

interface TriggerConfigModalProps {
  isOpen: boolean
  onClose: () => void
  trigger: TriggerConfig | null
  onSave: (triggerId: string, config: Record<string, any>) => void
}

export default function TriggerConfigModal({ isOpen, onClose, trigger, onSave }: TriggerConfigModalProps) {
  const { company } = useAuth()
  const { instances, loading: loadingInstances } = useWhatsAppInstances(company?.id)
  const { funnels, loading: loadingFunnels } = useFunnels(company?.id || '')
  const [config, setConfig] = useState<Record<string, any>>(trigger?.config || {})
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>(config.funnelId || '')
  const { stages, loading: loadingStages } = useFunnelStages(selectedFunnelId)
  const [showKeywordHelp, setShowKeywordHelp] = useState(false)

  useEffect(() => {
    if (isOpen && trigger) {
      setConfig(trigger.config || {})
      setSelectedFunnelId(trigger.config?.funnelId || '')
    }
  }, [isOpen, trigger])

  if (!isOpen || !trigger) return null

  const handleSave = () => {
    // #region agent log
    fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2e0608'},body:JSON.stringify({sessionId:'2e0608',location:'TriggerConfigModal.tsx:handleSave',message:'trigger config saved',data:{triggerId:trigger.id,triggerType:trigger.type,config},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    onSave(trigger.id, config)
    onClose()
  }

  const handleClose = () => {
    setConfig({})
    onClose()
  }

  // Renderizar formulário específico baseado no tipo de gatilho
  const renderConfigForm = () => {
    switch (trigger.type) {
      case 'tag.added':
      case 'tag.removed':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Qual(is) tag(s)? <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={config.tagName || ''}
                onChange={(e) => setConfig({ ...config, tagName: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Nome da tag"
              />
              <p className="text-xs text-gray-500 mt-1">
                Digite o nome da tag que disparará o fluxo
              </p>
            </div>
          </div>
        )

      case 'opportunity.created':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value, stageId: '' })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Qualquer funil</option>
                  {funnels.map(funnel => (
                    <option key={funnel.id} value={funnel.id}>
                      {funnel.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Deixe em branco para disparar em qualquer funil
              </p>
            </div>

            {/* 2. ETAPA (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual etapa?
              </label>
              {loadingStages ? (
                <div className="text-sm text-gray-500">Carregando etapas...</div>
              ) : (
                <select
                  value={config.stageId || ''}
                  onChange={(e) => setConfig({ ...config, stageId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedFunnelId}
                >
                  <option value="">Qualquer etapa</option>
                  {stages.map(stage => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              )}
              {!selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione um funil primeiro para escolher a etapa
                </p>
              )}
              {selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Deixe em branco para disparar em qualquer etapa
                </p>
              )}
            </div>
          </div>
        )

      case 'opportunity.stage_changed':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value, toStageId: '' })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Qualquer funil</option>
                  {funnels.map(funnel => (
                    <option key={funnel.id} value={funnel.id}>
                      {funnel.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Deixe em branco para disparar em qualquer funil
              </p>
            </div>

            {/* 2. PARA QUAL ETAPA (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Para qual etapa?
              </label>
              {loadingStages ? (
                <div className="text-sm text-gray-500">Carregando etapas...</div>
              ) : (
                <select
                  value={config.toStageId || ''}
                  onChange={(e) => setConfig({ ...config, toStageId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedFunnelId}
                >
                  <option value="">Qualquer etapa</option>
                  {stages.map(stage => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              )}
              {!selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione um funil primeiro para escolher a etapa
                </p>
              )}
              {selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Deixe em branco para disparar ao mover para qualquer etapa
                </p>
              )}
            </div>
          </div>
        )

      case 'message.received':
        return (
          <div className="space-y-4">
            {/* 1. SELEÇÃO DE INSTÂNCIA */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Qual a instância que irá ouvir as mensagens e iniciar a automação?
              </label>
              {loadingInstances ? (
                <div className="text-sm text-gray-500">Carregando instâncias...</div>
              ) : (
                <select
                  value={config.instanceId || ''}
                  onChange={(e) => setConfig({ ...config, instanceId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Selecionar</option>
                  {instances.map(instance => (
                    <option key={instance.id} value={instance.id}>
                      {instance.instance_name || `Instância ${instance.id}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. TIPO DE COMPARAÇÃO */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo da comparação das palavras-chaves
              </label>
              <select
                value={config.comparisonType || 'contains'}
                onChange={(e) => setConfig({ ...config, comparisonType: e.target.value, keyword: '', keywords: [] })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="contains">Contém</option>
                <option value="equals">Igual</option>
                <option value="regex">Regex</option>
                <option value="link_origin">Gerada por link</option>
              </select>
              {config.comparisonType === 'link_origin' && (
                <p className="text-xs text-gray-500 mt-1">
                  A automação será executada apenas quando a mensagem for iniciada via link click-to-chat do WhatsApp.
                </p>
              )}
            </div>

            {/* 3. PALAVRA-CHAVE / EXPRESSÃO REGULAR — oculto em modo link_origin */}
            {config.comparisonType !== 'link_origin' && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {config.comparisonType === 'regex' ? 'Expressão regular' : 'Palavra-chave'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowKeywordHelp(v => !v)}
                    className="text-blue-500 hover:text-blue-700 transition-colors"
                    title="Como usar"
                  >
                    <Info size={15} />
                  </button>
                </div>

                {/* Painel de ajuda — exibido ao clicar no ícone */}
                {showKeywordHelp && (
                  <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800 space-y-2">
                    {config.comparisonType === 'regex' ? (
                      <>
                        <p className="font-semibold">Como usar Regex:</p>
                        <ul className="space-y-1 list-none">
                          <li><code className="bg-blue-100 px-1 rounded">(?i)confirmar</code> — qualquer capitalização ("Confirmar", "CONFIRMAR")</li>
                          <li><code className="bg-blue-100 px-1 rounded">(?i)^confirmar$</code> — somente a palavra exata, qualquer caixa</li>
                          <li><code className="bg-blue-100 px-1 rounded">(?i)^(sim|confirmar|quero)$</code> — múltiplas opções</li>
                          <li><code className="bg-blue-100 px-1 rounded">(?i)^(oi|olá|ola|hey)$</code> — saudações com ou sem acento</li>
                        </ul>
                        <p className="text-blue-600">Use <strong>(?i)</strong> no início para ignorar maiúsculas/minúsculas. Use <strong>|</strong> para múltiplas opções.</p>
                      </>
                    ) : config.comparisonType === 'equals' ? (
                      <>
                        <p className="font-semibold">Como usar Igual:</p>
                        <ul className="space-y-1 list-none">
                          <li>A mensagem do usuário deve ser <strong>exatamente igual</strong> à palavra configurada.</li>
                          <li>Não diferencia maiúsculas/minúsculas: "SIM" e "sim" são equivalentes.</li>
                          <li>Para múltiplas opções, use o tipo <strong>Regex</strong> com <code className="bg-blue-100 px-1 rounded">(?i)^(sim|não)$</code></li>
                        </ul>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">Como usar Contém:</p>
                        <ul className="space-y-1 list-none">
                          <li>A mensagem do usuário deve <strong>conter</strong> a palavra configurada em qualquer posição.</li>
                          <li>Não diferencia maiúsculas/minúsculas: "CONFIRMAR" e "confirmar" são equivalentes.</li>
                          <li>Digite <strong>apenas uma palavra</strong> por gatilho. Para múltiplas opções, use o tipo <strong>Regex</strong>.</li>
                          <li>Ex: <code className="bg-blue-100 px-1 rounded">confirmar</code> captura mensagens como "Quero confirmar minha compra"</li>
                        </ul>
                      </>
                    )}
                  </div>
                )}

                <input
                  type="text"
                  value={config.keyword || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    setConfig({
                      ...config,
                      keyword:  value,
                      keywords: value ? [value] : [],
                    })
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={
                    config.comparisonType === 'regex'
                      ? 'Ex: (?i)^(confirmar|sim|quero)$'
                      : config.comparisonType === 'equals'
                      ? 'Ex: confirmar'
                      : 'Ex: confirmar'
                  }
                />
                <p className="text-xs text-gray-500 mt-1">
                  {config.comparisonType === 'regex'
                    ? 'Expressão regular JavaScript. Use (?i) para ignorar maiúsculas/minúsculas e | para múltiplas opções.'
                    : config.comparisonType === 'equals'
                    ? 'A mensagem deve ser exatamente igual (não diferencia maiúsculas/minúsculas).'
                    : 'A mensagem deve conter a palavra-chave (não diferencia maiúsculas/minúsculas).'}
                </p>
              </div>
            )}
          </div>
        )

      case 'message.sent':
        return (
          <div className="space-y-4">
            {/* 1. SELEÇÃO DE INSTÂNCIA */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Qual a instância que enviou a mensagem?
              </label>
              {loadingInstances ? (
                <div className="text-sm text-gray-500">Carregando instâncias...</div>
              ) : (
                <select
                  value={config.instanceId || ''}
                  onChange={(e) => setConfig({ ...config, instanceId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Selecionar</option>
                  {instances.map(instance => (
                    <option key={instance.id} value={instance.id}>
                      {instance.instance_name || `Instância ${instance.id}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. TIPO DE COMPARAÇÃO */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo da comparação das palavras-chaves
              </label>
              <select
                value={config.comparisonType || 'contains'}
                onChange={(e) => setConfig({ ...config, comparisonType: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="contains">Contém</option>
                <option value="equals">Igual</option>
              </select>
            </div>

            {/* 3. PALAVRA-CHAVE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Palavra-chave
              </label>
              <input
                type="text"
                value={config.keyword || ''}
                onChange={(e) => setConfig({ ...config, keyword: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ex: oi, olá, menu"
              />
              <p className="text-xs text-gray-500 mt-1">
                {config.comparisonType === 'equals' 
                  ? 'A mensagem deve ser exatamente igual à palavra-chave'
                  : 'A mensagem deve conter a palavra-chave'}
              </p>
            </div>
          </div>
        )

      case 'opportunity.won':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value, stageId: '' })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
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

            {/* 2. ETAPA DE GANHO (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Etapa de ganho
              </label>
              {loadingStages ? (
                <div className="text-sm text-gray-500">Carregando etapas...</div>
              ) : (
                <select
                  value={config.stageId || ''}
                  onChange={(e) => setConfig({ ...config, stageId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedFunnelId}
                >
                  <option value="">Qualquer etapa</option>
                  {stages.filter(s => s.stage_type === 'won').map(stage => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              )}
              {!selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione um funil primeiro
                </p>
              )}
            </div>

            {/* 3. VALOR MÍNIMO (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valor mínimo (opcional)
              </label>
              <input
                type="number"
                value={config.minValue || ''}
                onChange={(e) => setConfig({ ...config, minValue: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ex: 1000"
              />
              <p className="text-xs text-gray-500 mt-1">
                Deixe em branco para disparar com qualquer valor
              </p>
            </div>
          </div>
        )

      case 'opportunity.lost':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value, stageId: '' })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
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

            {/* 2. ETAPA ONDE FOI PERDIDA (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Etapa onde foi perdida
              </label>
              {loadingStages ? (
                <div className="text-sm text-gray-500">Carregando etapas...</div>
              ) : (
                <select
                  value={config.stageId || ''}
                  onChange={(e) => setConfig({ ...config, stageId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedFunnelId}
                >
                  <option value="">Qualquer etapa</option>
                  {stages.filter(s => s.stage_type === 'lost').map(stage => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              )}
              {!selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione um funil primeiro
                </p>
              )}
            </div>

            {/* 3. MOTIVO DE PERDA (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Motivo de perda (opcional)
              </label>
              <input
                type="text"
                value={config.lossReason || ''}
                onChange={(e) => setConfig({ ...config, lossReason: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ex: Preço alto, Concorrência"
              />
            </div>
          </div>
        )

      case 'opportunity.owner_assigned':
      case 'opportunity.owner_removed':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Qualquer funil</option>
                  {funnels.map(funnel => (
                    <option key={funnel.id} value={funnel.id}>
                      {funnel.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Deixe em branco para disparar em qualquer funil
              </p>
            </div>

            {/* 2. VENDEDOR ESPECÍFICO (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vendedor específico (opcional)
              </label>
              <input
                type="text"
                value={config.userId || ''}
                onChange={(e) => setConfig({ ...config, userId: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="ID do vendedor"
              />
              <p className="text-xs text-gray-500 mt-1">
                Deixe em branco para disparar com qualquer vendedor
              </p>
            </div>
          </div>
        )

      case 'opportunity.restored':
        return (
          <div className="space-y-4">
            {/* 1. FUNIL (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Em qual funil?
              </label>
              {loadingFunnels ? (
                <div className="text-sm text-gray-500">Carregando funis...</div>
              ) : (
                <select
                  value={selectedFunnelId}
                  onChange={(e) => {
                    setSelectedFunnelId(e.target.value)
                    setConfig({ ...config, funnelId: e.target.value, toStageId: '' })
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
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

            {/* 2. DE QUAL STATUS */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                De qual status?
              </label>
              <select
                value={config.fromStatus || ''}
                onChange={(e) => setConfig({ ...config, fromStatus: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Qualquer status</option>
                <option value="won">Ganha</option>
                <option value="lost">Perdida</option>
              </select>
            </div>

            {/* 3. PARA QUAL ETAPA (OPCIONAL) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Para qual etapa?
              </label>
              {loadingStages ? (
                <div className="text-sm text-gray-500">Carregando etapas...</div>
              ) : (
                <select
                  value={config.toStageId || ''}
                  onChange={(e) => setConfig({ ...config, toStageId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedFunnelId}
                >
                  <option value="">Qualquer etapa</option>
                  {stages.filter(s => s.stage_type === 'active').map(stage => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              )}
              {!selectedFunnelId && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione um funil primeiro
                </p>
              )}
            </div>
          </div>
        )

      case 'lead.created':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Origem do lead
              </label>
              <select
                value={config.source || LEAD_SOURCE_ANY}
                onChange={(e) => setConfig({ ...config, source: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {LEAD_SOURCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Filtre por como o lead foi criado. "Qualquer origem" dispara em todos os casos.
              </p>
            </div>
          </div>
        )

      case 'schedule.time':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de recorrência <span className="text-red-500">*</span>
              </label>
              <select
                value={config.recurrence || 'daily'}
                onChange={(e) => setConfig({ ...config, recurrence: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="daily">Diário</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Horário <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={config.time || '09:00'}
                onChange={(e) => setConfig({ ...config, time: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        )

      case 'calendar.activity_due_soon':
        return (
          <div className="space-y-4">
            {/* #region agent log */}
            {(() => { fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2e0608'},body:JSON.stringify({sessionId:'2e0608',location:'TriggerConfigModal.tsx:due_soon',message:'due_soon form rendered',data:{minutes_before:config.minutes_before,activity_type:config.activity_type,priority:config.priority},timestamp:Date.now()})}).catch(()=>{}); return null })()}
            {/* #endregion */}

            {/* ANTECEDÊNCIA */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Antecedência (minutos antes) <span className="text-red-500">*</span>
              </label>
              <select
                value={config.minutes_before ?? 60}
                onChange={(e) => setConfig({ ...config, minutes_before: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={5}>5 minutos</option>
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
                <option value={120}>2 horas</option>
                <option value={240}>4 horas</option>
                <option value={480}>8 horas</option>
                <option value={1440}>1 dia</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Quantos minutos antes do horário agendado este gatilho deve disparar.
              </p>
            </div>

            {/* TIPO DE ATIVIDADE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de Atividade
              </label>
              <select
                value={config.activity_type || ''}
                onChange={(e) => setConfig({ ...config, activity_type: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Qualquer tipo</option>
                <option value="call">Ligação</option>
                <option value="meeting">Reunião</option>
                <option value="email">E-mail</option>
                <option value="task">Tarefa</option>
                <option value="follow_up">Follow-up</option>
                <option value="demo">Demo</option>
                <option value="other">Outro</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Deixe vazio para disparar em qualquer tipo de atividade.
              </p>
            </div>

            {/* PRIORIDADE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Prioridade
              </label>
              <select
                value={config.priority || ''}
                onChange={(e) => setConfig({ ...config, priority: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Qualquer prioridade</option>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Deixe vazio para disparar em qualquer prioridade.
              </p>
            </div>

            {/* INFO */}
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-xs text-yellow-800">
                <strong>Ativação temporal:</strong> Este gatilho é processado pelo cron de automação de calendário. O disparo ocorre em até 1 minuto da janela configurada.
              </p>
            </div>
          </div>
        )

      case 'calendar.activity_overdue':
        return (
          <div className="space-y-4">
            {/* #region agent log */}
            {(() => { fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2e0608'},body:JSON.stringify({sessionId:'2e0608',location:'TriggerConfigModal.tsx:overdue',message:'overdue form rendered',data:{minutes_after:config.minutes_after,activity_type:config.activity_type,priority:config.priority},timestamp:Date.now()})}).catch(()=>{}); return null })()}
            {/* #endregion */}

            {/* TEMPO APÓS O HORÁRIO */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tempo após o horário <span className="text-red-500">*</span>
              </label>
              <select
                value={config.minutes_after ?? 0}
                onChange={(e) => setConfig({ ...config, minutes_after: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={0}>Imediatamente após o horário</option>
                <option value={5}>5 minutos após</option>
                <option value={15}>15 minutos após</option>
                <option value={30}>30 minutos após</option>
                <option value={60}>1 hora após</option>
                <option value={120}>2 horas após</option>
                <option value={240}>4 horas após</option>
                <option value={1440}>1 dia após</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Quanto tempo após o horário agendado a atividade é considerada vencida. Aplica-se apenas a atividades com status <em>pendente</em>.
              </p>
            </div>

            {/* TIPO DE ATIVIDADE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de Atividade
              </label>
              <select
                value={config.activity_type || ''}
                onChange={(e) => setConfig({ ...config, activity_type: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Qualquer tipo</option>
                <option value="call">Ligação</option>
                <option value="meeting">Reunião</option>
                <option value="email">E-mail</option>
                <option value="task">Tarefa</option>
                <option value="follow_up">Follow-up</option>
                <option value="demo">Demo</option>
                <option value="other">Outro</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Deixe vazio para disparar em qualquer tipo de atividade.
              </p>
            </div>

            {/* PRIORIDADE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Prioridade
              </label>
              <select
                value={config.priority || ''}
                onChange={(e) => setConfig({ ...config, priority: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Qualquer prioridade</option>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Deixe vazio para disparar em qualquer prioridade.
              </p>
            </div>

            {/* INFO */}
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-xs text-yellow-800">
                <strong>Ativação temporal:</strong> Este gatilho é processado pelo cron de automação de calendário. O disparo ocorre em até 1 minuto após a janela configurada.
              </p>
            </div>
          </div>
        )

      default:
        return (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">
              Configuração não necessária para este tipo de gatilho.
            </p>
            <p className="text-xs mt-2">
              O gatilho será disparado automaticamente quando o evento ocorrer.
            </p>
          </div>
        )
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Configurar Gatilho
                </h3>
                <p className="text-sm text-blue-100 mt-1">
                  {trigger.label}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="bg-white px-6 py-4">
            {renderConfigForm()}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Salvar Configuração
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

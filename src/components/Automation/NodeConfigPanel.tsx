// =====================================================
// COMPONENT: NODE CONFIG PANEL
// Data: 13/03/2026
// Objetivo: Painel lateral para configurar blocos selecionados
// =====================================================

import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import { Node } from 'reactflow'

interface NodeConfigPanelProps {
  selectedNode: Node | null
  onClose: () => void
  onSave: (nodeId: string, config: any) => void
}

export default function NodeConfigPanel({ selectedNode, onClose, onSave }: NodeConfigPanelProps) {
  const [config, setConfig] = useState<any>({})

  useEffect(() => {
    if (selectedNode) {
      setConfig(selectedNode.data.config || {})
    }
  }, [selectedNode])

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
                <option value="assign_owner">Atribuir Responsável</option>
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
                placeholder="Descreva o que esta ação fará..."
              />
            </div>
          </div>
        )

      case 'message':
        return (
          <div className="space-y-4">
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

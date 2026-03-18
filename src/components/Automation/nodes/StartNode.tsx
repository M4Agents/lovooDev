// =====================================================
// COMPONENT: START NODE
// Data: 14/03/2026
// Objetivo: Nó inicial arrastável do fluxo (estilo Datacraz)
// =====================================================

import { useState } from 'react'
import { Handle, Position } from 'reactflow'
import { Plus, TrendingUp, MessageCircle, Tag, UserPlus, X } from 'lucide-react'
import type { TriggerConfig } from '../../../types/automation'

interface StartNodeProps {
  data: {
    onAddTrigger?: () => void
    onRemoveTrigger?: (triggerId: string) => void
    onEditTrigger?: (triggerId: string) => void
    onOpenActionMenu?: () => void
    triggers?: TriggerConfig[]
    triggerOperator?: 'OR' | 'AND'
    onOperatorChange?: (operator: 'OR' | 'AND') => void
    // Legado - manter compatibilidade
    selectedTrigger?: {
      type: string
      label: string
      icon?: string
      description?: string
    }
  }
}

// Função para obter ícone do gatilho
const getTriggerIcon = (type: string) => {
  if (type.startsWith('opportunity.')) return <TrendingUp className="w-3 h-3" />
  if (type.startsWith('message.')) return <MessageCircle className="w-3 h-3" />
  if (type.startsWith('tag.')) return <Tag className="w-3 h-3" />
  if (type === 'lead.created') return <UserPlus className="w-3 h-3" />
  return <TrendingUp className="w-3 h-3" />
}

export default function StartNode({ data }: StartNodeProps) {
  const { triggers = [], triggerOperator = 'OR', selectedTrigger } = data
  const hasTriggers = triggers.length > 0

  return (
    <div className="bg-white rounded shadow-sm border border-gray-200 p-2 w-36 overflow-visible relative">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-green-600 text-xs">▷</span>
        <h3 className="text-[10px] font-semibold text-gray-900">
          Início
        </h3>
      </div>

      {/* Lista de Gatilhos */}
      {!hasTriggers ? (
        <p className="text-[8px] text-gray-500 mb-1.5 leading-tight">
          O gatilho aciona a automação. Clique para adicionar:
        </p>
      ) : (
        <div className="mb-1.5 space-y-1 max-h-20 overflow-y-auto">
          {triggers.filter(t => t.enabled).map((trigger, index) => (
            <div key={trigger.id}>
              <div 
              className="p-1.5 bg-gray-50 rounded border border-gray-200 group cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors"
              onClick={() => data.onEditTrigger?.(trigger.id)}
            >
              <div className="flex items-start gap-1">
                <div className="text-gray-700 mt-0.5">
                  {getTriggerIcon(trigger.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-semibold text-gray-900 truncate">
                    {trigger.label}
                  </div>
                  {trigger.description && (
                    <div className="text-[7px] text-gray-500 leading-tight mt-0.5">
                      {trigger.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    data.onRemoveTrigger?.(trigger.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-100 rounded"
                  title="Remover gatilho"
                >
                  <X className="w-2.5 h-2.5 text-red-600" />
                </button>
              </div>
            </div>
            
            {/* Seletor de operador AND/OR entre gatilhos */}
            {index < triggers.filter(t => t.enabled).length - 1 && (
              <div className="flex justify-center my-1">
                <div className="flex gap-1 bg-white border border-gray-300 rounded px-1.5 py-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      data.onOperatorChange?.('OR')
                    }}
                    className={`text-[7px] font-bold px-1 py-0.5 rounded ${
                      triggerOperator === 'OR' 
                        ? 'bg-blue-500 text-white' 
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    OU
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      data.onOperatorChange?.('AND')
                    }}
                    className={`text-[7px] font-bold px-1 py-0.5 rounded ${
                      triggerOperator === 'AND' 
                        ? 'bg-blue-500 text-white' 
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    E
                  </button>
                </div>
              </div>
            )}
                   </div>
          ))}
        </div>
      )}

      {/* Botão Adicionar Gatilho */}
      <button
        onClick={data.onAddTrigger}
        className="w-full flex items-center justify-center gap-0.5 px-1.5 py-1 bg-white border border-dashed border-blue-400 text-blue-600 rounded text-[8px] hover:bg-blue-50 transition-colors font-medium mb-1.5"
      >
        <Plus className="w-2.5 h-2.5" />
        Adicionar gatilho
      </button>

      {/* Info adicional com bolinha arrastável à direita */}
      <div className="relative flex items-center justify-end gap-1 mb-1.5 pr-2">
        <span className={`text-[7px] ${hasTriggers ? 'text-gray-600' : 'text-gray-300'}`}>
          Quando ocorrer, então
        </span>
        
        {/* Handle arrastável (bolinha) - metade fora do card */}
        <Handle
          type="source"
          position={Position.Right}
          id="trigger-output"
          isConnectable={hasTriggers}
          className={`absolute -right-1.5 w-3 h-3 rounded-full !border-2 !border-white ${
            hasTriggers 
              ? '!bg-blue-500 hover:!bg-blue-600 cursor-pointer' 
              : '!bg-gray-300 cursor-not-allowed'
          }`}
          style={{ 
            top: '50%',
            transform: 'translateY(-50%)'
          }}
        />
      </div>

      {/* Estatísticas */}
      <div className="flex items-center justify-between pt-1.5 border-t border-gray-100">
        <div className="text-center flex-1">
          <div className="text-xs font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Sucessos</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-xs font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Alertas</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-xs font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Erros</div>
        </div>
      </div>
    </div>
  )
}

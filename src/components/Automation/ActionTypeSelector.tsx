// =====================================================
// COMPONENT: ACTION TYPE SELECTOR
// Data: 18/03/2026
// Objetivo: Seletor de tipos de ação (estilo Datacraz)
// =====================================================

import { 
  Plus, Edit, Tag, Minus, UserPlus, 
  ArrowRight, Trophy, XCircle 
} from 'lucide-react'

export interface ActionType {
  id: 'add_tag' | 'remove_tag' | 'assign_owner' | 'move_opportunity' | 'win_opportunity' | 'lose_opportunity' | 'create_opportunity' | 'update_lead'
  label: string
  icon: React.ReactNode
  description?: string
}

export const ACTION_TYPES: ActionType[] = [
  {
    id: 'add_tag',
    label: 'Adicionar Tag',
    icon: <Tag className="w-4 h-4" />,
    description: 'Adicione uma tag ao lead'
  },
  {
    id: 'remove_tag',
    label: 'Remover Tag',
    icon: <Minus className="w-4 h-4" />,
    description: 'Remova uma tag do lead'
  },
  {
    id: 'assign_owner',
    label: 'Atribuir Responsável',
    icon: <UserPlus className="w-4 h-4" />,
    description: 'Atribua um responsável ao lead'
  },
  {
    id: 'move_opportunity',
    label: 'Mover Oportunidade',
    icon: <ArrowRight className="w-4 h-4" />,
    description: 'Mova oportunidade para outra etapa'
  },
  {
    id: 'win_opportunity',
    label: 'Ganhar Oportunidade',
    icon: <Trophy className="w-4 h-4" />,
    description: 'Marque oportunidade como ganha'
  },
  {
    id: 'lose_opportunity',
    label: 'Perder Oportunidade',
    icon: <XCircle className="w-4 h-4" />,
    description: 'Marque oportunidade como perdida'
  },
  {
    id: 'create_opportunity',
    label: 'Criar Oportunidade',
    icon: <Plus className="w-4 h-4" />,
    description: 'Crie uma nova oportunidade'
  },
  {
    id: 'update_lead',
    label: 'Atualizar Lead',
    icon: <Edit className="w-4 h-4" />,
    description: 'Atualize dados do lead'
  }
]

interface ActionTypeSelectorProps {
  onSelectType: (typeId: ActionType['id']) => void
}

export default function ActionTypeSelector({ onSelectType }: ActionTypeSelectorProps) {
  return (
    <div className="space-y-1">
      {ACTION_TYPES.map((type) => (
        <button
          key={type.id}
          onClick={() => onSelectType(type.id)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
        >
          <div className="text-blue-600">{type.icon}</div>
          <div className="flex-1">
            <div className="font-medium text-gray-900">{type.label}</div>
            {type.description && (
              <div className="text-xs text-gray-500 mt-0.5">{type.description}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

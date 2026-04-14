// =====================================================
// COMPONENT: ACTION TYPE SELECTOR
// Data: 18/03/2026
// Objetivo: Seletor de tipos de ação (estilo Datacraz)
// =====================================================

import { 
  Plus, Edit, Tag, Minus, UserPlus, 
  ArrowRight, Trophy, XCircle, User, Briefcase, Settings, Webhook, 
  Calendar, CalendarCheck, CalendarX, CalendarClock, Bell, Zap, Shuffle
} from 'lucide-react'

export interface ActionType {
  id: 'add_tag' | 'remove_tag' | 'assign_owner' | 'distribute_lead' | 'move_opportunity' | 'win_opportunity' | 'lose_opportunity' | 'create_opportunity' | 'update_lead' | 'set_custom_field' | 'send_webhook' | 'create_activity' | 'update_activity' | 'complete_activity' | 'cancel_activity' | 'reschedule_activity' | 'send_notification' | 'trigger_automation'
  label: string
  icon: React.ReactNode
  description?: string
  category: 'lead' | 'opportunity' | 'integration' | 'activity' | 'system'
  /** Quando true: exibido na UI mas desabilitado — backend ainda não implementado */
  comingSoon?: boolean
}

export interface ActionCategory {
  id: 'lead' | 'opportunity' | 'integration' | 'activity' | 'system'
  label: string
  icon: React.ReactNode
}

export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    id: 'lead',
    label: 'Lead',
    icon: <User className="w-4 h-4" />
  },
  {
    id: 'opportunity',
    label: 'Oportunidade',
    icon: <Briefcase className="w-4 h-4" />
  },
  {
    id: 'integration',
    label: 'Integrações',
    icon: <Webhook className="w-4 h-4" />
  },
  {
    id: 'activity',
    label: 'Atividades',
    icon: <Calendar className="w-4 h-4" />
  },
  {
    id: 'system',
    label: 'Sistema',
    icon: <Settings className="w-4 h-4" />
  }
]

export const ACTION_TYPES: ActionType[] = [
  {
    id: 'add_tag',
    label: 'Adicionar Tag',
    icon: <Tag className="w-4 h-4" />,
    description: 'Adicione uma tag ao lead',
    category: 'lead'
  },
  {
    id: 'remove_tag',
    label: 'Remover Tag',
    icon: <Minus className="w-4 h-4" />,
    description: 'Remova uma tag do lead',
    category: 'lead'
  },
  {
    id: 'assign_owner',
    label: 'Atribuir Responsável',
    icon: <UserPlus className="w-4 h-4" />,
    description: 'Atribua um responsável ao lead',
    category: 'lead'
  },
  {
    id: 'distribute_lead',
    label: 'Distribuir Lead',
    icon: <Shuffle className="w-4 h-4" />,
    description: 'Use o nó "Distribuir Lead" no canvas',
    category: 'lead',
    comingSoon: true
  },
  {
    id: 'update_lead',
    label: 'Atualizar Lead',
    icon: <Edit className="w-4 h-4" />,
    description: 'Atualize dados do lead',
    category: 'lead'
  },
  {
    id: 'set_custom_field',
    label: 'Definir Campo Personalizado',
    icon: <Settings className="w-4 h-4" />,
    description: 'Defina um campo personalizado do lead',
    category: 'lead'
  },
  {
    id: 'create_opportunity',
    label: 'Criar Oportunidade',
    icon: <Plus className="w-4 h-4" />,
    description: 'Crie uma nova oportunidade',
    category: 'opportunity'
  },
  {
    id: 'move_opportunity',
    label: 'Mover Oportunidade',
    icon: <ArrowRight className="w-4 h-4" />,
    description: 'Mova oportunidade para outra etapa',
    category: 'opportunity'
  },
  {
    id: 'win_opportunity',
    label: 'Ganhar Oportunidade',
    icon: <Trophy className="w-4 h-4" />,
    description: 'Marque oportunidade como ganha',
    category: 'opportunity'
  },
  {
    id: 'lose_opportunity',
    label: 'Perder Oportunidade',
    icon: <XCircle className="w-4 h-4" />,
    description: 'Marque oportunidade como perdida',
    category: 'opportunity'
  },
  {
    id: 'send_webhook',
    label: 'Disparar Webhook',
    icon: <Webhook className="w-4 h-4" />,
    description: 'Envie dados para URL externa',
    category: 'integration',
    comingSoon: true
  },
  {
    id: 'create_activity',
    label: 'Criar Atividade',
    icon: <Calendar className="w-4 h-4" />,
    description: 'Agende uma nova atividade',
    category: 'activity',
    comingSoon: true
  },
  {
    id: 'update_activity',
    label: 'Atualizar Atividade',
    icon: <Edit className="w-4 h-4" />,
    description: 'Atualize atividades existentes',
    category: 'activity',
    comingSoon: true
  },
  {
    id: 'complete_activity',
    label: 'Concluir Atividade',
    icon: <CalendarCheck className="w-4 h-4" />,
    description: 'Marque atividades como concluídas',
    category: 'activity',
    comingSoon: true
  },
  {
    id: 'cancel_activity',
    label: 'Cancelar Atividade',
    icon: <CalendarX className="w-4 h-4" />,
    description: 'Cancele atividades pendentes',
    category: 'activity',
    comingSoon: true
  },
  {
    id: 'reschedule_activity',
    label: 'Reagendar Atividade',
    icon: <CalendarClock className="w-4 h-4" />,
    description: 'Reagende atividades para nova data',
    category: 'activity',
    comingSoon: true
  },
  {
    id: 'send_notification',
    label: 'Enviar Notificação',
    icon: <Bell className="w-4 h-4" />,
    description: 'Notifique usuários sobre eventos',
    category: 'system',
    comingSoon: true
  },
  {
    id: 'trigger_automation',
    label: 'Iniciar Outra Automação',
    icon: <Zap className="w-4 h-4" />,
    description: 'Dispare outro fluxo de automação',
    category: 'system',
    comingSoon: true
  }
]

interface ActionTypeSelectorProps {
  onSelectType: (typeId: ActionType['id']) => void
}

export default function ActionTypeSelector({ onSelectType }: ActionTypeSelectorProps) {
  return (
    <div className="space-y-4">
      {ACTION_CATEGORIES.map((category) => {
        const categoryActions = ACTION_TYPES.filter(action => action.category === category.id)
        
        return (
          <div key={category.id}>
            <div className="flex items-center gap-2 px-2 py-2 mb-2">
              <div className="text-gray-600">{category.icon}</div>
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {category.label}
              </h4>
            </div>
            <div className="space-y-1">
              {categoryActions.map((type) => (
                <button
                  key={type.id}
                  onClick={() => !type.comingSoon && onSelectType(type.id)}
                  disabled={type.comingSoon}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                    type.comingSoon
                      ? 'opacity-50 cursor-not-allowed bg-gray-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className={type.comingSoon ? 'text-gray-400' : 'text-blue-600'}>
                    {type.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${type.comingSoon ? 'text-gray-400' : 'text-gray-900'}`}>
                        {type.label}
                      </span>
                      {type.comingSoon && (
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-none">
                          Em breve
                        </span>
                      )}
                    </div>
                    {type.description && (
                      <div className="text-xs text-gray-400 mt-0.5">{type.description}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

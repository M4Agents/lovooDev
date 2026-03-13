// =====================================================
// DATA: FLOW TEMPLATES
// Data: 13/03/2026
// Objetivo: Templates prontos de fluxos de automação
// FASE 6.4 - Interface Avançada
// =====================================================

import { Node, Edge } from 'reactflow'

export interface FlowTemplate {
  id: string
  name: string
  description: string
  category: 'vendas' | 'atendimento' | 'marketing' | 'suporte'
  nodes: Node[]
  edges: Edge[]
  icon: string
}

export const flowTemplates: FlowTemplate[] = [
  // Template 1: Boas-vindas automáticas
  {
    id: 'welcome-message',
    name: 'Boas-vindas Automáticas',
    description: 'Envia mensagem de boas-vindas quando um novo lead é criado',
    category: 'atendimento',
    icon: '👋',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 100, y: 100 },
        data: {
          label: 'Novo Lead',
          config: {
            triggerType: 'lead.created'
          }
        }
      },
      {
        id: 'message-1',
        type: 'message',
        position: { x: 100, y: 250 },
        data: {
          label: 'Mensagem de Boas-vindas',
          config: {
            message: 'Olá {nome}! 👋\n\nSeja bem-vindo(a)! Obrigado por entrar em contato.\n\nEm breve um de nossos consultores entrará em contato com você.',
            useVariables: true
          }
        }
      },
      {
        id: 'action-1',
        type: 'action',
        position: { x: 100, y: 400 },
        data: {
          label: 'Adicionar Tag',
          config: {
            actionType: 'add_tag',
            tagName: 'Novo Lead'
          }
        }
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 550 },
        data: {
          label: 'Fim'
        }
      }
    ],
    edges: [
      { id: 'e1-2', source: 'trigger-1', target: 'message-1' },
      { id: 'e2-3', source: 'message-1', target: 'action-1' },
      { id: 'e3-4', source: 'action-1', target: 'end-1' }
    ]
  },

  // Template 2: Follow-up após 24h
  {
    id: 'followup-24h',
    name: 'Follow-up 24 horas',
    description: 'Envia mensagem de follow-up 24 horas após primeiro contato',
    category: 'vendas',
    icon: '⏰',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 100, y: 100 },
        data: {
          label: 'Mensagem Recebida',
          config: {
            triggerType: 'message.received'
          }
        }
      },
      {
        id: 'delay-1',
        type: 'delay',
        position: { x: 100, y: 250 },
        data: {
          label: 'Aguardar 24h',
          config: {
            duration: 24,
            unit: 'hours',
            businessHoursOnly: true
          }
        }
      },
      {
        id: 'message-1',
        type: 'message',
        position: { x: 100, y: 400 },
        data: {
          label: 'Follow-up',
          config: {
            message: 'Olá {nome}! 😊\n\nEstou retornando para saber se você teve alguma dúvida sobre nossa proposta.\n\nEstou à disposição para ajudar!',
            useVariables: true
          }
        }
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 550 },
        data: {
          label: 'Fim'
        }
      }
    ],
    edges: [
      { id: 'e1-2', source: 'trigger-1', target: 'delay-1' },
      { id: 'e2-3', source: 'delay-1', target: 'message-1' },
      { id: 'e3-4', source: 'message-1', target: 'end-1' }
    ]
  },

  // Template 3: Qualificação de Lead
  {
    id: 'lead-qualification',
    name: 'Qualificação de Lead',
    description: 'Qualifica lead e cria oportunidade se tiver empresa',
    category: 'vendas',
    icon: '🎯',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 100, y: 100 },
        data: {
          label: 'Novo Lead',
          config: {
            triggerType: 'lead.created'
          }
        }
      },
      {
        id: 'condition-1',
        type: 'condition',
        position: { x: 100, y: 250 },
        data: {
          label: 'Tem Empresa?',
          config: {
            field: 'company',
            operator: 'is_not_empty'
          }
        }
      },
      {
        id: 'action-1',
        type: 'action',
        position: { x: 300, y: 400 },
        data: {
          label: 'Criar Oportunidade',
          config: {
            actionType: 'create_opportunity',
            title: 'Nova Oportunidade - {nome}'
          }
        }
      },
      {
        id: 'action-2',
        type: 'action',
        position: { x: 300, y: 550 },
        data: {
          label: 'Tag: Lead Qualificado',
          config: {
            actionType: 'add_tag',
            tagName: 'Lead Qualificado'
          }
        }
      },
      {
        id: 'action-3',
        type: 'action',
        position: { x: -100, y: 400 },
        data: {
          label: 'Tag: Sem Empresa',
          config: {
            actionType: 'add_tag',
            tagName: 'Sem Empresa'
          }
        }
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 700 },
        data: {
          label: 'Fim'
        }
      }
    ],
    edges: [
      { id: 'e1-2', source: 'trigger-1', target: 'condition-1' },
      { id: 'e2-3', source: 'condition-1', target: 'action-1', sourceHandle: 'true' },
      { id: 'e2-4', source: 'condition-1', target: 'action-3', sourceHandle: 'false' },
      { id: 'e3-5', source: 'action-1', target: 'action-2' },
      { id: 'e4-6', source: 'action-2', target: 'end-1' },
      { id: 'e5-6', source: 'action-3', target: 'end-1' }
    ]
  },

  // Template 4: Nutrição de Lead
  {
    id: 'lead-nurturing',
    name: 'Nutrição de Lead (3 dias)',
    description: 'Sequência de 3 mensagens ao longo de 3 dias',
    category: 'marketing',
    icon: '📧',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 100, y: 100 },
        data: {
          label: 'Tag Adicionada',
          config: {
            triggerType: 'tag.added',
            tagName: 'Nutrição'
          }
        }
      },
      {
        id: 'message-1',
        type: 'message',
        position: { x: 100, y: 250 },
        data: {
          label: 'Mensagem 1',
          config: {
            message: 'Olá {nome}! 👋\n\nVamos começar nossa jornada juntos!\n\nHoje vou te mostrar como podemos ajudar sua empresa.',
            useVariables: true
          }
        }
      },
      {
        id: 'delay-1',
        type: 'delay',
        position: { x: 100, y: 400 },
        data: {
          label: 'Aguardar 1 dia',
          config: {
            duration: 1,
            unit: 'days',
            businessHoursOnly: true
          }
        }
      },
      {
        id: 'message-2',
        type: 'message',
        position: { x: 100, y: 550 },
        data: {
          label: 'Mensagem 2',
          config: {
            message: 'Oi {nome}! 😊\n\nHoje quero compartilhar um case de sucesso com você...',
            useVariables: true
          }
        }
      },
      {
        id: 'delay-2',
        type: 'delay',
        position: { x: 100, y: 700 },
        data: {
          label: 'Aguardar 2 dias',
          config: {
            duration: 2,
            unit: 'days',
            businessHoursOnly: true
          }
        }
      },
      {
        id: 'message-3',
        type: 'message',
        position: { x: 100, y: 850 },
        data: {
          label: 'Mensagem 3',
          config: {
            message: 'Olá {nome}! 🎉\n\nQue tal agendar uma conversa para conhecer melhor sua necessidade?',
            useVariables: true
          }
        }
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 1000 },
        data: {
          label: 'Fim'
        }
      }
    ],
    edges: [
      { id: 'e1-2', source: 'trigger-1', target: 'message-1' },
      { id: 'e2-3', source: 'message-1', target: 'delay-1' },
      { id: 'e3-4', source: 'delay-1', target: 'message-2' },
      { id: 'e4-5', source: 'message-2', target: 'delay-2' },
      { id: 'e5-6', source: 'delay-2', target: 'message-3' },
      { id: 'e6-7', source: 'message-3', target: 'end-1' }
    ]
  }
]

/**
 * Busca template por ID
 */
export function getTemplateById(id: string): FlowTemplate | undefined {
  return flowTemplates.find(t => t.id === id)
}

/**
 * Busca templates por categoria
 */
export function getTemplatesByCategory(category: string): FlowTemplate[] {
  return flowTemplates.filter(t => t.category === category)
}

// =====================================================
// HOOK: USE VARIABLES - Gerenciar variáveis disponíveis
// Data: 17/03/2026
// Objetivo: Buscar e organizar variáveis para autocomplete
// =====================================================

import { useState, useEffect } from 'react'
import { api } from '../services/api'

export interface Variable {
  key: string
  label: string
  category: 'lead' | 'oportunidade' | 'empresa' | 'custom' | 'sistema' | 'nuvemshop'
  description?: string
}

interface UseVariablesOptions {
  /** Se true, inclui variáveis da integração Nuvemshop (apenas para empresas que já conectaram) */
  hasNuvemshopIntegration?: boolean
  /**
   * Tipo do gatilho ativo no editor.
   * Quando informado e é um gatilho nuvemshop.*, filtra as variáveis NS para
   * exibir apenas as que serão populadas em runtime naquele contexto.
   * Quando ausente ou não é nuvemshop.*, retorna todas as variáveis NS disponíveis.
   */
  activeTriggerType?: string
}

interface UseVariablesReturn {
  variables: Variable[]
  loading: boolean
  error: string | null
}

/**
 * Hook para buscar todas as variáveis disponíveis para uso em mensagens.
 * Inclui: campos de lead, empresa, campos personalizados, variáveis de sistema
 * e (condicionalmente) variáveis de integração Nuvemshop.
 *
 * @param companyId UUID da empresa
 * @param options.hasNuvemshopIntegration true se a empresa já conectou Nuvemshop (active ou disconnected)
 */
export function useVariables(companyId: string, options: UseVariablesOptions = {}): UseVariablesReturn {
  const [variables, setVariables] = useState<Variable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { hasNuvemshopIntegration = false, activeTriggerType } = options

  useEffect(() => {
    const nuvemshopVars = hasNuvemshopIntegration
      ? getNuvemshopVariables(activeTriggerType)
      : []

    if (!companyId) {
      setVariables([...getStaticVariables(), ...nuvemshopVars])
      setLoading(false)
      return
    }

    const fetchVariables = async () => {
      try {
        setLoading(true)
        setError(null)

        const customFields = await api.getCustomFields(companyId)

        const allVariables = [
          ...getStaticVariables(),
          ...customFields.map(field => ({
            key: `custom.${field.field_name}`,
            label: field.field_label,
            category: 'custom' as const,
            description: `Campo personalizado: ${field.field_label}`
          })),
          // Variáveis Nuvemshop filtradas pelo trigger ativo
          ...nuvemshopVars,
        ]

        setVariables(allVariables)
      } catch (err) {
        console.error('Erro ao buscar variáveis:', err)
        setError(err instanceof Error ? err.message : 'Erro ao carregar variáveis')
        setVariables([...getStaticVariables(), ...nuvemshopVars])
      } finally {
        setLoading(false)
      }
    }

    fetchVariables()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, hasNuvemshopIntegration, activeTriggerType])

  return { variables, loading, error }
}

/**
 * Retorna variáveis estáticas (lead, empresa, sistema)
 */
function getStaticVariables(): Variable[] {
  return [
    // VARIÁVEIS DE LEAD
    {
      key: 'lead.nome',
      label: 'Nome do Lead',
      category: 'lead',
      description: 'Nome completo do lead'
    },
    {
      key: 'lead.email',
      label: 'Email',
      category: 'lead',
      description: 'Endereço de email do lead'
    },
    {
      key: 'lead.telefone',
      label: 'Telefone',
      category: 'lead',
      description: 'Número de telefone do lead'
    },
    {
      key: 'lead.empresa',
      label: 'Empresa do Lead',
      category: 'lead',
      description: 'Nome da empresa onde o lead trabalha'
    },
    {
      key: 'lead.status',
      label: 'Status',
      category: 'lead',
      description: 'Status atual do lead (novo, contato, negociação, etc)'
    },
    {
      key: 'lead.origem',
      label: 'Origem',
      category: 'lead',
      description: 'Origem do lead (WhatsApp, site, etc)'
    },

    // VARIÁVEIS DE OPORTUNIDADE
    {
      key: 'oportunidade.titulo',
      label: 'Título da Oportunidade',
      category: 'oportunidade',
      description: 'Título/nome da oportunidade vinculada'
    },
    {
      key: 'oportunidade.valor',
      label: 'Valor da Oportunidade',
      category: 'oportunidade',
      description: 'Valor total formatado (ex: R$ 1.500,00)'
    },
    {
      key: 'oportunidade.etapa',
      label: 'Etapa Atual',
      category: 'oportunidade',
      description: 'Nome da etapa atual no funil'
    },
    {
      key: 'oportunidade.status',
      label: 'Status da Oportunidade',
      category: 'oportunidade',
      description: 'Status atual (Aberta, Ganha, Perdida)'
    },
    {
      key: 'oportunidade.probabilidade',
      label: 'Probabilidade (%)',
      category: 'oportunidade',
      description: 'Probabilidade de fechamento (ex: 75%)'
    },
    {
      key: 'oportunidade.previsao',
      label: 'Previsão de Fechamento',
      category: 'oportunidade',
      description: 'Data prevista de fechamento (DD/MM/AAAA)'
    },
    {
      key: 'oportunidade.descricao',
      label: 'Descrição da Oportunidade',
      category: 'oportunidade',
      description: 'Descrição detalhada da oportunidade'
    },

    // VARIÁVEIS DE EMPRESA
    {
      key: 'empresa.nome',
      label: 'Nome da Empresa',
      category: 'empresa',
      description: 'Nome da sua empresa'
    },
    {
      key: 'empresa.telefone',
      label: 'Telefone da Empresa',
      category: 'empresa',
      description: 'Telefone de contato da empresa'
    },
    {
      key: 'empresa.email',
      label: 'Email da Empresa',
      category: 'empresa',
      description: 'Email de contato da empresa'
    },
    {
      key: 'empresa.site',
      label: 'Site da Empresa',
      category: 'empresa',
      description: 'Website da empresa'
    },
    {
      key: 'empresa.endereco',
      label: 'Endereço da Empresa',
      category: 'empresa',
      description: 'Endereço completo da empresa'
    },

    // VARIÁVEIS DE SISTEMA
    {
      key: 'data.hoje',
      label: 'Data de Hoje',
      category: 'sistema',
      description: 'Data atual (formato: DD/MM/YYYY)'
    },
    {
      key: 'data.hora',
      label: 'Hora Atual',
      category: 'sistema',
      description: 'Hora atual (formato: HH:MM)'
    },
    {
      key: 'usuario.nome',
      label: 'Nome do Usuário',
      category: 'sistema',
      description: 'Nome do usuário responsável'
    }
  ]
}

// Variáveis disponíveis por família de trigger Nuvemshop
const NS_VARS_BASE: Variable[] = [
  {
    key:         'nuvemshop.customer_id',
    label:       'ID do Cliente (NS)',
    category:    'nuvemshop',
    description: 'Identificador único do cliente na Nuvemshop',
  },
  {
    key:         'nuvemshop.store_id',
    label:       'ID da Loja (NS)',
    category:    'nuvemshop',
    description: 'Identificador da loja Nuvemshop vinculada',
  },
]

const NS_VARS_CHECKOUT: Variable[] = [
  {
    key:         'nuvemshop.checkout_id',
    label:       'ID do Carrinho Abandonado (NS)',
    category:    'nuvemshop',
    description: 'Identificador do carrinho abandonado na Nuvemshop',
  },
  {
    key:         'nuvemshop.cart_total',
    label:       'Valor do Carrinho (NS)',
    category:    'nuvemshop',
    description: 'Valor total do carrinho abandonado',
  },
]

const NS_VARS_ORDER: Variable[] = [
  {
    key:         'nuvemshop.order_id',
    label:       'ID do Pedido (NS)',
    category:    'nuvemshop',
    description: 'Identificador do pedido na Nuvemshop',
  },
  {
    key:         'nuvemshop.order_status',
    label:       'Status do Pedido (NS)',
    category:    'nuvemshop',
    description: 'Status atual do pedido (open, closed, cancelled)',
  },
  {
    key:         'nuvemshop.payment_status',
    label:       'Status de Pagamento (NS)',
    category:    'nuvemshop',
    description: 'Status do pagamento do pedido',
  },
]

const NS_VARS_FULFILLMENT: Variable[] = [
  {
    key:         'nuvemshop.tracking_number',
    label:       'Código de Rastreio (NS)',
    category:    'nuvemshop',
    description: 'Código de rastreio do envio',
  },
  {
    key:         'nuvemshop.shipping_carrier',
    label:       'Transportadora (NS)',
    category:    'nuvemshop',
    description: 'Transportadora responsável pelo envio',
  },
]

/**
 * Retorna variáveis específicas da integração Nuvemshop.
 * Só deve ser incluído para empresas que já conectaram (hasNuvemshopIntegration = true).
 *
 * Quando `activeTriggerType` é um gatilho nuvemshop.*, filtra para exibir apenas
 * variáveis que serão populadas em runtime — evita sugerir tracking_number em checkout,
 * ou checkout_id em pedidos.
 *
 * @param activeTriggerType Tipo do gatilho ativo no editor (opcional)
 */
export function getNuvemshopVariables(activeTriggerType?: string): Variable[] {
  // Sem filtro: retornar todas as variáveis (context desconhecido)
  if (!activeTriggerType || !activeTriggerType.startsWith('nuvemshop.')) {
    return [
      ...NS_VARS_BASE,
      ...NS_VARS_CHECKOUT,
      ...NS_VARS_ORDER,
      ...NS_VARS_FULFILLMENT,
    ]
  }

  // checkout_abandoned → customer_id, store_id, checkout_id, cart_total
  if (activeTriggerType === 'nuvemshop.checkout_abandoned') {
    return [...NS_VARS_BASE, ...NS_VARS_CHECKOUT]
  }

  // order_fulfilled / order_packed → + tracking_number, shipping_carrier
  if (activeTriggerType === 'nuvemshop.order_fulfilled' || activeTriggerType === 'nuvemshop.order_packed') {
    return [...NS_VARS_BASE, ...NS_VARS_ORDER, ...NS_VARS_FULFILLMENT]
  }

  // order_created / order_paid / order_cancelled → customer_id, store_id, order_id, status, payment_status
  return [...NS_VARS_BASE, ...NS_VARS_ORDER]
}

/**
 * Retorna ícone para cada categoria
 */
export function getCategoryIcon(category: Variable['category']): string {
  const icons: Record<Variable['category'], string> = {
    lead:        '📊',
    oportunidade:'💼',
    empresa:     '🏢',
    custom:      '⚙️',
    sistema:     '📅',
    nuvemshop:   '🛒',
  }
  return icons[category] || '📝'
}

/**
 * Retorna label para cada categoria
 */
export function getCategoryLabel(category: Variable['category']): string {
  const labels: Record<Variable['category'], string> = {
    lead:        'LEAD',
    oportunidade:'OPORTUNIDADE',
    empresa:     'EMPRESA',
    custom:      'CAMPOS PERSONALIZADOS',
    sistema:     'SISTEMA',
    nuvemshop:   'NUVEMSHOP',
  }
  return labels[category] || 'OUTROS'
}

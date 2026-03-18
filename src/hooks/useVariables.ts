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
  category: 'lead' | 'empresa' | 'custom' | 'sistema'
  description?: string
}

interface UseVariablesReturn {
  variables: Variable[]
  loading: boolean
  error: string | null
}

/**
 * Hook para buscar todas as variáveis disponíveis para uso em mensagens
 * Inclui: campos de lead, empresa, campos personalizados e variáveis de sistema
 */
export function useVariables(companyId: string): UseVariablesReturn {
  const [variables, setVariables] = useState<Variable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) {
      setVariables(getStaticVariables())
      setLoading(false)
      return
    }

    const fetchVariables = async () => {
      try {
        setLoading(true)
        setError(null)

        // Buscar campos personalizados da empresa
        const customFields = await api.getCustomFields(companyId)

        // Combinar variáveis estáticas com campos personalizados
        const allVariables = [
          ...getStaticVariables(),
          ...customFields.map(field => ({
            key: `custom.${field.field_name}`,
            label: field.field_label,
            category: 'custom' as const,
            description: `Campo personalizado: ${field.field_label}`
          }))
        ]

        setVariables(allVariables)
      } catch (err) {
        console.error('Erro ao buscar variáveis:', err)
        setError(err instanceof Error ? err.message : 'Erro ao carregar variáveis')
        // Em caso de erro, usar apenas variáveis estáticas
        setVariables(getStaticVariables())
      } finally {
        setLoading(false)
      }
    }

    fetchVariables()
  }, [companyId])

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

/**
 * Retorna ícone para cada categoria
 */
export function getCategoryIcon(category: Variable['category']): string {
  const icons = {
    lead: '📊',
    empresa: '🏢',
    custom: '⚙️',
    sistema: '📅'
  }
  return icons[category] || '📝'
}

/**
 * Retorna label para cada categoria
 */
export function getCategoryLabel(category: Variable['category']): string {
  const labels = {
    lead: 'LEAD',
    empresa: 'EMPRESA',
    custom: 'CAMPOS PERSONALIZADOS',
    sistema: 'SISTEMA'
  }
  return labels[category] || 'OUTROS'
}

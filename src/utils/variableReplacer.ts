// =====================================================
// VARIABLE REPLACER - Substituir variáveis por valores reais
// Data: 17/03/2026
// Objetivo: Processar variáveis em mensagens de automação
// =====================================================

/**
 * Substitui variáveis em um texto pelos valores reais
 * 
 * Suporta:
 * - {{lead.nome}} → Nome do lead
 * - {{empresa.nome}} → Nome da empresa
 * - {{custom.campo}} → Campo personalizado
 * - {{data.hoje}} → Data atual
 */
export function replaceVariables(
  text: string,
  context: {
    lead?: any
    company?: any
    customFields?: Record<string, any>
    user?: any
  }
): string {
  if (!text) return ''

  let result = text

  // Substituir variáveis de lead
  if (context.lead) {
    result = result
      .replace(/\{\{lead\.nome\}\}/g, context.lead.name || '')
      .replace(/\{\{lead\.email\}\}/g, context.lead.email || '')
      .replace(/\{\{lead\.telefone\}\}/g, context.lead.phone || '')
      .replace(/\{\{lead\.empresa\}\}/g, context.lead.company || '')
      .replace(/\{\{lead\.status\}\}/g, context.lead.status || '')
      .replace(/\{\{lead\.origem\}\}/g, context.lead.origin || '')
  }

  // Substituir variáveis de empresa
  if (context.company) {
    result = result
      .replace(/\{\{empresa\.nome\}\}/g, context.company.name || '')
      .replace(/\{\{empresa\.telefone\}\}/g, context.company.phone || '')
      .replace(/\{\{empresa\.email\}\}/g, context.company.email || '')
      .replace(/\{\{empresa\.site\}\}/g, context.company.website || '')
      .replace(/\{\{empresa\.endereco\}\}/g, context.company.address || '')
  }

  // Substituir campos personalizados
  if (context.customFields) {
    Object.entries(context.customFields).forEach(([fieldName, value]) => {
      const regex = new RegExp(`\\{\\{custom\\.${fieldName}\\}\\}`, 'g')
      result = result.replace(regex, String(value || ''))
    })
  }

  // Substituir variáveis de sistema
  const now = new Date()
  result = result
    .replace(/\{\{data\.hoje\}\}/g, now.toLocaleDateString('pt-BR'))
    .replace(/\{\{data\.hora\}\}/g, now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{usuario\.nome\}\}/g, context.user?.name || '')

  return result
}

/**
 * Extrai todas as variáveis usadas em um texto
 * Útil para validar se todas as variáveis necessárias estão disponíveis
 */
export function extractVariables(text: string): string[] {
  if (!text) return []

  const regex = /\{\{([^}]+)\}\}/g
  const matches = text.matchAll(regex)
  
  return Array.from(matches, m => m[1])
}

/**
 * Valida se todas as variáveis em um texto podem ser substituídas
 * Retorna array de variáveis que estão faltando
 */
export function validateVariables(
  text: string,
  availableVariables: string[]
): string[] {
  const usedVariables = extractVariables(text)
  const missingVariables: string[] = []

  usedVariables.forEach(variable => {
    if (!availableVariables.includes(variable)) {
      missingVariables.push(variable)
    }
  })

  return missingVariables
}

/**
 * Preview de como ficará o texto com variáveis substituídas
 * Usa valores de exemplo para demonstração
 */
export function previewWithVariables(text: string): string {
  const exampleContext = {
    lead: {
      name: 'João Silva',
      email: 'joao@exemplo.com',
      phone: '(11) 98765-4321',
      company: 'Empresa XYZ',
      status: 'Novo',
      origin: 'WhatsApp'
    },
    company: {
      name: 'Minha Empresa',
      phone: '(11) 3000-0000',
      email: 'contato@minhaempresa.com',
      website: 'www.minhaempresa.com',
      address: 'Rua Exemplo, 123 - São Paulo/SP'
    },
    customFields: {
      cpf: '123.456.789-00',
      data_nascimento: '01/01/1990',
      cargo: 'Gerente'
    },
    user: {
      name: 'Atendente'
    }
  }

  return replaceVariables(text, exampleContext)
}

// =====================================================
// UTILS: FLOW VALIDATION
// Data: 13/03/2026
// Objetivo: Validar fluxos de automação antes de salvar
// FASE 6.3 - Interface Avançada
// =====================================================

import { Node, Edge } from 'reactflow'

export interface ValidationError {
  nodeId?: string
  type: 'error' | 'warning'
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

/**
 * Valida um fluxo de automação completo
 */
export function validateFlow(nodes: Node[], edges: Edge[]): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  // 1. Verificar se tem pelo menos um nó
  if (nodes.length === 0) {
    errors.push({
      type: 'error',
      message: 'O fluxo deve ter pelo menos um bloco'
    })
    return { isValid: false, errors, warnings }
  }

  // 2. Verificar se tem um StartNode com triggers configurados
  const startNode = nodes.find(n => n.type === 'start')
  if (!startNode) {
    errors.push({
      type: 'error',
      message: 'O fluxo deve ter um nó inicial (Start)'
    })
  } else {
    // Verificar se o StartNode tem triggers configurados
    const triggers = startNode.data?.triggers || []
    if (triggers.length === 0) {
      errors.push({
        type: 'error',
        message: 'O fluxo deve ter pelo menos um gatilho configurado no nó inicial'
      })
    }
  }

  // 3. Verificar nós órfãos (sem conexões)
  nodes.forEach(node => {
    if (node.type === 'start') return // StartNode não precisa de entrada

    const hasIncoming = edges.some(e => e.target === node.id)
    const hasOutgoing = edges.some(e => e.source === node.id)

    if (!hasIncoming && node.type !== 'end') {
      warnings.push({
        nodeId: node.id,
        type: 'warning',
        message: `Bloco "${node.data.label}" não está conectado a nenhum bloco anterior`
      })
    }

    if (!hasOutgoing && node.type !== 'end') {
      warnings.push({
        nodeId: node.id,
        type: 'warning',
        message: `Bloco "${node.data.label}" não está conectado a nenhum bloco seguinte`
      })
    }
  })

  // 4. Verificar configurações obrigatórias
  nodes.forEach(node => {
    const config = node.data.config || {}

    switch (node.type) {
      case 'message':
        // Verificar se tem tipo de mensagem configurado
        if (!config.messageType) {
          errors.push({
            nodeId: node.id,
            type: 'error',
            message: `Bloco de mensagem "${node.data.label}" não tem tipo de mensagem configurado`
          })
        } else {
          // Validar configuração específica por tipo
          switch (config.messageType) {
            case 'text':
              if (!config.message || config.message.trim() === '') {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de mensagem "${node.data.label}" não tem mensagem configurada`
                })
              }
              break
            case 'user_input':
              if (!config.question || config.question.trim() === '') {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de entrada "${node.data.label}" não tem pergunta configurada`
                })
              }
              break
            case 'delay':
              if (!config.duration || config.duration <= 0) {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de atraso "${node.data.label}" não tem duração configurada`
                })
              }
              break
            case 'audio':
              if (!config.audioFile && !config.audioUrl) {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de áudio "${node.data.label}" não tem arquivo configurado`
                })
              }
              break
            case 'file':
              if (!config.file && !config.fileUrl) {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de arquivo "${node.data.label}" não tem arquivo configurado`
                })
              }
              break
            case 'dynamic_url':
              if (!config.url || config.url.trim() === '') {
                errors.push({
                  nodeId: node.id,
                  type: 'error',
                  message: `Bloco de URL dinâmica "${node.data.label}" não tem URL configurada`
                })
              }
              break
          }
        }
        break

      case 'condition':
        if (!config.field) {
          errors.push({
            nodeId: node.id,
            type: 'error',
            message: `Bloco de condição "${node.data.label}" não tem campo configurado`
          })
        }
        break

      case 'delay':
        if (!config.duration || config.duration <= 0) {
          errors.push({
            nodeId: node.id,
            type: 'error',
            message: `Bloco de delay "${node.data.label}" não tem duração configurada`
          })
        }
        break

      case 'action':
        if (!config.actionType) {
          errors.push({
            nodeId: node.id,
            type: 'error',
            message: `Bloco de ação "${node.data.label}" não tem tipo de ação configurado`
          })
        }
        break
    }
  })

  // 5. Verificar condições com múltiplas saídas
  nodes.forEach(node => {
    if (node.type === 'condition') {
      const outgoingEdges = edges.filter(e => e.source === node.id)
      const hasTruePath = outgoingEdges.some(e => e.sourceHandle === 'true')
      const hasFalsePath = outgoingEdges.some(e => e.sourceHandle === 'false')

      if (!hasTruePath) {
        warnings.push({
          nodeId: node.id,
          type: 'warning',
          message: `Condição "${node.data.label}" não tem caminho para "Verdadeiro"`
        })
      }

      if (!hasFalsePath) {
        warnings.push({
          nodeId: node.id,
          type: 'warning',
          message: `Condição "${node.data.label}" não tem caminho para "Falso"`
        })
      }
    }
  })

  // 6. Verificar loops infinitos
  const hasLoop = detectLoop(nodes, edges)
  if (hasLoop) {
    warnings.push({
      type: 'warning',
      message: 'O fluxo pode conter um loop infinito. Certifique-se de ter uma condição de saída.'
    })
  }

  // 7. Verificar se tem pelo menos um bloco End
  const hasEnd = nodes.some(n => n.type === 'end')
  if (!hasEnd) {
    warnings.push({
      type: 'warning',
      message: 'O fluxo não tem um bloco de finalização (End). Recomenda-se adicionar um.'
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Detecta loops no fluxo usando DFS
 */
function detectLoop(nodes: Node[], edges: Edge[]): boolean {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const outgoingEdges = edges.filter(e => e.source === nodeId)
    
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        if (dfs(edge.target)) {
          return true
        }
      } else if (recursionStack.has(edge.target)) {
        return true // Loop detectado
      }
    }

    recursionStack.delete(nodeId)
    return false
  }

  // Começar do trigger
  const triggerNode = nodes.find(n => n.type === 'trigger')
  if (triggerNode) {
    return dfs(triggerNode.id)
  }

  return false
}

/**
 * Formata erros e warnings para exibição
 */
export function formatValidationMessages(result: ValidationResult): string {
  const messages: string[] = []

  if (result.errors.length > 0) {
    messages.push('❌ ERROS:')
    result.errors.forEach(err => {
      messages.push(`  • ${err.message}`)
    })
  }

  if (result.warnings.length > 0) {
    if (messages.length > 0) messages.push('')
    messages.push('⚠️ AVISOS:')
    result.warnings.forEach(warn => {
      messages.push(`  • ${warn.message}`)
    })
  }

  return messages.join('\n')
}

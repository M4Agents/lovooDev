// =====================================================
// HOOK: USE UNDO/REDO
// Data: 13/03/2026
// Objetivo: Gerenciar histórico de undo/redo para o canvas
// FASE 6.1 - Interface Avançada
// =====================================================

import { useState, useCallback } from 'react'
import { Node, Edge } from 'reactflow'

interface HistoryState {
  nodes: Node[]
  edges: Edge[]
}

interface UseUndoRedoReturn {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  takeSnapshot: (nodes: Node[], edges: Edge[]) => void
  clear: () => void
}

export function useUndoRedo(
  initialNodes: Node[] = [],
  initialEdges: Edge[] = []
): UseUndoRedoReturn {
  const [history, setHistory] = useState<HistoryState[]>([
    { nodes: initialNodes, edges: initialEdges }
  ])
  const [currentIndex, setCurrentIndex] = useState(0)

  // Tirar snapshot do estado atual
  const takeSnapshot = useCallback((nodes: Node[], edges: Edge[]) => {
    setHistory((prev) => {
      // Remover estados futuros se estamos no meio do histórico
      const newHistory = prev.slice(0, currentIndex + 1)
      
      // Adicionar novo estado
      const newState = {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges))
      }
      
      // Limitar histórico a 50 estados
      const updatedHistory = [...newHistory, newState].slice(-50)
      
      return updatedHistory
    })
    
    setCurrentIndex((prev) => Math.min(prev + 1, 49))
  }, [currentIndex])

  // Desfazer
  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
    }
  }, [currentIndex])

  // Refazer
  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex((prev) => prev + 1)
    }
  }, [currentIndex, history.length])

  // Limpar histórico
  const clear = useCallback(() => {
    setHistory([{ nodes: [], edges: [] }])
    setCurrentIndex(0)
  }, [])

  return {
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
    undo,
    redo,
    takeSnapshot,
    clear
  }
}

// Hook para obter estado atual do histórico
export function useHistoryState(
  history: HistoryState[],
  currentIndex: number
): HistoryState {
  return history[currentIndex] || { nodes: [], edges: [] }
}

import { useState, useCallback } from 'react'
import { tagsApi } from '../services/tagsApi'
import type { Tag } from '../types/tags'

/**
 * Gerencia as tags de um lead específico.
 * Carregamento lazy via load(leadId) — nunca dispara no mount.
 * Mutações com update otimista + rollback em erro.
 *
 * Limitação conhecida: drift visual por concorrência remota
 * se outro usuário editar as mesmas tags simultaneamente.
 * Resolve-se no próximo boardRefresh natural (Realtime, filtro, navegação).
 */
export function useLeadTags() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (leadId: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await tagsApi.getLeadTags(leadId)
      setTags(data)
    } catch {
      setError('Erro ao carregar tags')
      setTags([])
    } finally {
      setLoading(false)
    }
  }, [])

  const addTag = useCallback(async (leadId: number, tag: Tag) => {
    let snapshot: Tag[] = []

    setTags(prev => {
      snapshot = prev
      // Guarda deduplicada: ignora se tag já está na lista
      if (prev.some(t => t.id === tag.id)) return prev
      return [...prev, tag]
    })

    setError(null)

    try {
      await tagsApi.addTagToLead(leadId, tag.id)
    } catch {
      // Rollback ao snapshot anterior à mutação otimista
      setTags(snapshot)
      setError('Erro ao adicionar tag')
    }
  }, [])

  const removeTag = useCallback(async (leadId: number, tagId: string) => {
    let snapshot: Tag[] = []

    setTags(prev => {
      snapshot = prev
      return prev.filter(t => t.id !== tagId)
    })

    setError(null)

    try {
      await tagsApi.removeTagFromLead(leadId, tagId)
    } catch {
      // Rollback ao snapshot anterior à mutação otimista
      setTags(snapshot)
      setError('Erro ao remover tag')
    }
  }, [])

  return { tags, loading, error, load, addTag, removeTag }
}

import { useState, useCallback } from 'react'
import { tagsApi } from '../services/tagsApi'
import { supabase } from '../lib/supabase'
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

      // Disparar automação backend (fire-and-forget — nunca bloqueia a UI)
      supabase.auth.getSession().then(({ data: sessionData }) => {
        const token = sessionData.session?.access_token
        if (!token || !tag.company_id) return

        fetch('/api/automation/trigger-event', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            event_type: 'tag.added',
            company_id: tag.company_id,
            data: {
              lead_id:  leadId,
              tag_id:   tag.id,
              tag_name: tag.name,
            },
          }),
        }).catch(err => console.error('[useLeadTags] automation trigger failed:', err))
      }).catch(() => { /* sem token — ignora silenciosamente */ })
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

    // Capturar dados da tag antes da remoção (snapshot já contém o objeto completo)
    const removedTag = snapshot.find(t => t.id === tagId)

    try {
      await tagsApi.removeTagFromLead(leadId, tagId)

      // Disparar automação backend (fire-and-forget — nunca bloqueia a UI)
      supabase.auth.getSession().then(({ data: sessionData }) => {
        const token = sessionData.session?.access_token
        if (!token || !removedTag?.company_id) return

        fetch('/api/automation/trigger-event', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            event_type: 'tag.removed',
            company_id: removedTag.company_id,
            data: {
              lead_id:  leadId,
              tag_id:   tagId,
              tag_name: removedTag.name,
            },
          }),
        }).catch(err => console.error('[useLeadTags] tag.removed trigger failed:', err))
      }).catch(() => { /* sem token — ignora silenciosamente */ })
    } catch {
      // Rollback ao snapshot anterior à mutação otimista
      setTags(snapshot)
      setError('Erro ao remover tag')
    }
  }, [])

  return { tags, loading, error, load, addTag, removeTag }
}

import { useState, useEffect } from 'react'
import { tagsApi } from '../services/tagsApi'
import type { Tag } from '../types/tags'

/**
 * Busca todas as tags ativas da empresa.
 * Compartilhado entre LeadTagsField e TagSelectorPopover.
 * Retorna estado seguro ({ tags: [], loading: false }) quando companyId ausente.
 */
export function useAvailableTags(companyId: string | undefined) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return

    let cancelled = false
    setLoading(true)

    tagsApi.getTags(companyId)
      .then(data => { if (!cancelled) setTags(data) })
      .catch(() => { if (!cancelled) setTags([]) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [companyId])

  return { tags, loading }
}

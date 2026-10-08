import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../../contexts/AuthContext'
import { dashboardApi } from '../../../services/dashboardApi'
import { tagsApi } from '../../../services/tagsApi'
import type { TagGroupDefinition } from '../../../types/dashboard'
import type { Tag } from '../../../types/tags'

interface Props {
  onClose: () => void
  onSaved: () => void
}

function newGroup(): TagGroupDefinition {
  return { id: crypto.randomUUID(), name: '', tag_ids: [] }
}

export function TagGroupsConfigModal({ onClose, onSaved }: Props) {
  const { t } = useTranslation('dashboard')
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const [groups, setGroups] = useState<TagGroupDefinition[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const [settings, available] = await Promise.all([
          dashboardApi.getTagGroups(companyId),
          tagsApi.getTags(companyId),
        ])
        if (cancelled) return
        setGroups(settings.data.groups ?? [])
        setTags(available)
      } catch (err: unknown) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t('commercialTagGroups.error'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, t])

  function update(index: number, next: TagGroupDefinition) {
    setGroups(current => current.map((group, i) => (i === index ? next : group)))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    const next = [...groups]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setGroups(next)
  }

  async function save() {
    if (!companyId) return
    const activeIds = new Set(tags.map(tag => tag.id))
    const hasMissing = groups.some(group => group.tag_ids.some(id => !activeIds.has(id)))
    if (hasMissing) { toast.error(t('commercialTagGroups.saveBlocked')); return }
    if (groups.some(group => !group.name.trim() || group.tag_ids.length === 0)) {
      toast.error(t('commercialTagGroups.needTag'))
      return
    }

    setSaving(true)
    try {
      await dashboardApi.saveTagGroups(companyId, {
        groups: groups.map(group => ({ ...group, name: group.name.trim() })),
      })
      toast.success(t('commercialTagGroups.saved'))
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('commercialTagGroups.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-gray-900">{t('commercialTagGroups.modalTitle')}</h3>
            <p className="text-xs text-gray-500">{t('commercialTagGroups.modalHint')}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg" aria-label={t('commercialTagGroups.cancel')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {loading && <p className="text-xs text-gray-400">{t('commercialTagGroups.loading')}</p>}
          {!loading && groups.map((group, index) => {
            const activeIds = new Set(tags.map(tag => tag.id))
            return (
              <div key={group.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <input
                  value={group.name}
                  maxLength={40}
                  onChange={event => update(index, { ...group, name: event.target.value })}
                  placeholder={t('commercialTagGroups.groupName')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                />
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => {
                    const checked = group.tag_ids.includes(tag.id)
                    return (
                      <label key={tag.id} className="flex items-center gap-1 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const tagIds = checked
                              ? group.tag_ids.filter(id => id !== tag.id)
                              : group.tag_ids.length >= 10 ? group.tag_ids : [...group.tag_ids, tag.id]
                            update(index, { ...group, tag_ids: tagIds })
                          }}
                        />
                        {tag.name}
                      </label>
                    )
                  })}
                  {group.tag_ids.filter(id => !activeIds.has(id)).map(id => (
                    <button
                      key={id}
                      type="button"
                      className="text-[11px] text-amber-700 underline"
                      onClick={() => update(index, { ...group, tag_ids: group.tag_ids.filter(tagId => tagId !== id) })}
                    >
                      {t('commercialTagGroups.missingTag')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 text-xs">
                  <button type="button" onClick={() => move(index, -1)} className="text-gray-500">{t('commercialTagGroups.moveUp')}</button>
                  <button type="button" onClick={() => move(index, 1)} className="text-gray-500">{t('commercialTagGroups.moveDown')}</button>
                  <button type="button" onClick={() => setGroups(current => current.filter((_, i) => i !== index))} className="text-rose-600">
                    {t('commercialTagGroups.remove')}
                  </button>
                </div>
              </div>
            )
          })}
          <button
            type="button"
            disabled={groups.length >= 8}
            onClick={() => {
              if (groups.length >= 8) { toast.error(t('commercialTagGroups.maxGroups')); return }
              setGroups(current => [...current, newGroup()])
            }}
            className="text-xs font-medium text-indigo-600 disabled:text-gray-300"
          >
            {t('commercialTagGroups.addGroup')}
          </button>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="text-xs text-gray-500 px-3 py-2">{t('commercialTagGroups.cancel')}</button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => { void save() }}
            className="text-xs font-medium text-white bg-indigo-600 rounded-lg px-3 py-2 disabled:opacity-50"
          >
            {saving ? t('commercialTagGroups.saving') : t('commercialTagGroups.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

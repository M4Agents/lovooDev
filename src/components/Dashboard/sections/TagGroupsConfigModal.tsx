import { useEffect, useMemo, useState } from 'react'
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

const MAX_GROUPS = 8
const MAX_TAGS_PER_GROUP = 10

function newGroup(): TagGroupDefinition {
  return { id: crypto.randomUUID(), name: '', tag_ids: [] }
}

export function TagGroupsConfigModal({ onClose, onSaved }: Props) {
  const { t } = useTranslation('dashboard')
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const [groups, setGroups] = useState<TagGroupDefinition[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagQuery, setTagQuery] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [tags],
  )

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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
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
                {group.tag_ids.filter(id => !activeIds.has(id)).map(id => (
                  <button
                    key={id}
                    type="button"
                    className="block text-[11px] text-amber-700 underline"
                    onClick={() => update(index, { ...group, tag_ids: group.tag_ids.filter(tagId => tagId !== id) })}
                  >
                    {t('commercialTagGroups.missingTag')}
                  </button>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    value={tagQuery[group.id] ?? ''}
                    onChange={event => setTagQuery(current => ({ ...current, [group.id]: event.target.value }))}
                    placeholder={t('commercialTagGroups.searchTags')}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                  />
                  <span className="text-[11px] text-gray-500 shrink-0">
                    {t('commercialTagGroups.selectedCount', { count: group.tag_ids.length, max: MAX_TAGS_PER_GROUP })}
                  </span>
                </div>
                <TagPickList
                  tags={sortedTags}
                  query={tagQuery[group.id] ?? ''}
                  selectedIds={group.tag_ids}
                  emptyLabel={t('commercialTagGroups.noTagMatch')}
                  onToggle={tagId => {
                    const checked = group.tag_ids.includes(tagId)
                    const tagIds = checked
                      ? group.tag_ids.filter(id => id !== tagId)
                      : group.tag_ids.length >= MAX_TAGS_PER_GROUP
                        ? group.tag_ids
                        : [...group.tag_ids, tagId]
                    update(index, { ...group, tag_ids: tagIds })
                  }}
                />
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
            disabled={groups.length >= MAX_GROUPS}
            onClick={() => {
              if (groups.length >= MAX_GROUPS) { toast.error(t('commercialTagGroups.maxGroups')); return }
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

function TagPickList({
  tags,
  query,
  selectedIds,
  emptyLabel,
  onToggle,
}: {
  tags: Tag[]
  query: string
  selectedIds: string[]
  emptyLabel: string
  onToggle: (tagId: string) => void
}) {
  const normalized = query.trim().toLocaleLowerCase()
  const visible = normalized
    ? tags.filter(tag => tag.name.toLocaleLowerCase().includes(normalized))
    : tags
  const atLimit = selectedIds.length >= MAX_TAGS_PER_GROUP

  return (
    <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-lg">
      {visible.length === 0 && normalized && (
        <p className="px-2 py-3 text-xs text-gray-400">{emptyLabel}</p>
      )}
      {visible.map(tag => {
        const checked = selectedIds.includes(tag.id)
        const disabled = atLimit && !checked
        return (
          <label
            key={tag.id}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm border-b border-gray-50 last:border-b-0 ${
              checked ? 'bg-indigo-50' : 'hover:bg-gray-50'
            } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              className="shrink-0"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(tag.id)}
            />
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
              style={{ backgroundColor: tag.color || '#9ca3af' }}
            />
            <span className="truncate text-gray-800">{tag.name}</span>
          </label>
        )
      })}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../../contexts/AuthContext'
import { dashboardApi } from '../../../services/dashboardApi'
import { tagsApi } from '../../../services/tagsApi'
import type { TagGroupDefinition, TagGroupSettings } from '../../../types/dashboard'
import type { Tag } from '../../../types/tags'
import { TagGroupBlockEditor } from './TagGroupBlockEditor'

interface Props {
  onClose: () => void
  onSaved: () => void
}

const MAX_GROUPS = 8

function newGroup(): TagGroupDefinition {
  return {
    id: crypto.randomUUID(),
    name: '',
    blocks: [{ id: crypto.randomUUID(), tag_ids: [] }],
  }
}

function isVersion2(data: { groups: unknown[] } | TagGroupSettings): data is TagGroupSettings {
  return 'version' in data && data.version === 2
}

export function TagGroupsConfigModal({ onClose, onSaved }: Props) {
  const { t } = useTranslation('dashboard')
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const [groups, setGroups] = useState<TagGroupDefinition[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagQuery, setTagQuery] = useState<Record<string, string>>({})
  const [expectedRevision, setExpectedRevision] = useState<number | null>(0)
  const [readable, setReadable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draftKept, setDraftKept] = useState(false)

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
        const canEdit = settings.meta.readable && (settings.data.groups.length === 0 || isVersion2(settings.data))
        setReadable(canEdit)
        setExpectedRevision(settings.meta.revision)
        setGroups(canEdit && isVersion2(settings.data) ? settings.data.groups : [])
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
    if (!companyId || expectedRevision === null || !readable) return
    const activeIds = new Set(tags.map(tag => tag.id))
    const hasMissing = groups.some(group =>
      group.blocks.some(block => block.tag_ids.some(id => !activeIds.has(id))),
    )
    if (hasMissing) { toast.error(t('commercialTagGroups.saveBlocked')); return }
    if (groups.some(group => !group.name.trim())) {
      toast.error(t('commercialTagGroups.needName'))
      return
    }
    if (groups.some(group => group.blocks.length === 0)) {
      toast.error(t('commercialTagGroups.needBlock'))
      return
    }
    if (groups.some(group => group.blocks.some(block => block.tag_ids.length === 0))) {
      toast.error(t('commercialTagGroups.emptyBlock'))
      return
    }

    setSaving(true)
    try {
      await dashboardApi.saveTagGroups(companyId, {
        version: 2,
        revision: expectedRevision,
        groups: groups.map(group => ({
          id: group.id,
          name: group.name.trim(),
          blocks: group.blocks.map(block => ({ id: block.id, tag_ids: [...block.tag_ids] })),
        })),
      })
      toast.success(t('commercialTagGroups.saved'))
      onSaved()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('commercialTagGroups.error')
      if (message.includes('não foi alterada')) setDraftKept(true)
      toast.error(message)
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
          {draftKept && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t('commercialTagGroups.draftKept')}
            </p>
          )}
          {loading && <p className="text-xs text-gray-400">{t('commercialTagGroups.loading')}</p>}
          {!loading && !readable && (
            <p className="text-xs text-amber-700">{t('commercialTagGroups.unreadable')}</p>
          )}
          {!loading && readable && groups.map((group, index) => (
            <div key={group.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
              <input
                value={group.name}
                maxLength={40}
                onChange={event => update(index, { ...group, name: event.target.value })}
                placeholder={t('commercialTagGroups.groupName')}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              />
              <TagGroupBlockEditor
                group={group}
                tags={tags}
                query={tagQuery}
                onQuery={(blockId, value) => setTagQuery(current => ({ ...current, [blockId]: value }))}
                onChange={next => update(index, next)}
              />
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => move(index, -1)} className="text-gray-500">{t('commercialTagGroups.moveUp')}</button>
                <button type="button" onClick={() => move(index, 1)} className="text-gray-500">{t('commercialTagGroups.moveDown')}</button>
                <button type="button" onClick={() => setGroups(current => current.filter((_, i) => i !== index))} className="text-rose-600">
                  {t('commercialTagGroups.remove')}
                </button>
              </div>
            </div>
          ))}
          {readable && (
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
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="text-xs text-gray-500 px-3 py-2">{t('commercialTagGroups.cancel')}</button>
          <button
            type="button"
            disabled={saving || loading || !readable}
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

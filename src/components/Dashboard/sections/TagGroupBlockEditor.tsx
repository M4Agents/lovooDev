import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TagGroupBlock, TagGroupDefinition } from '../../../types/dashboard'
import type { Tag } from '../../../types/tags'
import { formatTagGroupPreview } from '../../../lib/dashboard/tagGroupPreview'

const MAX_BLOCKS = 4
const MAX_TAGS_PER_BLOCK = 10

interface Props {
  group: TagGroupDefinition
  tags: Tag[]
  query: Record<string, string>
  onQuery: (blockId: string, value: string) => void
  onChange: (group: TagGroupDefinition) => void
}

export function TagGroupBlockEditor({ group, tags, query, onQuery, onChange }: Props) {
  const { t } = useTranslation('dashboard')
  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [tags],
  )
  const activeIds = useMemo(() => new Set(tags.map(tag => tag.id)), [tags])
  const preview = formatTagGroupPreview(
    group.blocks,
    id => tags.find(tag => tag.id === id)?.name ?? t('commercialTagGroups.unavailable'),
    t('commercialTagGroups.or'),
    t('commercialTagGroups.and'),
    '…',
  )

  function updateBlock(blockId: string, next: TagGroupBlock) {
    onChange({
      ...group,
      blocks: group.blocks.map(block => (block.id === blockId ? next : block)),
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('commercialTagGroups.preview')}</p>
      <p className="text-sm text-gray-800">{preview || '—'}</p>
      {group.blocks.map((block, index) => (
        <div key={block.id} className="space-y-2">
          {index > 0 && (
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[11px] font-bold text-indigo-700">{t('commercialTagGroups.and')}</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500">{t('commercialTagGroups.blockOr', { index: index + 1 })}</p>
            <button
              type="button"
              className="text-[11px] text-rose-600"
              onClick={() => onChange({ ...group, blocks: group.blocks.filter(item => item.id !== block.id) })}
            >
              {t('commercialTagGroups.removeBlock')}
            </button>
          </div>
          {block.tag_ids.length === 0 && (
            <p className="text-[11px] text-amber-700">{t('commercialTagGroups.emptyBlock')}</p>
          )}
          {block.tag_ids.filter(id => !activeIds.has(id)).map(id => (
            <button
              key={id}
              type="button"
              className="block text-[11px] text-amber-700 underline"
              onClick={() => updateBlock(block.id, { ...block, tag_ids: block.tag_ids.filter(tagId => tagId !== id) })}
            >
              {t('commercialTagGroups.missingTag')}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={query[block.id] ?? ''}
              onChange={event => onQuery(block.id, event.target.value)}
              placeholder={t('commercialTagGroups.searchTags')}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            />
            <span className="text-[11px] text-gray-500 shrink-0">
              {t('commercialTagGroups.selectedCount', { count: block.tag_ids.length, max: MAX_TAGS_PER_BLOCK })}
            </span>
          </div>
          <TagPickList
            tags={sortedTags}
            query={query[block.id] ?? ''}
            selectedIds={block.tag_ids}
            emptyLabel={t('commercialTagGroups.noTagMatch')}
            onToggle={tagId => {
              const checked = block.tag_ids.includes(tagId)
              const tagIds = checked
                ? block.tag_ids.filter(id => id !== tagId)
                : block.tag_ids.length >= MAX_TAGS_PER_BLOCK
                  ? block.tag_ids
                  : [...block.tag_ids, tagId]
              updateBlock(block.id, { ...block, tag_ids: tagIds })
            }}
          />
        </div>
      ))}
      <button
        type="button"
        disabled={group.blocks.length >= MAX_BLOCKS}
        onClick={() => {
          if (group.blocks.length >= MAX_BLOCKS) return
          onChange({
            ...group,
            blocks: [...group.blocks, { id: crypto.randomUUID(), tag_ids: [] }],
          })
        }}
        className="text-xs font-medium text-indigo-600 disabled:text-gray-300"
      >
        {t('commercialTagGroups.addBlock')}
      </button>
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
  const atLimit = selectedIds.length >= MAX_TAGS_PER_BLOCK

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

import type { MetaAdminWhatsAppTemplate, MetaTemplateComponent } from '../../types/meta-whatsapp'

export const KNOWN_COMPONENT_TYPES = ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'] as const

export function isSafePreviewUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function stringifyUnknown(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

export function findComponent(
  components: MetaTemplateComponent[],
  type: string,
): MetaTemplateComponent | undefined {
  return components.find((item) => item.type === type)
}

export function unknownComponents(components: MetaTemplateComponent[]): MetaTemplateComponent[] {
  return components.filter((item) => !KNOWN_COMPONENT_TYPES.includes(item.type as typeof KNOWN_COMPONENT_TYPES[number]))
}

export function exampleUrls(example: unknown): string[] {
  const record = asRecord(example)
  if (!record) return []
  const handle = record.header_handle
  const values = Array.isArray(handle) ? handle : handle === undefined ? [] : [handle]
  return values.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export function headerMediaPreview(component: MetaTemplateComponent | undefined): {
  format: string | null
  urls: string[]
  previewUrl: string | null
  unavailableReason: string | null
} {
  const format = typeof component?.format === 'string' ? component.format : null
  const urls = exampleUrls(component?.example)
  const previewUrl = urls.find(isSafePreviewUrl) ?? null
  if (!format || format === 'TEXT') {
    return { format, urls, previewUrl: null, unavailableReason: null }
  }
  if (previewUrl) {
    return { format, urls, previewUrl, unavailableReason: null }
  }
  if (urls.length > 0) {
    return {
      format,
      urls,
      previewUrl: null,
      unavailableReason: 'A Meta não forneceu uma URL pública para prévia desta mídia.',
    }
  }
  return {
    format,
    urls,
    previewUrl: null,
    unavailableReason: 'Nenhum exemplo de mídia disponível para prévia.',
  }
}

export function graphButtons(component: MetaTemplateComponent | undefined): Record<string, unknown>[] {
  const buttons = component?.buttons
  if (!Array.isArray(buttons)) return []
  return buttons.map((item) => asRecord(item) ?? { value: item })
}

export function templateRowKey(template: Pick<MetaAdminWhatsAppTemplate, 'id' | 'language'>): string {
  return `${template.id}:${template.language}`
}

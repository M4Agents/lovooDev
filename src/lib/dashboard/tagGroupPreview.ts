export function formatTagGroupPreview(
  blocks: { tag_ids: string[] }[],
  labelFor: (tagId: string) => string,
  orWord: string,
  andWord: string,
  emptyLabel: string,
): string {
  if (blocks.length === 0) return ''
  return blocks.map(block => {
    const names = block.tag_ids.map(labelFor)
    const inner = names.length === 0 ? emptyLabel : names.join(` ${orWord} `)
    return `(${inner})`
  }).join(` ${andWord} `)
}

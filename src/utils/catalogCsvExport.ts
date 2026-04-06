import type { CatalogProduct, CatalogService } from '../types/sales-funnel'

type CatalogItem = CatalogProduct | CatalogService

const HEADERS = [
  'name',
  'default_price',
  'is_active',
  'category',
  'availability_status',
  'external_id',
  'external_source',
  'external_reference',
]

/** Escapa um valor para CSV: envolve em aspas se contiver vírgula, aspas ou quebra de linha. */
function escapeCsv(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function itemToRow(item: CatalogItem): string {
  return [
    escapeCsv(item.name),
    escapeCsv(item.default_price),
    escapeCsv(item.is_active ? 'sim' : 'não'),
    escapeCsv(item.catalog_categories?.name ?? ''),
    escapeCsv(item.availability_status),
    escapeCsv(item.external_id ?? ''),
    escapeCsv(item.external_source ?? ''),
    escapeCsv(item.external_reference ?? ''),
  ].join(',')
}

/**
 * Gera e dispara o download de um CSV com os itens fornecidos.
 * UTF-8 com BOM para compatibilidade com Excel.
 */
export function exportCatalogToCsv(
  items: CatalogItem[],
  filename: string
): void {
  const bom = '\uFEFF'
  const header = HEADERS.join(',')
  const rows = items.map(itemToRow)
  const csv = [header, ...rows].join('\n')

  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Retorna o conteúdo do template CSV para download pelo usuário.
 * Os dados são apenas ilustrativos.
 */
export function getCatalogCsvTemplate(type: 'product' | 'service'): string {
  const bom = '\uFEFF'
  const header = HEADERS.join(',')
  const example =
    type === 'product'
      ? 'Camiseta Azul,49.90,sim,Roupas,available,SKU-001,shopify,'
      : 'Consultoria,200.00,sim,Assessoria,available,SVC-001,bling,'
  return bom + [header, example].join('\n')
}

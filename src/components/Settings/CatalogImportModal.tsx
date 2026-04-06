/**
 * Modal de importação CSV para produtos e serviços.
 * Fluxo: Upload → Preview + Validação → Confirmação.
 * Limite: 500 linhas. Sem rollback total — erros por linha.
 */

import { useRef, useState } from 'react'
import { X, Upload, Download, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { catalogCategoriesApi } from '../../services/catalogCategoriesApi'
import { getCatalogCsvTemplate } from '../../utils/catalogCsvExport'
import type { CatalogCategory } from '../../types/sales-funnel'

const IMPORT_LIMIT = 500

type ItemType = 'product' | 'service'

type ParsedRow = {
  lineNumber: number
  name: string
  default_price: number | null
  is_active: boolean
  category: string
  availability_status: string
  external_id: string
  external_source: string
  external_reference: string
  errors: string[]
}

type ImportResult = {
  lineNumber: number
  name: string
  status: 'ok' | 'error'
  message?: string
}

// ── Parser CSV simples e robusto ──────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

const VALID_AVAILABILITY = ['available', 'unavailable', 'on_demand', 'discontinued']

function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())

  const nameIdx = headers.indexOf('name')
  const priceIdx = ['default_price', 'price'].map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1
  const activeIdx = ['is_active', 'active'].map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1
  const catIdx = headers.indexOf('category')
  const availIdx = headers.indexOf('availability_status')
  const extIdIdx = ['external_id', 'ext_id'].map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1
  const extSrcIdx = ['external_source', 'ext_source'].map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1
  const extRefIdx = ['external_reference', 'ext_reference'].map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1

  const dataLines = lines.slice(1).slice(0, IMPORT_LIMIT)

  return dataLines.map((line, idx) => {
    const cols = parseCsvLine(line)
    const get = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '')

    const errors: string[] = []

    const rawName = get(nameIdx)
    if (!rawName) errors.push('Nome obrigatório')
    if (rawName.length > 255) errors.push('Nome muito longo (máx 255 caracteres)')

    const rawPrice = get(priceIdx)
    let parsedPrice: number | null = null
    if (rawPrice !== '') {
      const n = parseFloat(rawPrice.replace(',', '.'))
      if (isNaN(n) || n < 0) errors.push('Preço inválido (deve ser número >= 0)')
      else parsedPrice = n
    }

    const rawActive = get(activeIdx).toLowerCase()
    const is_active = !rawActive || ['sim', 'true', '1', 'yes'].includes(rawActive)

    const rawAvail = get(availIdx).toLowerCase()
    const availability_status =
      rawAvail && VALID_AVAILABILITY.includes(rawAvail) ? rawAvail : 'available'
    if (rawAvail && !VALID_AVAILABILITY.includes(rawAvail)) {
      errors.push(`Disponibilidade inválida: "${rawAvail}" (use: ${VALID_AVAILABILITY.join(', ')})`)
    }

    return {
      lineNumber: idx + 2,
      name: rawName,
      default_price: parsedPrice,
      is_active,
      category: get(catIdx),
      availability_status,
      external_id: get(extIdIdx),
      external_source: get(extSrcIdx).toLowerCase(),
      external_reference: get(extRefIdx),
      errors,
    }
  })
}

// ── Componente principal ──────────────────────────────────────────────────────

type Props = {
  companyId: string
  type: ItemType
  existingCategories: CatalogCategory[]
  onClose: () => void
  onImported: () => void
}

export const CatalogImportModal: React.FC<Props> = ({
  companyId,
  type,
  existingCategories,
  onClose,
  onImported,
}) => {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [results, setResults] = useState<ImportResult[]>([])
  const [importing, setImporting] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [totalInFile, setTotalInFile] = useState(0)

  const validRows = rows.filter((r) => r.errors.length === 0)
  const invalidRows = rows.filter((r) => r.errors.length > 0)
  const hasCritical = invalidRows.some((r) => r.errors.some((e) => e.includes('obrigatório')))

  const handleFile = (file: File) => {
    setParseError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      try {
        const lines = text.split('\n').filter((l) => l.trim()).length
        setTotalInFile(Math.max(0, lines - 1))
        const parsed = parseCsv(text)
        setRows(parsed)
        setStep('preview')
      } catch {
        setParseError('Não foi possível ler o arquivo. Verifique se é um CSV válido.')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv')) handleFile(file)
  }

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)

    try {
      // 1. Resolver categorias: buscar existentes e criar faltantes
      const categoryNames = [...new Set(validRows.map((r) => r.category).filter(Boolean))]
      const catMap: Record<string, string> = {}

      for (const name of categoryNames) {
        const normalized = name.trim().toLowerCase()
        const existing = existingCategories.find(
          (c) => c.name.toLowerCase() === normalized && c.type === type
        )
        if (existing) {
          catMap[name] = existing.id
        } else {
          try {
            const created = await catalogCategoriesApi.create(companyId, type, name.trim())
            catMap[name] = created.id
          } catch {
            // Se falhar na criação, ignora a categoria (item vai sem categoria)
          }
        }
      }

      // 2. Inserção em lotes de 50
      const table = type === 'product' ? 'products' : 'services'
      const chunks: ParsedRow[][] = []
      for (let i = 0; i < validRows.length; i += 50) {
        chunks.push(validRows.slice(i, i + 50))
      }

      const allResults: ImportResult[] = []

      for (const chunk of chunks) {
        const payload = chunk.map((row) => ({
          company_id: companyId,
          name: row.name,
          default_price: row.default_price ?? 0,
          is_active: row.is_active,
          category_id: row.category ? (catMap[row.category] ?? null) : null,
          availability_status: row.availability_status,
          external_id: row.external_id || null,
          external_source: row.external_source || null,
          external_reference: row.external_reference || null,
          stock_status: type === 'product' ? 'unknown' : 'not_applicable',
          track_inventory: false,
          available_for_ai: true,
        }))

        const { error } = await supabase.from(table).insert(payload)

        if (error) {
          chunk.forEach((row) =>
            allResults.push({ lineNumber: row.lineNumber, name: row.name, status: 'error', message: error.message })
          )
        } else {
          chunk.forEach((row) =>
            allResults.push({ lineNumber: row.lineNumber, name: row.name, status: 'ok' })
          )
        }
      }

      setResults(allResults)
      setStep('result')
      onImported()
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const content = getCatalogCsvTemplate(type)
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `modelo_${type === 'product' ? 'produtos' : 'servicos'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const typeLabel = type === 'product' ? 'produtos' : 'serviços'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Importar {typeLabel}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload' && `Envie um arquivo CSV com até ${IMPORT_LIMIT} linhas.`}
              {step === 'preview' && `${rows.length} linha(s) encontradas — valide antes de confirmar.`}
              {step === 'result' && 'Importação concluída.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex gap-0 px-5 py-2 border-b border-slate-100 text-xs">
          {(['upload', 'preview', 'result'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300 mx-2">›</span>}
              <span className={step === s ? 'font-medium text-indigo-600' : 'text-slate-400'}>
                {i + 1}. {s === 'upload' ? 'Arquivo' : s === 'preview' ? 'Preview' : 'Resultado'}
              </span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* STEP 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              >
                <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-600">
                  Arraste um arquivo <strong>.csv</strong> ou{' '}
                  <span className="text-indigo-600 underline">clique para selecionar</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">Máximo: {IMPORT_LIMIT} linhas</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                  }}
                />
              </div>
              {parseError && (
                <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{parseError}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Download className="w-3.5 h-3.5" />
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-indigo-600 hover:underline"
                >
                  Baixar modelo CSV
                </button>
              </div>
              {totalInFile > IMPORT_LIMIT && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                  O arquivo contém {totalInFile} linhas. Somente as primeiras {IMPORT_LIMIT} serão importadas.
                </p>
              )}
            </div>
          )}

          {/* STEP 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-700 font-medium">{validRows.length} válidas</span>
                {invalidRows.length > 0 && (
                  <span className="text-red-600 font-medium">{invalidRows.length} com erro</span>
                )}
              </div>
              {hasCritical && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 text-xs rounded px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Linhas com erros críticos serão ignoradas. Corrija o CSV e reimporte para incluí-las.
                </div>
              )}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-8">#</th>
                      <th className="px-2 py-1.5 text-left">Nome</th>
                      <th className="px-2 py-1.5 text-left">Preço</th>
                      <th className="px-2 py-1.5 text-left">Categoria</th>
                      <th className="px-2 py-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.lineNumber}
                        className={`border-t ${row.errors.length > 0 ? 'bg-red-50' : ''}`}
                      >
                        <td className="px-2 py-1 text-slate-400">{row.lineNumber}</td>
                        <td className="px-2 py-1 font-medium text-slate-800 max-w-[180px] truncate">
                          {row.name || <span className="text-red-500 italic">vazio</span>}
                        </td>
                        <td className="px-2 py-1 text-slate-600">
                          {row.default_price !== null ? row.default_price : '—'}
                        </td>
                        <td className="px-2 py-1 text-slate-600 max-w-[120px] truncate">
                          {row.category || '—'}
                        </td>
                        <td className="px-2 py-1">
                          {row.errors.length === 0 ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <span className="text-red-600" title={row.errors.join('; ')}>
                              <AlertCircle className="w-3.5 h-3.5 inline" /> {row.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 3: Resultado */}
          {step === 'result' && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-700 font-medium">
                  {results.filter((r) => r.status === 'ok').length} importados
                </span>
                {results.filter((r) => r.status === 'error').length > 0 && (
                  <span className="text-red-600 font-medium">
                    {results.filter((r) => r.status === 'error').length} com erro
                  </span>
                )}
              </div>
              {results.filter((r) => r.status === 'error').length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-left">#</th>
                        <th className="px-2 py-1.5 text-left">Nome</th>
                        <th className="px-2 py-1.5 text-left">Erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results
                        .filter((r) => r.status === 'error')
                        .map((r) => (
                          <tr key={r.lineNumber} className="border-t bg-red-50">
                            <td className="px-2 py-1 text-slate-400">{r.lineNumber}</td>
                            <td className="px-2 py-1 font-medium text-slate-800">{r.name}</td>
                            <td className="px-2 py-1 text-red-600">{r.message}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          {step === 'upload' && (
            <>
              <span />
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                Cancelar
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="text-sm text-slate-500 hover:underline"
              >
                ← Voltar
              </button>
              <button
                type="button"
                disabled={validRows.length === 0 || importing}
                onClick={handleImport}
                className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {importing ? 'Importando…' : `Importar ${validRows.length} item(s)`}
              </button>
            </>
          )}
          {step === 'result' && (
            <>
              <span />
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

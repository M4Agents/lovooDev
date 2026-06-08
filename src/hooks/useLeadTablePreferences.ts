import { useState, useEffect, useMemo } from 'react'

// =====================================================
// Tipos públicos — compartilhados com o componente de UI
// =====================================================

export interface LeadColumnDef {
  id: string
  label: string
  defaultVisible: boolean
  isCustom?: boolean
  fieldId?: string
}

export const MAX_VISIBLE_COLUMNS = 6

// =====================================================
// Colunas estáticas disponíveis para configuração
// "Lead" e "Ações" são fixas e não entram aqui.
// =====================================================

export const STATIC_COLUMNS: LeadColumnDef[] = [
  { id: 'contato',        label: 'Contato',        defaultVisible: true  },
  { id: 'status',         label: 'Status',         defaultVisible: true  },
  { id: 'origem',         label: 'Origem',         defaultVisible: true  },
  { id: 'responsavel',    label: 'Responsável',    defaultVisible: true  },
  { id: 'tags',           label: 'Tags',           defaultVisible: true  },
  { id: 'data',           label: 'Data',           defaultVisible: true  },
  { id: 'interesse',      label: 'Interesse',      defaultVisible: false },
  { id: 'ultimo_contato', label: 'Último Contato', defaultVisible: false },
]

interface CustomField {
  id: string
  field_label: string
  [key: string]: unknown
}

interface UseLeadTablePreferencesParams {
  companyId: string | undefined
  userId: string | undefined
  customFields: CustomField[]
}

interface UseLeadTablePreferencesReturn {
  allColumns: LeadColumnDef[]
  visibleColumns: string[]
  toggleColumn: (id: string) => void
  resetToDefault: () => void
  isAtLimit: boolean
}

// =====================================================
// Helper: chave do localStorage
// =====================================================

function buildStorageKey(companyId: string | undefined, userId: string | undefined): string | null {
  if (!companyId || !userId) return null
  return `lead_table_cols_${companyId}_${userId}`
}

// =====================================================
// Helper: colunas padrão visíveis
// =====================================================

function defaultVisibleColumns(allCols: LeadColumnDef[]): string[] {
  return allCols
    .filter((c) => c.defaultVisible)
    .map((c) => c.id)
    .slice(0, MAX_VISIBLE_COLUMNS)
}

// =====================================================
// Helper: ler e validar preferência do localStorage
// =====================================================

function readFromStorage(
  key: string | null,
  allCols: LeadColumnDef[]
): string[] | null {
  if (!key) return null

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) return null

    // Filtrar IDs que ainda existem em allColumns
    const validIds = new Set(allCols.map((c) => c.id))
    const filtered = (parsed as unknown[])
      .filter((item): item is string => typeof item === 'string' && validIds.has(item))

    // Garantir limite máximo
    return filtered.slice(0, MAX_VISIBLE_COLUMNS)
  } catch {
    return null
  }
}

// =====================================================
// Hook principal
// =====================================================

export function useLeadTablePreferences({
  companyId,
  userId,
  customFields,
}: UseLeadTablePreferencesParams): UseLeadTablePreferencesReturn {

  // Combina colunas estáticas + campos personalizados
  const allColumns = useMemo<LeadColumnDef[]>(() => {
    const custom: LeadColumnDef[] = customFields.map((f) => ({
      id: `custom_${f.id}`,
      label: f.field_label,
      defaultVisible: false,
      isCustom: true,
      fieldId: f.id,
    }))
    return [...STATIC_COLUMNS, ...custom]
  }, [customFields])

  const storageKey = useMemo(
    () => buildStorageKey(companyId, userId),
    [companyId, userId]
  )

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = readFromStorage(storageKey, allColumns)
    return saved ?? defaultVisibleColumns(allColumns)
  })

  // Efeito unificado: relê do localStorage sempre que storageKey ou allColumns mudar.
  //
  // Por que [storageKey, allColumns] juntos:
  //   • Troca de usuário/empresa (storageKey muda) → lê preferência do novo contexto.
  //   • customFields carregam de forma assíncrona (allColumns muda) → relê com o conjunto
  //     completo de IDs válidos, restaurando colunas custom_* que estavam salvas mas foram
  //     descartadas na leitura inicial (quando allColumns ainda não tinha os campos personalizados).
  //
  // readFromStorage já filtra IDs inexistentes e aplica o limite MAX_VISIBLE_COLUMNS.
  useEffect(() => {
    const saved = readFromStorage(storageKey, allColumns)
    setVisibleColumns(saved ?? defaultVisibleColumns(allColumns))
  }, [storageKey, allColumns])

  // Persiste no localStorage sempre que visibleColumns mudar
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleColumns))
    } catch {
      // localStorage cheio ou bloqueado: ignora silenciosamente
    }
  }, [visibleColumns, storageKey])

  const isAtLimit = visibleColumns.length >= MAX_VISIBLE_COLUMNS

  const toggleColumn = (id: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(id)) {
        // Sempre pode remover
        return prev.filter((c) => c !== id)
      }
      // Só adiciona se não atingiu o limite
      if (prev.length >= MAX_VISIBLE_COLUMNS) return prev
      return [...prev, id]
    })
  }

  const resetToDefault = () => {
    setVisibleColumns(defaultVisibleColumns(allColumns))
  }

  return { allColumns, visibleColumns, toggleColumn, resetToDefault, isAtLimit }
}

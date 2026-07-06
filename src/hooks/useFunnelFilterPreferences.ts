// =====================================================
// HOOK: useFunnelFilterPreferences
// Objetivo: Persistência de preferências de filtros do
//           funil de vendas em localStorage.
//
// Responsabilidades deste hook:
//   - Construção da chave de armazenamento
//   - Leitura + parse + validação do JSON armazenado
//   - Versionamento do snapshot (version: 1)
//   - Normalização para storage (preserva ordem de arrays)
//   - Normalização para comparação (ordena selectedTags)
//   - Comparação de estado (hasUnsavedChanges)
//   - Gravação serializada (Date → ISO string)
//   - Limpeza do localStorage
//
// SalesFunnel.tsx fica responsável apenas por:
//   - Aplicar filtros no estado local
//   - Controlar abertura/fechamento do painel
//   - Exibir indicador e banner
//   - Responder às ações do usuário
// =====================================================

import { useState, useEffect, useMemo } from 'react'
import type { SortOption } from '../types/sales-funnel'
import type { PeriodFilter as PeriodFilterType, PeriodType } from '../types/analytics'

// =====================================================
// Tipos públicos
// =====================================================

export interface FunnelFilterSnapshot {
  version: 1
  searchTerm: string
  selectedTags: string[]
  selectedTagsMode: 'or' | 'and'
  selectedOrigin: string
  selectedPeriod: PeriodFilterType | null
  globalSort: SortOption | undefined
  selectedOwner: string
}

// =====================================================
// Tipos internos (serializado em localStorage)
// =====================================================

interface StoredPeriod {
  type: PeriodType
  startDate: string | null
  endDate: string | null
  label: string
}

interface StoredSnapshot {
  version: 1
  searchTerm: string
  selectedTags: string[]
  selectedTagsMode: 'or' | 'and'
  selectedOrigin: string
  selectedPeriod: StoredPeriod | null
  globalSort?: SortOption
  selectedOwner: string
}

// =====================================================
// Constantes
// =====================================================

const STORAGE_VERSION = 1 as const

const VALID_SORT_OPTIONS = new Set<string>([
  'entered_stage_at',
  'entered_funnel_at',
  'lead_created_at',
  'last_interaction_at',
])

const VALID_PERIOD_TYPES = new Set<string>([
  'all', 'today', 'yesterday',
  '7days', '15days', '30days',
  'this_month', 'last_month',
  '90days', 'this_quarter', 'this_year', 'custom',
])

export const DEFAULT_FILTER_SNAPSHOT: FunnelFilterSnapshot = {
  version: 1,
  searchTerm: '',
  selectedTags: [],
  selectedTagsMode: 'or',
  selectedOrigin: '',
  selectedPeriod: null,
  globalSort: undefined,
  selectedOwner: '',
}

// =====================================================
// Chave do localStorage
// =====================================================

function buildStorageKey(
  companyId: string | undefined,
  userId: string | undefined,
  funnelId: string | undefined,
): string | null {
  if (!companyId || !userId || !funnelId) return null
  return `funnel_filters_${companyId}_${userId}_${funnelId}`
}

// =====================================================
// Serialização de PeriodFilter (Date <-> ISO string)
// =====================================================

function serializePeriod(period: PeriodFilterType): StoredPeriod {
  return {
    type: period.type,
    startDate: period.startDate ? period.startDate.toISOString() : null,
    endDate: period.endDate ? period.endDate.toISOString() : null,
    label: period.label,
  }
}

function deserializePeriod(stored: StoredPeriod): PeriodFilterType {
  return {
    type: stored.type,
    startDate: stored.startDate ? new Date(stored.startDate) : undefined,
    endDate: stored.endDate ? new Date(stored.endDate) : undefined,
    label: stored.label,
  }
}

// =====================================================
// Validação do snapshot armazenado
// =====================================================

function isValidStoredSnapshot(raw: unknown): raw is StoredSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const s = raw as Record<string, unknown>

  if (s.version !== STORAGE_VERSION) return false
  if (typeof s.searchTerm !== 'string') return false
  if (!Array.isArray(s.selectedTags)) return false
  if (!s.selectedTags.every((t: unknown) => typeof t === 'string')) return false
  if (s.selectedTagsMode !== 'or' && s.selectedTagsMode !== 'and') return false
  if (typeof s.selectedOrigin !== 'string') return false

  if (s.selectedPeriod !== null && s.selectedPeriod !== undefined) {
    if (typeof s.selectedPeriod !== 'object' || Array.isArray(s.selectedPeriod)) return false
    const p = s.selectedPeriod as Record<string, unknown>
    if (!VALID_PERIOD_TYPES.has(String(p.type))) return false
    if (typeof p.label !== 'string') return false
    if (p.startDate !== null && typeof p.startDate !== 'string') return false
    if (p.endDate !== null && typeof p.endDate !== 'string') return false
  }

  if (s.globalSort !== undefined && !VALID_SORT_OPTIONS.has(String(s.globalSort))) return false
  if (typeof s.selectedOwner !== 'string') return false

  return true
}

// =====================================================
// Normalização (duas variantes)
// =====================================================

/**
 * Normaliza para gravação em localStorage.
 * Aplica trim e defaults, mas NÃO reordena arrays —
 * preserva a ordem escolhida pelo usuário.
 */
export function normalizeForStorage(s: FunnelFilterSnapshot): FunnelFilterSnapshot {
  return {
    version: 1,
    searchTerm: (s.searchTerm ?? '').trim(),
    selectedTags: s.selectedTags ?? [],
    selectedTagsMode: s.selectedTagsMode ?? 'or',
    selectedOrigin: s.selectedOrigin ?? '',
    selectedPeriod: s.selectedPeriod ?? null,
    globalSort: s.globalSort ?? undefined,
    selectedOwner: s.selectedOwner ?? '',
  }
}

/**
 * Normaliza para comparação estável.
 * Aplica trim, defaults E ordena selectedTags —
 * evita falsos positivos por diferença de ordem.
 * Retorna string JSON pronta para comparação com ===.
 */
export function normalizeForCompare(s: FunnelFilterSnapshot): string {
  const comparable = {
    version: 1,
    searchTerm: (s.searchTerm ?? '').trim(),
    selectedTags: [...(s.selectedTags ?? [])].sort(),
    selectedTagsMode: s.selectedTagsMode ?? 'or',
    selectedOrigin: s.selectedOrigin ?? '',
    selectedPeriod: s.selectedPeriod
      ? {
          type: s.selectedPeriod.type,
          startDate: s.selectedPeriod.startDate?.toISOString() ?? null,
          endDate: s.selectedPeriod.endDate?.toISOString() ?? null,
          label: s.selectedPeriod.label,
        }
      : null,
    globalSort: s.globalSort ?? undefined,
    selectedOwner: s.selectedOwner ?? '',
  }
  return JSON.stringify(comparable)
}

// =====================================================
// Estado default
// =====================================================

const DEFAULT_COMPARE = normalizeForCompare(DEFAULT_FILTER_SNAPSHOT)

export function isDefaultSnapshot(s: FunnelFilterSnapshot): boolean {
  return normalizeForCompare(s) === DEFAULT_COMPARE
}

// =====================================================
// Leitura do localStorage
// =====================================================

function readFromStorage(key: string | null): FunnelFilterSnapshot | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)

    if (!isValidStoredSnapshot(parsed)) {
      localStorage.removeItem(key)
      return null
    }

    return {
      version: 1,
      searchTerm: parsed.searchTerm,
      selectedTags: parsed.selectedTags,
      selectedTagsMode: parsed.selectedTagsMode,
      selectedOrigin: parsed.selectedOrigin,
      selectedPeriod: parsed.selectedPeriod ? deserializePeriod(parsed.selectedPeriod) : null,
      globalSort: parsed.globalSort,
      selectedOwner: parsed.selectedOwner,
    }
  } catch {
    try { localStorage.removeItem(key) } catch { /* quota ou bloqueio — ignora */ }
    return null
  }
}

// =====================================================
// Gravação no localStorage
// =====================================================

function writeToStorage(key: string, snapshot: FunnelFilterSnapshot): void {
  const normalized = normalizeForStorage(snapshot)
  const stored: StoredSnapshot = {
    version: 1,
    searchTerm: normalized.searchTerm,
    selectedTags: normalized.selectedTags,
    selectedTagsMode: normalized.selectedTagsMode,
    selectedOrigin: normalized.selectedOrigin,
    selectedPeriod: normalized.selectedPeriod ? serializePeriod(normalized.selectedPeriod) : null,
    globalSort: normalized.globalSort,
    selectedOwner: normalized.selectedOwner,
  }
  try {
    localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    /* localStorage cheio ou bloqueado — ignora silenciosamente */
  }
}

// =====================================================
// Interface pública do hook
// =====================================================

export interface UseFunnelFilterPreferencesReturn {
  /** Preferências carregadas do localStorage. Null se não existir ou for inválido. */
  savedFilters: FunnelFilterSnapshot | null
  /** True quando a leitura inicial do localStorage foi concluída. */
  isLoaded: boolean
  /**
   * O funnelId para o qual savedFilters foi efetivamente carregado.
   * Usado para sincronização: garante que o efeito de restauração só
   * aplique os dados quando o hook terminou de ler o funil correto.
   */
  loadedFunnelId: string | undefined
  /** Persiste o snapshot atual no localStorage. */
  saveFilters: (snapshot: FunnelFilterSnapshot) => void
  /** Remove as preferências salvas do localStorage. */
  clearFilters: () => void
  /**
   * Retorna true se o estado atual difere das preferências salvas.
   * Retorna false se não há preferência salva e o estado é o default.
   */
  hasUnsavedChanges: (current: FunnelFilterSnapshot) => boolean
  /** Exporta o helper de comparação com o estado default. */
  isDefaultSnapshot: (snapshot: FunnelFilterSnapshot) => boolean
}

// =====================================================
// Hook
// =====================================================

export function useFunnelFilterPreferences(
  companyId: string | undefined,
  userId: string | undefined,
  funnelId: string | undefined,
): UseFunnelFilterPreferencesReturn {
  const storageKey = useMemo(
    () => buildStorageKey(companyId, userId, funnelId),
    [companyId, userId, funnelId],
  )

  const [savedFilters, setSavedFilters] = useState<FunnelFilterSnapshot | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadedFunnelId, setLoadedFunnelId] = useState<string | undefined>(undefined)

  // Re-lê o localStorage sempre que a chave muda (funnel, user ou company alterados).
  // loadedFunnelId é atualizado atomicamente com savedFilters para que o consumidor
  // possa verificar se os dados correspondem ao funil selecionado antes de restaurar.
  useEffect(() => {
    setIsLoaded(false)
    const loaded = readFromStorage(storageKey)
    setSavedFilters(loaded)
    setLoadedFunnelId(funnelId)
    setIsLoaded(true)
  }, [storageKey, funnelId])

  const saveFilters = (snapshot: FunnelFilterSnapshot): void => {
    if (!storageKey) return
    writeToStorage(storageKey, snapshot)
    setSavedFilters(normalizeForStorage(snapshot))
  }

  const clearFilters = (): void => {
    if (storageKey) {
      try { localStorage.removeItem(storageKey) } catch { /* ignora */ }
    }
    setSavedFilters(null)
  }

  const hasUnsavedChanges = (current: FunnelFilterSnapshot): boolean => {
    // Sem preferência salva e estado default → sem alterações pendentes
    if (!savedFilters && isDefaultSnapshot(current)) return false
    // Sem preferência salva mas filtros ativos → há alterações
    if (!savedFilters) return true
    // Compara o estado atual com o salvo usando normalização estável
    return normalizeForCompare(current) !== normalizeForCompare(savedFilters)
  }

  return {
    savedFilters,
    isLoaded,
    loadedFunnelId,
    saveFilters,
    clearFilters,
    hasUnsavedChanges,
    isDefaultSnapshot,
  }
}

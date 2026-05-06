// =============================================================================
// Media Library Picker Modal
// =============================================================================
// Modal de seleção de mídia da biblioteca da empresa para uso em modelos.
//
// REGRAS DE SEGURANÇA:
//   - onSelect retorna apenas { path, type, filename } — sem preview_url
//   - preview_url permanece confinada ao estado interno do modal (display only)
//   - file_type é validado antes de habilitar confirmação
//   - token extraído via supabase.auth.getSession (nunca hardcoded)
// =============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { X, Search, Loader2, AlertCircle, Image, FileVideo, FileAudio, FileText, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { mediaLibraryApi } from '../../services/mediaLibraryApi'
import type { MediaFile } from '../../services/mediaLibraryApi'
import type { MessageTemplateMediaType } from '../../types/message-templates'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

const VALID_TYPES: MessageTemplateMediaType[] = ['image', 'video', 'audio', 'document']

export interface MediaLibraryPickerSelectPayload {
  path:     string
  type:     MessageTemplateMediaType
  filename: string
}

interface MediaLibraryPickerModalProps {
  companyId: string
  isOpen:    boolean
  onClose:   () => void
  onSelect:  (item: MediaLibraryPickerSelectPayload) => void
}

// ---------------------------------------------------------------------------
// Helper: ícone por tipo
// ---------------------------------------------------------------------------

function FileTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? 'w-5 h-5'
  if (type === 'image')    return <Image     className={cls} />
  if (type === 'video')    return <FileVideo className={cls} />
  if (type === 'audio')    return <FileAudio className={cls} />
  return <FileText className={cls} />
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function MediaLibraryPickerModal({
  companyId,
  isOpen,
  onClose,
  onSelect,
}: MediaLibraryPickerModalProps) {
  const [files,         setFiles]         = useState<MediaFile[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [filterType,    setFilterType]    = useState<MessageTemplateMediaType | ''>('')
  const [selectedFile,  setSelectedFile]  = useState<MediaFile | null>(null)
  const [page,          setPage]          = useState(1)
  const [totalCount,    setTotalCount]    = useState(0)
  const [hasNextPage,   setHasNextPage]   = useState(false)

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const LIMIT = 50

  // -------------------------------------------------------------------------
  // Carregar arquivos
  // -------------------------------------------------------------------------

  const loadFiles = useCallback(async (currentPage: number, currentSearch: string, currentFilter: string) => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sessão expirada')

      const result = await mediaLibraryApi.getCompanyFiles(
        companyId,
        session.access_token,
        {
          page:     currentPage,
          limit:    LIMIT,
          search:   currentSearch,
          fileType: (currentFilter as MessageTemplateMediaType) || undefined,
        }
      )

      setFiles(currentPage === 1 ? result.files : prev => [...prev, ...result.files])
      setTotalCount(result.pagination.totalCount)
      setHasNextPage(result.pagination.hasNextPage)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar arquivos')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Carregar na abertura e ao resetar filtros
  useEffect(() => {
    if (!isOpen) return
    setPage(1)
    setSelectedFile(null)
    setFiles([])
    loadFiles(1, search, filterType)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce de busca
  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(1)
      setFiles([])
      setSelectedFile(null)
      loadFiles(1, value, filterType)
    }, 350)
  }

  // Filtro por tipo
  const handleFilterChange = (type: MessageTemplateMediaType | '') => {
    setFilterType(type)
    setPage(1)
    setFiles([])
    setSelectedFile(null)
    loadFiles(1, search, type)
  }

  // Carregar mais (paginação)
  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadFiles(nextPage, search, filterType)
  }

  // -------------------------------------------------------------------------
  // Validação e seleção
  // -------------------------------------------------------------------------

  const isValidType = (file: MediaFile): file is MediaFile & { file_type: MessageTemplateMediaType } =>
    (VALID_TYPES as string[]).includes(file.file_type)

  const handleFileClick = (file: MediaFile) => {
    if (!isValidType(file)) return
    setSelectedFile(file)
  }

  const handleConfirm = () => {
    if (!selectedFile || !isValidType(selectedFile)) return

    // Retorna apenas identificadores — nunca preview_url
    onSelect({
      path:     selectedFile.s3_key,
      type:     selectedFile.file_type as MessageTemplateMediaType,
      filename: selectedFile.original_filename,
    })
  }

  // -------------------------------------------------------------------------
  // Fechar com ESC
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Biblioteca de Mídias</h3>
            <p className="text-xs text-slate-500 mt-0.5">Selecione uma mídia da empresa</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b border-slate-100 space-y-2">
          {/* Busca */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nome..."
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
            />
          </div>

          {/* Filtro de tipo */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { value: '',         label: 'Todos'      },
              { value: 'image',    label: 'Imagens'    },
              { value: 'video',    label: 'Vídeos'     },
              { value: 'audio',    label: 'Áudios'     },
              { value: 'document', label: 'Documentos' },
            ] as { value: MessageTemplateMediaType | ''; label: string }[]).map(opt => (
              <button
                key={opt.value}
                onClick={() => handleFilterChange(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  filterType === opt.value
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-green-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grade de arquivos */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-slate-100 rounded-full mb-3">
                <Image className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-500">Nenhum arquivo encontrado</p>
              {search || filterType ? (
                <p className="text-xs text-slate-400 mt-1">Tente remover os filtros</p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Envie mídias via chat para que elas apareçam aqui</p>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {files.map(file => {
                  const isValid    = isValidType(file)
                  const isSelected = selectedFile?.id === file.id

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => handleFileClick(file)}
                      disabled={!isValid}
                      title={!isValid ? `Tipo "${file.file_type}" não suportado` : file.original_filename}
                      className={`
                        relative border rounded-lg overflow-hidden text-left transition-all
                        ${isSelected
                          ? 'border-green-500 ring-2 ring-green-400 ring-offset-1'
                          : 'border-slate-200 hover:border-green-300'
                        }
                        ${!isValid ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                    >
                      {/* Thumbnail */}
                      {file.file_type === 'image' && file.preview_url ? (
                        <img
                          src={file.preview_url}
                          alt={file.original_filename}
                          className="w-full h-20 object-cover bg-slate-100"
                          loading="lazy"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : file.file_type === 'video' && file.preview_url ? (
                        <div className="relative w-full h-20 bg-black overflow-hidden">
                          <video
                            src={file.preview_url}
                            className="w-full h-full object-cover"
                            preload="metadata"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                            <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                              <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-20 bg-slate-100 flex items-center justify-center">
                          <FileTypeIcon
                            type={file.file_type}
                            className="w-8 h-8 text-slate-400"
                          />
                        </div>
                      )}

                      {/* Nome */}
                      <div className="px-1.5 py-1 bg-white">
                        <p className="text-[10px] text-slate-600 truncate leading-tight">
                          {file.original_filename}
                        </p>
                      </div>

                      {/* Badge de seleção */}
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}

                      {/* Badge de tipo inválido */}
                      {!isValid && (
                        <div className="absolute inset-0 flex items-end justify-center pb-1 pointer-events-none">
                          <span className="text-[9px] bg-red-100 text-red-500 px-1 rounded">Tipo inválido</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Carregar mais */}
              {hasNextPage && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    {loading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Carregando...
                      </span>
                    ) : (
                      `Carregar mais (${totalCount - files.length} restantes)`
                    )}
                  </button>
                </div>
              )}

              {/* Contagem */}
              <p className="text-center text-xs text-slate-400 mt-3">
                {files.length} de {totalCount} arquivo{totalCount !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <div className="text-xs text-slate-500">
            {selectedFile
              ? <span className="flex items-center gap-1.5 text-green-700 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  {selectedFile.original_filename}
                </span>
              : 'Selecione um arquivo acima'
            }
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedFile || !isValidType(selectedFile)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Confirmar seleção
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

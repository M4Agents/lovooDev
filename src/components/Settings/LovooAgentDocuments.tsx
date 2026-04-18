/**
 * Seção de documentos RAG de um agente Lovoo.
 *
 * Exibe lista de documentos com status, versão e chunk count.
 * Permite upload (com processamento automático), reprocessamento e exclusão.
 * Faz polling automático de 8 s quando há documentos em processamento ativo.
 *
 * Usado exclusivamente dentro de LovooAgentForm (modes rag e hybrid).
 * Nunca exibe embeddings ou chunks ao usuário.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { lovooAgentsApi } from '../../services/lovooAgentsApi'
import type { LovooAgentDocument } from '../../types/lovoo-agents'

type Props = {
  agentId:       string
  /** Callback opcional — disparado sempre que a lista de documentos muda. */
  onDocsChange?: (docs: LovooAgentDocument[]) => void
}

const STALE_THRESHOLD_MS = 15 * 60 * 1_000

const STATUS_CLASSES: Record<string, string> = {
  pending:    'bg-slate-100 text-slate-600',
  processing: 'bg-amber-100 text-amber-700',
  ready:      'bg-emerald-100 text-emerald-700',
  error:      'bg-red-100 text-red-700',
}

function isProcessingStale(doc: LovooAgentDocument): boolean {
  if (doc.status !== 'processing' || !doc.processing_started_at) return false
  return Date.now() - new Date(doc.processing_started_at).getTime() > STALE_THRESHOLD_MS
}

export const LovooAgentDocuments: React.FC<Props> = ({ agentId, onDocsChange }) => {
  const { t, i18n } = useTranslation('agents')

  const [docs,         setDocs]         = useState<LovooAgentDocument[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState<string | null>(null)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [deletingIds,   setDeletingIds]   = useState<Set<string>>(new Set())
  const [actionErrors,  setActionErrors]  = useState<Record<string, string>>({})

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadDocs = useCallback(async () => {
    try {
      const data = await lovooAgentsApi.listDocuments(agentId)
      setDocs(data)
      setLoadError(null)
    } catch {
      setLoadError(t('documents.errors.load'))
    } finally {
      setLoading(false)
    }
  }, [agentId, t])

  // Notifica o parent sempre que a lista de documentos muda.
  const onDocsChangeRef = useRef(onDocsChange)
  onDocsChangeRef.current = onDocsChange
  useEffect(() => {
    onDocsChangeRef.current?.(docs)
  }, [docs])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  // Polling automático quando há processamento ativo (não travado)
  useEffect(() => {
    const hasActive = docs.some((d) => d.status === 'processing' && !isProcessingStale(d))

    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(() => { void loadDocs() }, 8_000)
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [docs, loadDocs])

  const formatDate = (iso: string | null): string => {
    if (!iso) return ''
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadError(null)
    setUploading(true)
    try {
      const uploaded = await lovooAgentsApi.uploadDocument(agentId, file, file.name)
      // Processa automaticamente após upload bem-sucedido.
      // Falhas de processamento resultam em status 'error' — recuperável via "Reprocessar".
      try {
        await lovooAgentsApi.processDocument(uploaded.id)
      } catch {
        // silencioso: o doc ficará em 'pending' ou 'error' e o usuário pode reprocessar
      }
      await loadDocs()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('documents.errors.upload'))
    } finally {
      setUploading(false)
    }
  }

  const handleProcess = async (docId: string) => {
    setProcessingIds((s) => new Set(s).add(docId))
    setActionErrors((prev) => { const n = { ...prev }; delete n[docId]; return n })
    try {
      await lovooAgentsApi.processDocument(docId)
      await loadDocs()
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [docId]: err instanceof Error ? err.message : t('documents.errors.process'),
      }))
    } finally {
      setProcessingIds((s) => { const n = new Set(s); n.delete(docId); return n })
    }
  }

  const handleDelete = async (doc: LovooAgentDocument) => {
    if (!window.confirm(t('documents.confirmDelete', { name: doc.name }))) return
    setDeletingIds((s) => new Set(s).add(doc.id))
    try {
      await lovooAgentsApi.deleteDocument(doc.id)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      setActionErrors((prev) => { const n = { ...prev }; delete n[doc.id]; return n })
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [doc.id]: err instanceof Error ? err.message : t('documents.errors.delete'),
      }))
    } finally {
      setDeletingIds((s) => { const n = new Set(s); n.delete(doc.id); return n })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('loading')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {/* Botão de upload */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="sr-only"
          onChange={(e) => void handleFileChange(e)}
          disabled={uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-violet-300 rounded-lg text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-60 transition-colors"
        >
          {uploading
            ? <><Loader2 className="w-4 h-4 animate-spin" />{t('documents.uploading')}</>
            : <><Upload className="w-4 h-4" />{t('documents.upload')}</>
          }
        </button>
        <p className="text-xs text-slate-400 mt-1">{t('documents.uploadHint')}</p>
        {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
      </div>

      {/* Lista de documentos */}
      {docs.length === 0 ? (
        <p className="text-sm text-slate-400 py-1">{t('documents.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => {
            const stale        = isProcessingStale(doc)
            const isInProgress = processingIds.has(doc.id) || (doc.status === 'processing' && !stale)
            const isDeleting   = deletingIds.has(doc.id)
            const actionError  = actionErrors[doc.id]

            return (
              <li
                key={doc.id}
                className="border border-slate-200 rounded-lg px-3 py-2.5 space-y-1.5 bg-white"
              >
                {/* Cabeçalho: nome + badge de status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-sm font-medium text-slate-800 truncate">{doc.name}</span>
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASSES[doc.status] ?? STATUS_CLASSES.pending}`}
                  >
                    {t(`documents.status.${doc.status}`)}
                  </span>
                </div>

                {/* Metadados: versão, chunks, data */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span>{t('documents.fields.version', { version: doc.version })}</span>
                  {doc.status === 'ready' && doc.chunk_count > 0 && (
                    <span>{t('documents.fields.chunks', { count: doc.chunk_count })}</span>
                  )}
                  {doc.last_processed_at && (
                    <span>{t('documents.fields.lastProcessed', { date: formatDate(doc.last_processed_at) })}</span>
                  )}
                </div>

                {/* Aviso de processamento travado */}
                {stale && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {t('documents.staleWarning')}
                  </div>
                )}

                {/* Mensagem de erro do documento */}
                {doc.status === 'error' && doc.error_message && (
                  <p className="text-xs text-red-600 break-words">{doc.error_message}</p>
                )}

                {/* Erro de ação */}
                {actionError && (
                  <p className="text-xs text-red-600">{actionError}</p>
                )}

                {/* Ações por item */}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => void handleProcess(doc.id)}
                    disabled={isInProgress || isDeleting}
                    className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 disabled:opacity-50 transition-colors"
                  >
                    {processingIds.has(doc.id)
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />
                    }
                    {t('documents.reprocess')}
                  </button>
                  <span className="text-slate-200 select-none">|</span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc)}
                    disabled={isDeleting || isInProgress}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                  >
                    {isDeleting
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                    {t('documents.delete')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

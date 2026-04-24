import { useState, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { Loader2, StickyNote, Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notesApi, type InternalNote } from '../services/notesApi'
import { RichTextNoteEditor } from './RichTextNoteEditor'

// =====================================================
// TIPOS
// Props discriminadas: exatamente um contexto (lead OU oportunidade)
// =====================================================

type InternalNotesProps =
  | { companyId: string; leadId: number; opportunityId?: never }
  | { companyId: string; opportunityId: string; leadId?: never }

// =====================================================
// CONFIGURAÇÃO DE SANITIZAÇÃO
// Tags e atributos permitidos — somente formatação de texto
// Aplicada antes de salvar e antes de renderizar
// =====================================================

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'br'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

// =====================================================
// HELPERS
// =====================================================

const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))

/**
 * Detecta se o conteúdo é HTML ou texto puro.
 * Regex exige tag completa (abertura ou fechamento com nome de tag válido)
 * para evitar falso positivo com strings como "preço < 100".
 */
function isHtmlContent(str: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(str)
}

// =====================================================
// SUB-COMPONENTE: renderização de conteúdo do card
// =====================================================

function NoteContent({ content }: { content: string }) {
  if (isHtmlContent(content)) {
    return (
      <div
        className="text-sm text-gray-800 prose prose-sm max-w-none
          prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
          prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline"
        dangerouslySetInnerHTML={{ __html: sanitize(content) }}
      />
    )
  }
  return (
    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
      {content}
    </p>
  )
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export function InternalNotes(props: InternalNotesProps) {
  const { companyId } = props
  const leadId = 'leadId' in props ? props.leadId : undefined
  const opportunityId = 'opportunityId' in props ? props.opportunityId : undefined

  const [notes, setNotes] = useState<InternalNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Estados de criação
  const [newContent, setNewContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>()

  // Estados de edição inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  // Estados de exclusão com confirmação inline
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Obter usuário atual uma única vez
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null)
    })
  }, [])

  // Carregar notas
  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const data = leadId !== undefined
        ? await notesApi.getNotesByLead(companyId, leadId)
        : await notesApi.getNotesByOpportunity(companyId, opportunityId!)
      setNotes(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar notas')
    } finally {
      setLoading(false)
    }
  }, [companyId, leadId, opportunityId])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // ─── Criar nota ───────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newContent.trim()) return
    setCreating(true)
    setCreateError(undefined)
    try {
      // Sanitização no frontend antes de persistir — única barreira nesta fase
      const safeContent = isHtmlContent(newContent)
        ? sanitize(newContent)
        : newContent.trim()

      if (!safeContent.trim()) {
        setCreateError('Conteúdo inválido após sanitização')
        return
      }

      const note = await notesApi.createNote({
        companyId,
        content: safeContent,
        ...(leadId !== undefined ? { leadId } : { opportunityId }),
      })
      setNotes(prev => [note, ...prev])
      setNewContent('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro ao criar nota')
    } finally {
      setCreating(false)
    }
  }

  // ─── Editar nota ──────────────────────────────────────────────────────────

  const startEdit = (note: InternalNote) => {
    setEditingId(note.id)
    setEditContent(note.content)
    setDeletingId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
  }

  const handleSaveEdit = async (noteId: string) => {
    if (!editContent.trim()) return
    setSaving(true)
    try {
      // Sanitização no frontend antes de persistir — única barreira nesta fase
      const safeContent = isHtmlContent(editContent)
        ? sanitize(editContent)
        : editContent.trim()

      if (!safeContent.trim()) return

      await notesApi.updateContent(noteId, safeContent)
      setNotes(prev =>
        prev.map(n => n.id === noteId ? { ...n, content: safeContent } : n)
      )
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar nota')
    } finally {
      setSaving(false)
    }
  }

  // ─── Excluir nota ─────────────────────────────────────────────────────────

  const startDelete = (noteId: string) => {
    setDeletingId(noteId)
    setEditingId(null)
  }

  const cancelDelete = () => setDeletingId(null)

  const handleConfirmDelete = async (noteId: string) => {
    setDeleting(true)
    try {
      await notesApi.softDelete(noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
      setDeletingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir nota')
    } finally {
      setDeleting(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Formulário de criação */}
      <div className="flex flex-col gap-2">
        <RichTextNoteEditor
          value={newContent}
          onChange={setNewContent}
          onSubmit={handleCreate}
          placeholder="Adicionar nota interna... (Ctrl+Enter para salvar)"
          disabled={creating}
        />
        {createError && (
          <p className="text-xs text-red-600">{createError}</p>
        )}
        <button
          onClick={handleCreate}
          disabled={creating || !newContent.trim()}
          className="self-end flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Plus className="w-3.5 h-3.5" />
          }
          {creating ? 'Salvando...' : 'Adicionar'}
        </button>
      </div>

      {/* Separador */}
      <hr className="border-gray-100" />

      {/* Lista de notas */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando notas...
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-4">{error}</p>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <StickyNote className="w-8 h-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">Nenhuma nota ainda</p>
          <p className="text-xs text-gray-400">Adicione a primeira nota acima</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map(note => {
            const isAuthor = note.created_by === currentUserId
            const isEditing = editingId === note.id
            const isConfirmingDelete = deletingId === note.id

            return (
              <div
                key={note.id}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col gap-2"
              >
                {/* Cabeçalho: autoria + ações */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">
                      {isAuthor ? 'Você' : 'Outro membro'}
                    </span>
                    {' · '}
                    {formatDateTime(note.updated_at !== note.created_at ? note.updated_at : note.created_at)}
                    {note.updated_at !== note.created_at && (
                      <span className="text-gray-400"> (editado)</span>
                    )}
                  </span>

                  {/* Ações — visíveis apenas para o autor */}
                  {isAuthor && !isEditing && !isConfirmingDelete && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(note)}
                        title="Editar nota"
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => startDelete(note.id)}
                        title="Excluir nota"
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Conteúdo ou editor de edição */}
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <RichTextNoteEditor
                      value={editContent}
                      onChange={setEditContent}
                      onSubmit={() => handleSaveEdit(note.id)}
                      disabled={saving}
                    />
                    <div className="flex items-center gap-2 self-end">
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        <X className="w-3 h-3" /> Cancelar
                      </button>
                      <button
                        onClick={() => handleSaveEdit(note.id)}
                        disabled={saving || !editContent.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {saving
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Check className="w-3 h-3" />
                        }
                        {saving ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </div>
                ) : isConfirmingDelete ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-red-600">Confirmar exclusão desta nota?</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={cancelDelete}
                        disabled={deleting}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        <X className="w-3 h-3" /> Cancelar
                      </button>
                      <button
                        onClick={() => handleConfirmDelete(note.id)}
                        disabled={deleting}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deleting
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Trash2 className="w-3 h-3" />
                        }
                        {deleting ? 'Excluindo...' : 'Excluir'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <NoteContent content={note.content} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default InternalNotes

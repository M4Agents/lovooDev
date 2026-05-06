import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Edit2, Trash2, Tag, X, Check, ChevronDown, ChevronUp, FolderPlus, AlertCircle, Paperclip, Image, FileVideo, FileAudio, FileText, Loader2, Library } from 'lucide-react'
import {
  listSettingsTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadTemplateMedia,
  generateTemplateMediaUrl,
} from '../../services/messageTemplatesApi'
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateMediaType,
} from '../../types/message-templates'
import {
  MediaLibraryPickerModal,
  type MediaLibraryPickerSelectPayload,
} from './MediaLibraryPickerModal'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageTemplatesPanelProps {
  companyId: string
}

// ---------------------------------------------------------------------------
// Estado de formulário de template
// ---------------------------------------------------------------------------

interface TemplateForm {
  name: string
  content: string
  channel: 'whatsapp_life'
  category_id: string
  is_active: boolean
  media_path: string | null
  media_type: MessageTemplateMediaType | null
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  name: '',
  content: '',
  channel: 'whatsapp_life',
  category_id: '',
  is_active: true,
  media_path: null,
  media_type: null,
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function MessageTemplatesPanel({ companyId }: MessageTemplatesPanelProps) {
  const [categories,   setCategories]   = useState<MessageTemplateCategory[]>([])
  const [templates,    setTemplates]    = useState<MessageTemplate[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingTemplate,  setEditingTemplate]  = useState<MessageTemplate | null>(null)
  const [templateForm,     setTemplateForm]     = useState<TemplateForm>(EMPTY_TEMPLATE_FORM)
  const [savingTemplate,   setSavingTemplate]   = useState(false)
  const [templateError,    setTemplateError]    = useState<string | null>(null)

  // Category form
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [editingCategory,  setEditingCategory]  = useState<MessageTemplateCategory | null>(null)
  const [categoryName,     setCategoryName]     = useState('')
  const [savingCategory,   setSavingCategory]   = useState(false)
  const [categoryError,    setCategoryError]    = useState<string | null>(null)

  // Confirmar exclusão
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<string | null>(null)
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null)

  // Upload de mídia
  const [mediaPreviewUrl,       setMediaPreviewUrl]       = useState<string | null>(null)
  const [uploadingMedia,        setUploadingMedia]        = useState(false)
  const [uploadProgress,        setUploadProgress]        = useState(0)
  const [mediaError,            setMediaError]            = useState<string | null>(null)
  const [showMediaLibraryPicker, setShowMediaLibraryPicker] = useState(false)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)

  // Colapso de categorias
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Carregar dados
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { categories: cats, templates: tpls } = await listSettingsTemplates(companyId)
      setCategories(cats)
      setTemplates(tpls)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar modelos')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { loadData() }, [loadData])

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const toggleCollapse = (catId: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  // ---------------------------------------------------------------------------
  // Template — abrir form
  // ---------------------------------------------------------------------------

  const openCreateTemplate = () => {
    if (categories.length === 0) return
    setEditingTemplate(null)
    setTemplateForm(EMPTY_TEMPLATE_FORM)
    setTemplateError(null)
    setMediaPreviewUrl(null)
    setMediaError(null)
    setShowTemplateForm(true)
  }

  const openEditTemplate = (tpl: MessageTemplate) => {
    setEditingTemplate(tpl)
    setTemplateForm({
      name:        tpl.name,
      content:     tpl.content,
      channel:     'whatsapp_life',
      category_id: tpl.category_id ?? '',
      is_active:   tpl.is_active,
      media_path:  tpl.media_path,
      media_type:  tpl.media_type,
    })
    setTemplateError(null)
    setMediaPreviewUrl(null)
    setMediaError(null)
    setShowTemplateForm(true)
  }

  const closeTemplateForm = () => {
    setShowTemplateForm(false)
    setEditingTemplate(null)
    setTemplateForm(EMPTY_TEMPLATE_FORM)
    setTemplateError(null)
    setMediaPreviewUrl(null)
    setMediaError(null)
    setUploadProgress(0)
  }

  // ---------------------------------------------------------------------------
  // Upload de mídia
  // ---------------------------------------------------------------------------

  const handleMediaUpload = async (file: File) => {
    setUploadingMedia(true)
    setMediaError(null)
    setUploadProgress(0)
    try {
      const { media_path, preview_url, media_type } = await uploadTemplateMedia(
        file,
        companyId,
        (p) => setUploadProgress(p),
      )
      setTemplateForm(f => ({ ...f, media_path, media_type }))
      setMediaPreviewUrl(preview_url)
    } catch (e: unknown) {
      setMediaError(e instanceof Error ? e.message : 'Erro ao fazer upload de mídia')
    } finally {
      setUploadingMedia(false)
    }
  }

  const removeMedia = () => {
    setTemplateForm(f => ({ ...f, media_path: null, media_type: null }))
    setMediaPreviewUrl(null)
    setMediaError(null)
    if (mediaInputRef.current) mediaInputRef.current.value = ''
  }

  const handleLibrarySelect = async (item: MediaLibraryPickerSelectPayload) => {
    // Salvar apenas path + type — nunca URL assinada
    setTemplateForm(f => ({ ...f, media_path: item.path, media_type: item.type }))
    setMediaError(null)
    setShowMediaLibraryPicker(false)

    // Gerar URL fresca para preview local — nunca usar URL do banco
    const previewUrl = await generateTemplateMediaUrl(companyId, item.path)
    setMediaPreviewUrl(previewUrl)
  }

  // ---------------------------------------------------------------------------
  // Template — salvar
  // ---------------------------------------------------------------------------

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim())    { setTemplateError('Nome obrigatório'); return }
    if (!templateForm.content.trim()) { setTemplateError('Conteúdo obrigatório'); return }
    if (!templateForm.category_id)    { setTemplateError('Categoria obrigatória. Selecione uma categoria.'); return }

    setSavingTemplate(true)
    setTemplateError(null)
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, {
          company_id:  companyId,
          name:        templateForm.name.trim(),
          content:     templateForm.content.trim(),
          channel:     templateForm.channel,
          category_id: templateForm.category_id,
          is_active:   templateForm.is_active,
          media_path:  templateForm.media_path,
          media_type:  templateForm.media_type,
        })
      } else {
        await createTemplate({
          company_id:  companyId,
          name:        templateForm.name.trim(),
          content:     templateForm.content.trim(),
          channel:     templateForm.channel,
          category_id: templateForm.category_id,
          media_path:  templateForm.media_path,
          media_type:  templateForm.media_type,
        })
      }
      closeTemplateForm()
      await loadData()
    } catch (e: unknown) {
      setTemplateError(e instanceof Error ? e.message : 'Erro ao salvar modelo')
    } finally {
      setSavingTemplate(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Template — excluir
  // ---------------------------------------------------------------------------

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate(id, companyId)
      setConfirmDeleteTemplate(null)
      await loadData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao desativar modelo')
    }
  }

  // ---------------------------------------------------------------------------
  // Categoria — abrir form
  // ---------------------------------------------------------------------------

  const openCreateCategory = () => {
    setEditingCategory(null)
    setCategoryName('')
    setCategoryError(null)
    setShowCategoryForm(true)
    // Fechar form de template ao abrir form de categoria
    setShowTemplateForm(false)
  }

  const openEditCategory = (cat: MessageTemplateCategory) => {
    setEditingCategory(cat)
    setCategoryName(cat.name)
    setCategoryError(null)
    setShowCategoryForm(true)
  }

  const closeCategoryForm = () => {
    setShowCategoryForm(false)
    setEditingCategory(null)
    setCategoryName('')
    setCategoryError(null)
  }

  // ---------------------------------------------------------------------------
  // Categoria — salvar
  // ---------------------------------------------------------------------------

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) { setCategoryError('Nome obrigatório'); return }
    setSavingCategory(true)
    setCategoryError(null)
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, { company_id: companyId, name: categoryName.trim() })
      } else {
        await createCategory({ company_id: companyId, name: categoryName.trim() })
      }
      closeCategoryForm()
      await loadData()
    } catch (e: unknown) {
      setCategoryError(e instanceof Error ? e.message : 'Erro ao salvar categoria')
    } finally {
      setSavingCategory(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Categoria — excluir
  // ---------------------------------------------------------------------------

  const handleDeleteCategory = async (id: string) => {
    try {
      await deleteCategory(id, companyId)
      setConfirmDeleteCategory(null)
      await loadData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao desativar categoria')
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers de agrupamento
  // ---------------------------------------------------------------------------

  const templatesByCategory = (catId: string) =>
    templates.filter(t => t.category_id === catId)

  const uncategorizedTemplates = templates.filter(t => !t.category_id)

  const hasCategories = categories.length > 0

  // ---------------------------------------------------------------------------
  // Loading / error global
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between">
        <span>{error}</span>
        <button onClick={loadData} className="ml-4 text-xs underline">Tentar novamente</button>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">

      {/* ── Canal — aviso API Oficial ──────────────────────────────────────── */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
        <div className="flex-1 text-sm text-amber-800">
          <span className="font-medium">WhatsApp Life</span> está disponível.{' '}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full border border-amber-200 ml-1">
            API Oficial — Em breve
          </span>
        </div>
      </div>

      {/* ── CTA: sem categorias ───────────────────────────────────────────── */}
      {!hasCategories && !showCategoryForm && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <div className="flex justify-center mb-3">
            <div className="p-3 bg-green-100 rounded-full">
              <FolderPlus className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">
            Crie sua primeira categoria
          </h4>
          <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">
            As categorias organizam seus modelos de mensagem. Toda empresa cria e gerencia as próprias categorias.
          </p>
          <button
            onClick={openCreateCategory}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar categoria
          </button>
        </div>
      )}

      {/* ── Cabeçalho — ações (visível com categorias) ────────────────────── */}
      {hasCategories && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Modelos de Mensagem</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Digite "/" no chat para usar um modelo
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateCategory}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" />
              Nova categoria
            </button>
            <button
              onClick={openCreateTemplate}
              disabled={!hasCategories}
              title={!hasCategories ? 'Crie uma categoria primeiro' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo modelo
            </button>
          </div>
        </div>
      )}

      {/* ── Form: categoria ───────────────────────────────────────────────── */}
      {showCategoryForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">
              {editingCategory ? 'Editar categoria' : 'Nova categoria'}
            </h4>
            <button onClick={closeCategoryForm} className="p-1 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Nome da categoria *"
            value={categoryName}
            onChange={e => setCategoryName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
          />
          {categoryError && <p className="text-xs text-red-600">{categoryError}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={closeCategoryForm}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveCategory}
              disabled={savingCategory}
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {savingCategory ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Form: template ────────────────────────────────────────────────── */}
      {showTemplateForm && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">
              {editingTemplate ? 'Editar modelo' : 'Novo modelo'}
            </h4>
            <button onClick={closeTemplateForm} className="p-1 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              placeholder="Nome do modelo *"
              value={templateForm.name}
              onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
            />

            {/* Categoria — obrigatória */}
            <div>
              <select
                value={templateForm.category_id}
                onChange={e => setTemplateForm(f => ({ ...f, category_id: e.target.value }))}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white ${
                  !templateForm.category_id ? 'border-amber-300 text-slate-400' : 'border-slate-200 text-slate-800'
                }`}
              >
                <option value="">Selecione uma categoria *</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              {!templateForm.category_id && (
                <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Categoria é obrigatória
                </p>
              )}
            </div>

            {/* Canal: WhatsApp Life fixo, API Oficial disabled */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-2 text-sm border border-green-300 bg-green-100 text-green-800 rounded-lg flex-1">
                <Check className="w-3.5 h-3.5 text-green-600" />
                WhatsApp Life
              </div>
              <div className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-400 rounded-lg flex-1 cursor-not-allowed">
                API Oficial
                <span className="ml-auto text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">Em breve</span>
              </div>
            </div>

            <textarea
              placeholder="Conteúdo do modelo *"
              value={templateForm.content}
              onChange={e => setTemplateForm(f => ({ ...f, content: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 resize-none bg-white"
            />

            {/* Mídia opcional */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">Mídia (opcional)</p>

              {/* Preview da mídia ou botão de upload */}
              {templateForm.media_path && !uploadingMedia ? (
                <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <MediaTypeIcon type={templateForm.media_type} />
                  <div className="flex-1 min-w-0">
                    {mediaPreviewUrl && templateForm.media_type === 'image' ? (
                      <img
                        src={mediaPreviewUrl}
                        alt="Preview"
                        className="h-16 object-contain rounded"
                        onError={() => setMediaPreviewUrl(null)}
                      />
                    ) : (
                      <p className="text-xs text-slate-600 truncate">
                        {templateForm.media_type} • {templateForm.media_path.split('/').pop()}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={removeMedia}
                    className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0"
                    title="Remover mídia"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : uploadingMedia ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <Loader2 className="w-4 h-4 text-green-600 animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{uploadProgress}% enviado</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  {/* Botão 1: Upload de arquivo */}
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs text-slate-600 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors">
                    <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                    Fazer upload
                    <input
                      ref={mediaInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="sr-only"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleMediaUpload(file)
                      }}
                    />
                  </label>

                  {/* Botão 2: Selecionar da biblioteca */}
                  <button
                    type="button"
                    onClick={() => setShowMediaLibraryPicker(true)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs text-slate-600 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors"
                  >
                    <Library className="w-3.5 h-3.5 text-slate-400" />
                    Da biblioteca
                  </button>
                </div>
              )}

              {mediaError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {mediaError}
                </p>
              )}
            </div>

            {editingTemplate && (
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={templateForm.is_active}
                  onChange={e => setTemplateForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="rounded"
                />
                Modelo ativo
              </label>
            )}
          </div>

          {templateError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {templateError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={closeTemplateForm}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveTemplate}
              disabled={savingTemplate}
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {savingTemplate ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: seleção da biblioteca de mídias ────────────────────────── */}
      <MediaLibraryPickerModal
        companyId={companyId}
        isOpen={showMediaLibraryPicker}
        onClose={() => setShowMediaLibraryPicker(false)}
        onSelect={handleLibrarySelect}
      />

      {/* ── Lista de categorias + templates ───────────────────────────────── */}
      {hasCategories && (
        <div className="space-y-4">

          {categories.map(cat => {
            const catTemplates = templatesByCategory(cat.id)
            const collapsed    = collapsedCats.has(cat.id)
            return (
              <CategorySection
                key={cat.id}
                category={cat}
                templates={catTemplates}
                collapsed={collapsed}
                onToggleCollapse={() => toggleCollapse(cat.id)}
                onEditCategory={() => openEditCategory(cat)}
                onDeleteCategory={id => setConfirmDeleteCategory(id)}
                confirmDeleteCategoryId={confirmDeleteCategory}
                onConfirmDeleteCategory={handleDeleteCategory}
                onCancelDeleteCategory={() => setConfirmDeleteCategory(null)}
                onEditTemplate={openEditTemplate}
                onDeleteTemplate={id => setConfirmDeleteTemplate(id)}
                confirmDeleteId={confirmDeleteTemplate}
                onConfirmDelete={handleDeleteTemplate}
                onCancelDelete={() => setConfirmDeleteTemplate(null)}
              />
            )
          })}

          {/* Templates sem categoria (edge case: categoria foi desativada) */}
          {uncategorizedTemplates.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-100 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-700">
                  Modelos sem categoria ({uncategorizedTemplates.length})
                </span>
                <span className="text-xs text-amber-500">— edite-os para atribuir uma categoria</span>
              </div>
              <div className="divide-y divide-amber-100">
                {uncategorizedTemplates.map(tpl => (
                  <TemplateRow
                    key={tpl.id}
                    template={tpl}
                    onEdit={() => openEditTemplate(tpl)}
                    onDelete={() => setConfirmDeleteTemplate(tpl.id)}
                    confirmDeleteId={confirmDeleteTemplate}
                    onConfirmDelete={handleDeleteTemplate}
                    onCancelDelete={() => setConfirmDeleteTemplate(null)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Estado vazio de modelos (mas tem categorias) */}
          {templates.length === 0 && !showTemplateForm && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Nenhum modelo cadastrado ainda.{' '}
              <button onClick={openCreateTemplate} className="text-green-600 underline">
                Criar o primeiro modelo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: seção de categoria
// ---------------------------------------------------------------------------

interface CategorySectionProps {
  category: MessageTemplateCategory
  templates: MessageTemplate[]
  collapsed: boolean
  onToggleCollapse: () => void
  onEditCategory: () => void
  onDeleteCategory: (id: string) => void
  confirmDeleteCategoryId: string | null
  onConfirmDeleteCategory: (id: string) => void
  onCancelDeleteCategory: () => void
  onEditTemplate: (tpl: MessageTemplate) => void
  onDeleteTemplate: (id: string) => void
  confirmDeleteId: string | null
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
}

function CategorySection({
  category, templates, collapsed, onToggleCollapse,
  onEditCategory, onDeleteCategory,
  confirmDeleteCategoryId, onConfirmDeleteCategory, onCancelDeleteCategory,
  onEditTemplate, onDeleteTemplate, confirmDeleteId, onConfirmDelete, onCancelDelete,
}: CategorySectionProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2 cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <Tag className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-700 flex-1">{category.name}</span>
        {!category.is_active && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-full">inativo</span>
        )}
        <span className="text-xs text-slate-400">{templates.length}</span>

        {/* Ações da categoria */}
        <div className="flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
          {confirmDeleteCategoryId === category.id ? (
            <>
              <span className="text-xs text-slate-500 mr-1">Desativar?</span>
              <button onClick={() => onConfirmDeleteCategory(category.id)} className="text-xs text-red-600 font-medium hover:underline">Sim</button>
              <button onClick={onCancelDeleteCategory} className="text-xs text-slate-500 ml-1 hover:underline">Não</button>
            </>
          ) : (
            <>
              <button onClick={onEditCategory} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <Edit2 className="w-3 h-3" />
              </button>
              <button onClick={() => onDeleteCategory(category.id)} className="p-1 text-slate-400 hover:text-red-500 rounded">
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>

        <button className="p-1 text-slate-400" onClick={e => { e.stopPropagation(); onToggleCollapse() }}>
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="divide-y divide-slate-100">
          {templates.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400">Nenhum modelo nesta categoria.</p>
          ) : (
            templates.map(tpl => (
              <TemplateRow
                key={tpl.id}
                template={tpl}
                onEdit={() => onEditTemplate(tpl)}
                onDelete={() => onDeleteTemplate(tpl.id)}
                confirmDeleteId={confirmDeleteId}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: linha de template
// ---------------------------------------------------------------------------

interface TemplateRowProps {
  template: MessageTemplate
  onEdit: () => void
  onDelete: () => void
  confirmDeleteId: string | null
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
}

// ---------------------------------------------------------------------------
// Helper: ícone de tipo de mídia
// ---------------------------------------------------------------------------

function MediaTypeIcon({ type, size = 'sm' }: { type: MessageTemplateMediaType | null | undefined; size?: 'xs' | 'sm' }) {
  const cls = size === 'xs' ? 'w-2.5 h-2.5' : 'w-4 h-4 text-slate-400'
  if (type === 'image')    return <Image     className={cls} />
  if (type === 'video')    return <FileVideo className={cls} />
  if (type === 'audio')    return <FileAudio className={cls} />
  return <FileText className={cls} />
}

function TemplateRow({ template, onEdit, onDelete, confirmDeleteId, onConfirmDelete, onCancelDelete }: TemplateRowProps) {
  return (
    <div className={`px-4 py-3 flex items-start gap-3 group ${!template.is_active ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 truncate">{template.name}</span>
          {template.media_type && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full flex-shrink-0">
              <MediaTypeIcon type={template.media_type} size="xs" />
              {template.media_type}
            </span>
          )}
          {!template.is_active && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full flex-shrink-0">inativo</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{template.content}</p>
      </div>

      {confirmDeleteId === template.id ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-slate-500">Desativar?</span>
          <button onClick={() => onConfirmDelete(template.id)} className="text-xs text-red-600 font-medium hover:underline">Sim</button>
          <button onClick={onCancelDelete} className="text-xs text-slate-500 hover:underline">Não</button>
        </div>
      ) : (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

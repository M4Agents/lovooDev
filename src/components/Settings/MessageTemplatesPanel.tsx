import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Edit2, Trash2, Tag, X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import {
  listSettingsTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../../services/messageTemplatesApi'
import type {
  MessageTemplate,
  MessageTemplateCategory,
} from '../../types/message-templates'

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
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  name: '',
  content: '',
  channel: 'whatsapp_life',
  category_id: '',
  is_active: true,
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function MessageTemplatesPanel({ companyId }: MessageTemplatesPanelProps) {
  const { t } = useTranslation('settings')

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

  const categoryById = (id: string | null) =>
    id ? categories.find(c => c.id === id) : null

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
    setEditingTemplate(null)
    setTemplateForm(EMPTY_TEMPLATE_FORM)
    setTemplateError(null)
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
    })
    setTemplateError(null)
    setShowTemplateForm(true)
  }

  const closeTemplateForm = () => {
    setShowTemplateForm(false)
    setEditingTemplate(null)
    setTemplateForm(EMPTY_TEMPLATE_FORM)
    setTemplateError(null)
  }

  // ---------------------------------------------------------------------------
  // Template — salvar
  // ---------------------------------------------------------------------------

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim())    { setTemplateError('Nome obrigatório'); return }
    if (!templateForm.content.trim()) { setTemplateError('Conteúdo obrigatório'); return }

    setSavingTemplate(true)
    setTemplateError(null)
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, {
          company_id:  companyId,
          name:        templateForm.name.trim(),
          content:     templateForm.content.trim(),
          channel:     templateForm.channel,
          category_id: templateForm.category_id || null,
          is_active:   templateForm.is_active,
        })
      } else {
        await createTemplate({
          company_id:  companyId,
          name:        templateForm.name.trim(),
          content:     templateForm.content.trim(),
          channel:     templateForm.channel,
          category_id: templateForm.category_id || null,
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
  // Render helpers
  // ---------------------------------------------------------------------------

  const customCategories = categories.filter(c => !c.is_system)
  const systemCategories = categories.filter(c => c.is_system)

  // Templates sem categoria
  const uncategorizedTemplates = templates.filter(t => !t.category_id)

  // Templates agrupados por categoria
  const templatesByCategory = (catId: string) =>
    templates.filter(t => t.category_id === catId)

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

      {/* ── Cabeçalho — ações principais ──────────────────────────────────── */}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo modelo
          </button>
        </div>
      </div>

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

            <select
              value={templateForm.category_id}
              onChange={e => setTemplateForm(f => ({ ...f, category_id: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
            >
              <option value="">Sem categoria</option>
              {systemCategories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name} (padrão)</option>
              ))}
              {customCategories.filter(c => c.is_active).map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>

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
            <p className="text-xs text-red-600">{templateError}</p>
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

      {/* ── Lista de categorias + templates ───────────────────────────────── */}
      <div className="space-y-4">

        {/* Categorias system (padrão — read-only) */}
        {systemCategories.map(cat => {
          const catTemplates = templatesByCategory(cat.id)
          const collapsed    = collapsedCats.has(cat.id)
          return (
            <CategorySection
              key={cat.id}
              category={cat}
              templates={catTemplates}
              collapsed={collapsed}
              onToggleCollapse={() => toggleCollapse(cat.id)}
              onEditTemplate={openEditTemplate}
              onDeleteTemplate={id => setConfirmDeleteTemplate(id)}
              confirmDeleteId={confirmDeleteTemplate}
              onConfirmDelete={handleDeleteTemplate}
              onCancelDelete={() => setConfirmDeleteTemplate(null)}
              readOnly
            />
          )
        })}

        {/* Categorias custom (editáveis) */}
        {customCategories.map(cat => {
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

        {/* Templates sem categoria */}
        {uncategorizedTemplates.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Sem categoria</span>
              <span className="text-xs text-slate-400">({uncategorizedTemplates.length})</span>
            </div>
            <div className="divide-y divide-slate-100">
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

        {/* Estado vazio */}
        {templates.length === 0 && !showTemplateForm && (
          <div className="text-center py-10 text-slate-400 text-sm">
            Nenhum modelo cadastrado ainda.{' '}
            <button onClick={openCreateTemplate} className="text-green-600 underline">
              Criar o primeiro modelo
            </button>
          </div>
        )}
      </div>
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
  onEditCategory?: () => void
  onDeleteCategory?: (id: string) => void
  confirmDeleteCategoryId?: string | null
  onConfirmDeleteCategory?: (id: string) => void
  onCancelDeleteCategory?: () => void
  onEditTemplate: (tpl: MessageTemplate) => void
  onDeleteTemplate: (id: string) => void
  confirmDeleteId: string | null
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
  readOnly?: boolean
}

function CategorySection({
  category, templates, collapsed, onToggleCollapse,
  onEditCategory, onDeleteCategory,
  confirmDeleteCategoryId, onConfirmDeleteCategory, onCancelDeleteCategory,
  onEditTemplate, onDeleteTemplate, confirmDeleteId, onConfirmDelete, onCancelDelete,
  readOnly,
}: CategorySectionProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2 cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <Tag className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-700 flex-1">{category.name}</span>
        {category.is_system && (
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded-full">padrão</span>
        )}
        {!category.is_active && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-full">inativo</span>
        )}
        <span className="text-xs text-slate-400">{templates.length}</span>

        {/* Ações da categoria (somente custom) */}
        {!readOnly && (
          <div className="flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
            {confirmDeleteCategoryId === category.id ? (
              <>
                <span className="text-xs text-slate-500 mr-1">Desativar?</span>
                <button onClick={() => onConfirmDeleteCategory?.(category.id)} className="text-xs text-red-600 font-medium hover:underline">Sim</button>
                <button onClick={onCancelDeleteCategory} className="text-xs text-slate-500 ml-1 hover:underline">Não</button>
              </>
            ) : (
              <>
                <button onClick={onEditCategory} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                  <Edit2 className="w-3 h-3" />
                </button>
                <button onClick={() => onDeleteCategory?.(category.id)} className="p-1 text-slate-400 hover:text-red-500 rounded">
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        )}

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

function TemplateRow({ template, onEdit, onDelete, confirmDeleteId, onConfirmDelete, onCancelDelete }: TemplateRowProps) {
  return (
    <div className={`px-4 py-3 flex items-start gap-3 group ${!template.is_active ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 truncate">{template.name}</span>
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

import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { metaWhatsAppApi } from '../../services/metaWhatsAppApi'
import type { MetaCreateTemplateResponse } from '../../types/meta-whatsapp'
import {
  TEMPLATE_CREATE_LANGUAGES,
  TEMPLATE_CREATE_LIMITS,
  createErrorMessage,
  fieldForCreateError,
  listTemplateCreateVariables,
  validateCreateDraft,
  type CreateErrorField,
} from './metaTemplateCreateModel'

type Category = 'UTILITY' | 'MARKETING'

export function MetaTemplateCreateForm({
  companyId,
  instanceId,
  onCancel,
  onCreated,
}: {
  companyId: string
  instanceId: string
  onCancel: () => void
  onCreated: (result: MetaCreateTemplateResponse) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('UTILITY')
  const [language, setLanguage] = useState('pt_BR')
  const [headerText, setHeaderText] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [examples, setExamples] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ field: CreateErrorField; message: string } | null>(null)

  function fieldMessage(field: CreateErrorField) {
    return error?.field === field ? error.message : null
  }

  const variables = useMemo(
    () => listTemplateCreateVariables(headerText, bodyText),
    [headerText, bodyText],
  )

  function exampleKey(component: 'header' | 'body', key: string) {
    return `${component}:${key}`
  }

  function buildExamples() {
    const header: Record<string, string> = {}
    const body: Record<string, string> = {}
    for (const key of variables.header) {
      const value = examples[exampleKey('header', key)]?.trim() ?? ''
      if (value) header[key] = value
    }
    for (const key of variables.body) {
      const value = examples[exampleKey('body', key)]?.trim() ?? ''
      if (value) body[key] = value
    }
    return {
      header: Object.keys(header).length > 0 ? header : undefined,
      body: Object.keys(body).length > 0 ? body : undefined,
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !instanceId) return
    const draft = {
      name,
      language,
      category,
      header_text: headerText,
      body_text: bodyText,
      footer_text: footerText,
      examples: buildExamples(),
    }
    const local = validateCreateDraft(draft)
    if (!local.ok) {
      setError({ field: fieldForCreateError(local.error), message: createErrorMessage(local.error) })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await metaWhatsAppApi.createTemplate({
        companyId,
        instanceId,
        ...draft,
      })
      onCreated(result)
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'provider_error'
      setError({ field: 'form', message: createErrorMessage(code) })
    } finally {
      setSubmitting(false)
    }
  }

  const variableFields = [
    ...variables.header.map((key) => ({ component: 'header' as const, key, label: `Cabeçalho · {{${key}}}` })),
    ...variables.body.map((key) => ({ component: 'body' as const, key, label: `Mensagem · {{${key}}}` })),
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar à lista
        </button>
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900">Criar modelo Meta</h3>
        <p className="text-xs text-slate-500">
          A Meta analisa o conteúdo antes de liberar o envio. Use {'{{1}}'} ou {'{{nome_cliente}}'} para variáveis.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Nome do modelo</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={TEMPLATE_CREATE_LIMITS.nameMax}
          placeholder="pedido_enviado"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        {fieldMessage('name') ? <p className="text-xs text-red-700">{fieldMessage('name')}</p> : null}
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">Categoria</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="category" checked={category === 'UTILITY'} onChange={() => setCategory('UTILITY')} />
          Utilidade
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="category" checked={category === 'MARKETING'} onChange={() => setCategory('MARKETING')} />
          Marketing
        </label>
        <p className="text-xs text-slate-500">A Meta pode reclassificar a categoria na análise.</p>
        {fieldMessage('category') ? <p className="text-xs text-red-700">{fieldMessage('category')}</p> : null}
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Idioma</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        >
          {TEMPLATE_CREATE_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>
        {fieldMessage('language') ? <p className="text-xs text-red-700">{fieldMessage('language')}</p> : null}
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Cabeçalho (opcional)</span>
        <textarea
          value={headerText}
          onChange={(event) => setHeaderText(event.target.value)}
          maxLength={TEMPLATE_CREATE_LIMITS.headerMax}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        {fieldMessage('header') ? <p className="text-xs text-red-700">{fieldMessage('header')}</p> : null}
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Mensagem</span>
        <textarea
          value={bodyText}
          onChange={(event) => setBodyText(event.target.value)}
          maxLength={TEMPLATE_CREATE_LIMITS.bodyMax}
          rows={5}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        {fieldMessage('body') ? <p className="text-xs text-red-700">{fieldMessage('body')}</p> : null}
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">Rodapé (opcional)</span>
        <textarea
          value={footerText}
          onChange={(event) => setFooterText(event.target.value)}
          maxLength={TEMPLATE_CREATE_LIMITS.footerMax}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        {fieldMessage('footer') ? <p className="text-xs text-red-700">{fieldMessage('footer')}</p> : null}
      </label>

      {variableFields.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Exemplos das variáveis</p>
          {variableFields.map((field) => (
            <label key={exampleKey(field.component, field.key)} className="block space-y-1">
              <span className="text-xs text-slate-500">{field.label}</span>
              <input
                value={examples[exampleKey(field.component, field.key)] ?? ''}
                onChange={(event) => setExamples((current) => ({
                  ...current,
                  [exampleKey(field.component, field.key)]: event.target.value,
                }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </label>
          ))}
          {fieldMessage('examples') ? <p className="text-xs text-red-700">{fieldMessage('examples')}</p> : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">Prévia da mensagem</h4>
        <div className="max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          {headerText.trim() ? (
            <p className="text-sm font-semibold text-slate-900 whitespace-pre-wrap break-words">{headerText}</p>
          ) : null}
          {bodyText ? (
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{bodyText}</p>
          ) : (
            <p className="text-sm text-slate-400">O texto da mensagem aparece aqui.</p>
          )}
          {footerText.trim() ? (
            <p className="text-xs text-slate-500 whitespace-pre-wrap break-words">{footerText}</p>
          ) : null}
        </div>
      </section>

      {fieldMessage('form') ? (
        <p className="text-sm text-red-700 whitespace-pre-wrap">{fieldMessage('form')}</p>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !instanceId}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Enviar para aprovação da Meta
      </button>
    </form>
  )
}

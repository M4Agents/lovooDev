// =============================================================================
// MetaTemplatePicker — MVP4A
//
// Seletor de templates Meta WhatsApp com form dinâmico e preview textual.
//
// Responsabilidades:
//   - Carregar templates via listTemplates (máx 3 páginas)
//   - Filtrar somente supported=true
//   - Selecionar template + coletar parâmetros HEADER/BODY independentemente
//   - Exibir preview textual local (não porta templateEngine.js)
//   - Solicitar envio via onSend — parent é responsável pela chamada real
//
// Isolamento:
//   - Zero conhecimento de recipient/to/wa_id/phone_number_id/token
//   - Nunca acessa Graph API diretamente
//   - example usado somente como placeholder — nunca como valor pré-preenchido
//   - Paginação limitada a 3 páginas; truncated=true se houver mais
//   - Proteção de stale: generation ref (reopen) + cancelled flag (unmount)
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { metaWhatsAppApi }    from '../../../services/metaWhatsAppApi'
import { MetaMediaAssetSelector } from './MetaMediaAssetSelector'
import type { MediaAssetFormat }  from './MetaMediaAssetSelector'
import type {
  MetaWhatsAppTemplate,
  MetaTemplateParameterValues,
  MetaTemplateComponent,
  MetaTemplateParameter,
} from '../../../types/meta-whatsapp'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MetaTemplatePickerProps {
  companyId:  string
  instanceId: string
  open:       boolean
  sending:    boolean
  onClose:    () => void
  onSend:     (
    template:        MetaWhatsAppTemplate,
    parameterValues: MetaTemplateParameterValues,
    headerPickerId?: string,
  ) => Promise<void>
}

// ── Helpers puros ─────────────────────────────────────────────────────────────

/** Constrói paramValues inicial a partir dos parâmetros do template selecionado. */
function initParamValues(tmpl: MetaWhatsAppTemplate): MetaTemplateParameterValues {
  const hasHeader = tmpl.parameters.some(p => p.component === 'HEADER')
  return hasHeader ? { header: {}, body: {} } : { body: {} }
}

/**
 * Substitui {{key}} no texto com o valor do mapa fornecido.
 * Mantém placeholder original se o valor estiver vazio.
 * HEADER e BODY usam mapas independentes — nunca cruzados.
 */
function substituteKeys(
  text:   string,
  params: MetaTemplateParameter[],
  values: Record<string, string>,
): string {
  let result = text
  for (const p of params) {
    const val = values[p.key]
    if (val) result = result.replace(new RegExp(`\\{\\{${p.key}\\}\\}`, 'g'), val)
  }
  return result
}

/** Monta preview textual a partir dos components + valores atuais. */
function buildPreview(
  components:  MetaTemplateComponent[],
  parameters:  MetaTemplateParameter[],
  paramValues: MetaTemplateParameterValues,
): { header: string | null; body: string | null; footer: string | null } {
  const headerParams = parameters.filter(p => p.component === 'HEADER')
  const bodyParams   = parameters.filter(p => p.component === 'BODY')
  let header: string | null = null
  let body:   string | null = null
  let footer: string | null = null
  for (const c of components) {
    if (c.type === 'HEADER' && typeof c.text === 'string')
      header = substituteKeys(c.text, headerParams, paramValues.header ?? {})
    else if (c.type === 'BODY' && typeof c.text === 'string')
      body = substituteKeys(c.text, bodyParams, paramValues.body)
    else if (c.type === 'FOOTER' && typeof c.text === 'string')
      footer = c.text // FOOTER é estático
  }
  return { header, body, footer }
}

/** True quando todos os parâmetros do template têm valor não vazio. */
function paramsComplete(tmpl: MetaWhatsAppTemplate, vals: MetaTemplateParameterValues): boolean {
  for (const p of tmpl.parameters) {
    const v = p.component === 'HEADER' ? (vals.header?.[p.key] ?? '') : (vals.body[p.key] ?? '')
    if (!v.trim()) return false
  }
  return true
}

// ── Componente ────────────────────────────────────────────────────────────────

export function MetaTemplatePicker({
  companyId, instanceId, open, sending, onClose, onSend,
}: MetaTemplatePickerProps) {
  type LoadState = 'idle' | 'loading' | 'done' | 'error'

  const [loadState, setLoadState]     = useState<LoadState>('idle')
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [templates, setTemplates]     = useState<MetaWhatsAppTemplate[]>([])
  const [truncated, setTruncated]     = useState(false)
  const [selected, setSelected]       = useState<MetaWhatsAppTemplate | null>(null)
  const [paramValues, setParamValues] = useState<MetaTemplateParameterValues>({ body: {} })
  const [loadTrigger, setLoadTrigger] = useState(0)   // incrementar → retry
  // MVP4B.4D.2C: picker_id do asset selecionado ('cml:<uuid>' ou 'lmu:<uuid>').
  // Limpo a cada troca de template — nunca persiste entre seleções diferentes.
  const [selectedPickerId, setSelectedPickerId] = useState<string | null>(null)

  // loadGenRef: invalidar loads stale ao reabrir ou ao retomar
  const loadGenRef = useRef(0)

  // Carregamento paginado ao abrir (ou ao retomar via loadTrigger)
  useEffect(() => {
    if (!open) return

    loadGenRef.current += 1
    const gen = loadGenRef.current

    setLoadState('loading')
    setLoadError(null)
    setTemplates([])
    setTruncated(false)
    setSelected(null)
    setParamValues({ body: {} })

    let cancelled = false

    async function load() {
      const collected: MetaWhatsAppTemplate[] = []
      let afterCursor: string | undefined = undefined
      let wasTruncated = false
      const MAX_PAGES = 3

      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          if (cancelled || loadGenRef.current !== gen) return

          const opts = afterCursor ? { after: afterCursor } : undefined
          const res  = await metaWhatsAppApi.listTemplates(companyId, instanceId, opts)

          if (cancelled || loadGenRef.current !== gen) return

          for (const t of res.templates) {
            if (t.supported) collected.push(t)
          }

          if (!res.next_cursor) { afterCursor = undefined; break }

          afterCursor = res.next_cursor
          if (page === MAX_PAGES - 1) wasTruncated = true
        }

        if (cancelled || loadGenRef.current !== gen) return

        setTemplates(collected)
        setTruncated(wasTruncated)
        setLoadState('done')
      } catch (err) {
        if (cancelled || loadGenRef.current !== gen) return
        setLoadError(err instanceof Error ? err.message : 'Erro ao carregar templates')
        setLoadState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [open, companyId, instanceId, loadTrigger])

  const handleSelect = useCallback((tmpl: MetaWhatsAppTemplate) => {
    setSelected(tmpl)
    setParamValues(initParamValues(tmpl))
    // MVP4B: resetar picker ao trocar de template — seleção anterior é incompatível.
    setSelectedPickerId(null)
  }, [])

  const handleParamChange = useCallback((component: 'HEADER' | 'BODY', key: string, value: string) => {
    setParamValues(prev =>
      component === 'HEADER'
        ? { ...prev, header: { ...(prev.header ?? {}), [key]: value } }
        : { ...prev, body: { ...prev.body, [key]: value } },
    )
  }, [])

  // MVP4B: template tem HEADER media se header_media_format for IMAGE/VIDEO/DOCUMENT.
  // undefined é tratado como null (templates MVP4A sem este campo).
  const hasMediaHeader = selected?.header_media_format != null

  const handleSend = useCallback(async () => {
    if (!selected || sending || !paramsComplete(selected, paramValues)) return
    if (hasMediaHeader && !selectedPickerId) return
    await onSend(
      selected,
      paramValues,
      hasMediaHeader ? (selectedPickerId ?? undefined) : undefined,
    )
  }, [selected, sending, paramValues, hasMediaHeader, selectedPickerId, onSend])

  if (!open) return null

  const textComplete = !!selected && paramsComplete(selected, paramValues)
  const mediaComplete = !hasMediaHeader || Boolean(selectedPickerId)
  const canSend      = textComplete && mediaComplete && !sending
  const preview      = selected ? buildPreview(selected.components, selected.parameters, paramValues) : null
  const headerParams = selected?.parameters.filter(p => p.component === 'HEADER') ?? []
  const bodyParams   = selected?.parameters.filter(p => p.component === 'BODY')   ?? []

  return (
    <div
      className="fixed inset-0 bg-black/30 z-40 flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      data-testid="template-picker-overlay"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60 flex-shrink-0">
          <h2 className="font-semibold text-slate-800 text-sm">Templates de mensagem</h2>
          <button type="button" onClick={onClose} aria-label="Fechar picker"
            className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {loadState === 'loading' && (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin h-6 w-6 rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          )}

          {loadState === 'error' && (
            <div className="p-6 text-center">
              <p className="text-sm text-red-600 mb-3">{loadError ?? 'Erro ao carregar templates.'}</p>
              <button type="button" onClick={() => setLoadTrigger(t => t + 1)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                Tentar novamente
              </button>
            </div>
          )}

          {loadState === 'done' && (
            <div className="flex flex-col">
              {truncated && (
                <p className="text-xs text-amber-600 bg-amber-50 px-4 py-2 border-b border-amber-100">
                  Alguns templates não foram carregados.
                </p>
              )}

              {templates.length === 0 ? (
                <p className="text-sm text-slate-500 text-center p-8">Nenhum template disponível.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {templates.map(tmpl => {
                    const isSelected = selected?.id === tmpl.id && selected?.language === tmpl.language
                    return (
                      <button key={`${tmpl.id}:${tmpl.language}`} type="button"
                        onClick={() => handleSelect(tmpl)}
                        data-selected={isSelected}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-slate-50'
                        }`}>
                        <p className="text-sm font-medium text-slate-800">{tmpl.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{tmpl.language} · {tmpl.category}</p>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Parâmetros */}
              {selected && selected.parameters.length > 0 && (
                <div className="px-4 py-4 border-t border-slate-100 space-y-3">
                  <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Parâmetros</p>
                  {headerParams.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400">Cabeçalho</p>
                      {headerParams.map(p => (
                        <input key={`header-${p.key}`} type="text"
                          aria-label={`Parâmetro HEADER ${p.key}`}
                          placeholder={p.example ?? p.key}
                          value={paramValues.header?.[p.key] ?? ''}
                          onChange={e => handleParamChange('HEADER', p.key, e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                      ))}
                    </div>
                  )}
                  {bodyParams.length > 0 && (
                    <div className="space-y-2">
                      {headerParams.length > 0 && <p className="text-xs text-slate-400">Corpo</p>}
                      {bodyParams.map(p => (
                        <input key={`body-${p.key}`} type="text"
                          aria-label={`Parâmetro BODY ${p.key}`}
                          placeholder={p.example ?? p.key}
                          value={paramValues.body[p.key] ?? ''}
                          onChange={e => handleParamChange('BODY', p.key, e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MVP4B — Seletor de mídia (somente para templates com HEADER media) */}
              {selected && hasMediaHeader && (
                <MetaMediaAssetSelector
                  companyId={companyId}
                  mediaFormat={selected.header_media_format as MediaAssetFormat}
                  selectedPickerId={selectedPickerId}
                  onSelect={asset => setSelectedPickerId(asset.picker_id)}
                  disabled={sending}
                />
              )}

              {/* Preview */}
              {preview && (preview.header || preview.body || preview.footer) && (
                <div className="mx-4 mb-4 rounded-xl bg-slate-50 p-3 border border-slate-200/60">
                  <p className="text-xs font-medium text-slate-500 mb-2">Pré-visualização</p>
                  {preview.header && <p className="text-xs font-semibold text-slate-700 mb-1" data-testid="preview-header">{preview.header}</p>}
                  {preview.body   && <p className="text-sm text-slate-700 leading-relaxed break-words whitespace-pre-wrap" data-testid="preview-body">{preview.body}</p>}
                  {preview.footer && <p className="text-xs text-slate-400 mt-1 italic" data-testid="preview-footer">{preview.footer}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-slate-200/60 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleSend} disabled={!canSend} aria-label="Enviar template"
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useId, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { MetaAdminWhatsAppTemplate, MetaTemplateGraphStatus } from '../../types/meta-whatsapp'
import {
  findComponent,
  graphButtons,
  headerMediaPreview,
  stringifyUnknown,
  unknownComponents,
} from './metaTemplateDetailsModel'

const STATUS_BADGE: Record<MetaTemplateGraphStatus, string> = {
  APPROVED:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING:           'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED:          'bg-red-50 text-red-700 border-red-200',
  PAUSED:            'bg-slate-100 text-slate-600 border-slate-200',
  DISABLED:          'bg-slate-100 text-slate-600 border-slate-200',
  IN_APPEAL:         'bg-sky-50 text-sky-700 border-sky-200',
  PENDING_DELETION:  'bg-slate-100 text-slate-600 border-slate-200',
}

function StatusBadge({ status }: { status: MetaTemplateGraphStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_BADGE[status] ?? STATUS_BADGE.PAUSED}`}>
      {status}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="text-sm text-slate-800 break-words whitespace-pre-wrap">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-slate-400">{children}</span>
}

export function MetaTemplateDetails({
  template,
  onClose,
}: {
  template: MetaAdminWhatsAppTemplate
  onClose: () => void
}) {
  const [techOpen, setTechOpen] = useState(false)
  const techId = useId()
  const header = findComponent(template.components, 'HEADER')
  const body = findComponent(template.components, 'BODY')
  const footer = findComponent(template.components, 'FOOTER')
  const buttonsComponent = findComponent(template.components, 'BUTTONS')
  const buttons = graphButtons(buttonsComponent)
  const extras = unknownComponents(template.components)
  const media = headerMediaPreview(header)
  const hasHeaderText = typeof header?.text === 'string' && header.text.length > 0
  const hasBodyText = typeof body?.text === 'string' && body.text.length > 0
  const hasFooterText = typeof footer?.text === 'string' && footer.text.length > 0
  const hasMediaHeader = Boolean(media.format && media.format !== 'TEXT')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar à lista
        </button>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900 break-words">{template.name}</h3>
          <StatusBadge status={template.status} />
        </div>
        <p className="text-xs text-slate-500 break-words">{template.language} · {template.category}</p>
        {template.rejected_reason ? (
          <p className="text-sm text-red-700 break-words whitespace-pre-wrap">
            Motivo de rejeição: {template.rejected_reason}
          </p>
        ) : null}
        {template.supported === false ? (
          <p className="text-xs text-amber-700 break-words whitespace-pre-wrap">
            Este modelo não é suportado para envio no chat
            {template.unsupported_reason ? `: ${template.unsupported_reason}` : '.'}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900">Prévia da mensagem</h4>
        <div className="max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          {hasMediaHeader ? (
            <div className="space-y-1">
              {media.format === 'IMAGE' && media.previewUrl ? (
                <img src={media.previewUrl} alt="Prévia do cabeçalho" className="max-w-full rounded-lg" />
              ) : null}
              {media.format === 'VIDEO' && media.previewUrl ? (
                <video src={media.previewUrl} controls className="max-w-full rounded-lg" />
              ) : null}
              {media.format === 'DOCUMENT' && media.previewUrl ? (
                <a href={media.previewUrl} target="_blank" rel="noreferrer" className="text-sm text-green-700 underline break-all">
                  {media.previewUrl}
                </a>
              ) : null}
              {media.unavailableReason ? (
                <p className="text-xs text-slate-500 whitespace-pre-wrap">{media.unavailableReason}</p>
              ) : null}
            </div>
          ) : null}
          {hasHeaderText ? (
            <p className="text-sm font-semibold text-slate-900 whitespace-pre-wrap break-words">{header?.text}</p>
          ) : null}
          {hasBodyText ? (
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{body?.text}</p>
          ) : null}
          {hasFooterText ? (
            <p className="text-xs text-slate-500 whitespace-pre-wrap break-words">{footer?.text}</p>
          ) : null}
          {buttons.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              {buttons.map((button, index) => (
                <div
                  key={`preview-btn-${index}`}
                  className="rounded-lg border border-green-200 bg-white px-3 py-2 text-center text-sm text-green-800 whitespace-pre-wrap break-words"
                >
                  {typeof button.text === 'string' && button.text.length > 0
                    ? button.text
                    : `Botão ${index + 1}`}
                </div>
              ))}
            </div>
          ) : null}
          {extras.map((component, index) => (
            <p key={`preview-extra-${index}`} className="text-xs text-slate-500">
              Componente adicional: {component.type || 'desconhecido'}
            </p>
          ))}
        </div>
      </section>

      <div>
        <button
          type="button"
          aria-expanded={techOpen}
          aria-controls={techId}
          onClick={() => setTechOpen((current) => !current)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          {techOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {techOpen ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
        </button>
      </div>

      {techOpen ? (
        <section id={techId} className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-900">Detalhes técnicos</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">{template.name}</Field>
            <Field label="ID">{template.id}</Field>
            <Field label="Idioma">{template.language}</Field>
            <Field label="Categoria">{template.category}</Field>
            <Field label="Status">{template.status}</Field>
            <Field label="Formato das variáveis">{template.parameter_format}</Field>
            <Field label="Suportado no chat">{template.supported ? 'sim' : 'não'}</Field>
            <Field label="Motivo unsupported">{template.unsupported_reason || <Empty>nenhum</Empty>}</Field>
            <Field label="Motivo de rejeição">{template.rejected_reason || <Empty>nenhum</Empty>}</Field>
            <Field label="Qualidade">
              {template.quality_score
                ? `${template.quality_score.score ?? '—'} ${template.quality_score.date ?? ''}`
                : <Empty>não informado</Empty>}
            </Field>
          </div>

          <ComponentBlock title="HEADER" component={header} extra={
            media.format ? (
              <div className="space-y-1">
                <p>Formato de mídia: {media.format}</p>
                {media.urls.map((url) => (
                  <p key={url} className="break-all">Exemplo de mídia: {url}</p>
                ))}
                {media.unavailableReason ? <p>{media.unavailableReason}</p> : null}
              </div>
            ) : null
          } />
          <ComponentBlock title="BODY" component={body} />
          <ComponentBlock title="FOOTER" component={footer} />

          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">BUTTONS</p>
            {buttons.length === 0 ? <Empty>Nenhum botão</Empty> : buttons.map((button, index) => (
              <div key={`btn-${index}`} className="rounded-md bg-slate-50 p-3 space-y-1 text-sm whitespace-pre-wrap break-words">
                {Object.entries(button).map(([key, value]) => (
                  <p key={key}><span className="text-slate-500">{key}:</span> {stringifyUnknown(value)}</p>
                ))}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Variáveis</p>
            {template.parameters.length === 0 ? (
              <Empty>Nenhuma variável extraída do texto</Empty>
            ) : (
              template.parameters.map((param) => (
                <p key={`${param.component}:${param.key}`} className="text-sm whitespace-pre-wrap break-words">
                  {param.component} · {param.key}
                  {param.position != null ? ` · posição ${param.position}` : ''}
                  {param.example != null ? ` · exemplo: ${param.example}` : ' · exemplo: não informado'}
                </p>
              ))
            )}
          </div>

          {extras.map((component, index) => (
            <ComponentBlock
              key={`extra-${component.type}-${index}`}
              title={`Componente adicional: ${component.type || 'desconhecido'}`}
              component={component}
            />
          ))}
        </section>
      ) : null}
    </div>
  )
}

function ComponentBlock({
  title,
  component,
  extra,
}: {
  title: string
  component: Record<string, unknown> | undefined
  extra?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      {!component ? (
        <Empty>Ausente</Empty>
      ) : (
        Object.entries(component).map(([key, value]) => (
          <div key={key} className="text-sm whitespace-pre-wrap break-words">
            <span className="text-slate-500">{key}: </span>
            {stringifyUnknown(value)}
          </div>
        ))
      )}
      {extra ? <div className="text-sm whitespace-pre-wrap break-words">{extra}</div> : null}
    </div>
  )
}

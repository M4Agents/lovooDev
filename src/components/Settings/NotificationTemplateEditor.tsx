// ============================================================
// Editor de template de notificação
// Campos editáveis: name, subject (email only), body, is_active
// Preview textual com valores de exemplo (sem HTML real)
// ============================================================

import React, { useState, useEffect, useMemo } from 'react'
import { Loader2, Save, X, Eye, AlertTriangle } from 'lucide-react'
import { updateNotificationTemplate, type NotificationTemplateDTO } from '../../services/notificationsApi'

// ── Variáveis de preview ──────────────────────────────────────────────────────

const PREVIEW_VALUES: Record<string, string> = {
  company_name:   'Empresa Exemplo',
  days_remaining: '3',
  trial_end_date: '10/05/2026',
  plan_name:      'Growth',
  cta_url:        'https://app.lovoocrm.com/settings?tab=planos-uso',
  admin_name:     'João',
}

const VARIABLES_BY_EVENT: Record<string, string[]> = {
  trial_alert: ['company_name', 'days_remaining', 'trial_end_date', 'plan_name', 'cta_url', 'admin_name'],
}

function applyPreview(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    PREVIEW_VALUES[key] !== undefined ? PREVIEW_VALUES[key] : match
  )
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Props {
  template: NotificationTemplateDTO
  onSave: (updated: NotificationTemplateDTO) => void
  onCancel: () => void
}

// ── Componente ────────────────────────────────────────────────────────────────

export const NotificationTemplateEditor: React.FC<Props> = ({ template, onSave, onCancel }) => {
  const [form, setForm] = useState({
    name:      template.name,
    subject:   template.subject ?? '',
    body:      template.body,
    is_active: template.is_active,
  })
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Resetar form quando template mudar (ex: editar outro)
  useEffect(() => {
    setForm({
      name:      template.name,
      subject:   template.subject ?? '',
      body:      template.body,
      is_active: template.is_active,
    })
    setError(null)
  }, [template.id])

  const isEmail    = template.channel === 'email'
  const allowedVars = VARIABLES_BY_EVENT[template.event_type] ?? []

  const previewBody    = useMemo(() => applyPreview(form.body),    [form.body])
  const previewSubject = useMemo(() => applyPreview(form.subject), [form.subject])

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const updated = await updateNotificationTemplate(template.id, {
        name:      form.name.trim(),
        subject:   isEmail ? (form.subject.trim() || null) : null,
        body:      form.body,
        is_active: form.is_active,
      })
      onSave(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar template')
    } finally {
      setSaving(false)
    }
  }

  const eventLabel = `${template.event_type}${template.event_subtype ? ` / ${template.event_subtype}` : ''}`
  const channelLabel = template.channel === 'email' ? 'E-mail' : 'WhatsApp'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Editar Template</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Evento: <span className="font-medium text-slate-700">{eventLabel}</span>
            {' · '}Canal: <span className="font-medium text-slate-700">{channelLabel}</span>
          </p>
          <p className="text-xs text-slate-400 mt-1 italic">
            O layout visual do e-mail é controlado pelo sistema — apenas o conteúdo é editável.
          </p>
        </div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* is_active */}
      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
        <div>
          <p className="text-sm font-medium text-slate-800">Template ativo</p>
          <p className="text-xs text-slate-500">Desative para pausar o envio sem excluir</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={form.is_active}
            onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
          />
          <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
        </label>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Nome interno</label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Nome de identificação do template"
        />
      </div>

      {/* Subject — apenas email */}
      {isEmail && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Assunto do e-mail</label>
          <input
            type="text"
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Assunto que o destinatário verá"
          />
        </div>
      )}

      {/* Body */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Corpo da mensagem</label>
        <textarea
          rows={6}
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono resize-y"
          placeholder="Texto da mensagem com {{variáveis}}"
        />
      </div>

      {/* Variáveis disponíveis */}
      {allowedVars.length > 0 && (
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-xs font-semibold text-blue-800 mb-2">Variáveis disponíveis</p>
          <div className="flex flex-wrap gap-1.5">
            {allowedVars.map(v => (
              <code
                key={v}
                className="px-2 py-0.5 bg-white border border-blue-200 text-blue-700 text-xs rounded cursor-pointer hover:bg-blue-100 transition-colors"
                title={`Copiar: {{${v}}}`}
                onClick={() => navigator.clipboard?.writeText(`{{${v}}}`).catch(() => null)}
              >
                {`{{${v}}}`}
              </code>
            ))}
          </div>
          <p className="text-xs text-blue-600 mt-1.5">Clique em uma variável para copiar</p>
        </div>
      )}

      {/* Preview */}
      <div>
        <button
          type="button"
          onClick={() => setShowPreview(p => !p)}
          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-600 transition-colors"
        >
          <Eye className="w-4 h-4" />
          {showPreview ? 'Ocultar preview' : 'Ver preview com valores de exemplo'}
        </button>

        {showPreview && (
          <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            {isEmail && form.subject && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Assunto</p>
                <p className="text-sm text-slate-800">{previewSubject}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Corpo</p>
              <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans">{previewBody}</pre>
            </div>
            <p className="text-xs text-slate-400 italic">Preview com valores fictícios — não reflete dados reais</p>
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !form.name.trim() || !form.body.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar template
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

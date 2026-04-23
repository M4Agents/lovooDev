// ============================================================
// Painel de Notificações Automáticas — Configurações Admin
// Seção: Governância Lovoo → Notificações
// Acesso: super_admin e system_admin da empresa pai
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, Bell, Mail, Save, Edit, AlertTriangle, Check } from 'lucide-react'
import {
  fetchNotificationsSettings,
  saveNotificationsSettings,
  fetchNotificationTemplates,
  type NotificationsSettingsDTO,
  type NotificationTemplateDTO,
  type NotificationChannel,
} from '../../services/notificationsApi'
import { NotificationTemplateEditor } from './NotificationTemplateEditor'

// ── Ícone WhatsApp inline ─────────────────────────────────────────────────────

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.63" />
  </svg>
)

// ── Helpers visuais ───────────────────────────────────────────────────────────

function eventLabel(eventType: string, eventSubtype: string | null): string {
  const labels: Record<string, string> = {
    'trial_alert:3d': 'Trial expirando — 3 dias',
    'trial_alert:1d': 'Trial expirando — 1 dia',
  }
  const key = eventSubtype ? `${eventType}:${eventSubtype}` : eventType
  return labels[key] ?? (eventSubtype ? `${eventType} / ${eventSubtype}` : eventType)
}

// ── Componente principal ───────────────────────────────────────────────────────

export const NotificationsPanel: React.FC = () => {
  // ── Estado de carregamento ─────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── Dados carregados ───────────────────────────────────────────────────────
  const [settings,  setSettings]  = useState<NotificationsSettingsDTO | null>(null)
  const [templates, setTemplates] = useState<NotificationTemplateDTO[]>([])

  // ── Estado do formulário de canais ─────────────────────────────────────────
  const [cfgEnabled,   setCfgEnabled]   = useState(false)
  const [cfgChannels,  setCfgChannels]  = useState<NotificationChannel[]>([])
  const [cfgWaId,      setCfgWaId]      = useState<string | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  // ── Estado de edição de template ───────────────────────────────────────────
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplateDTO | null>(null)

  // ── Carregamento inicial ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [cfg, tpls] = await Promise.all([
        fetchNotificationsSettings(),
        fetchNotificationTemplates(),
      ])
      setSettings(cfg)
      setTemplates(tpls)
      // Inicializar form de canais com dados do backend
      setCfgEnabled(cfg.enabled)
      setCfgChannels(cfg.enabled_channels)
      setCfgWaId(cfg.whatsapp_instance_id)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar configurações')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Handlers de canais ─────────────────────────────────────────────────────
  const toggleChannel = (ch: NotificationChannel) => {
    setCfgChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    )
    setSaveMsg(null)
    if (ch === 'whatsapp' && cfgChannels.includes('whatsapp')) {
      setCfgWaId(null)
    }
  }

  const handleSaveSettings = async () => {
    setSaveMsg(null)
    setSaving(true)
    try {
      await saveNotificationsSettings({
        enabled:              cfgEnabled,
        enabled_channels:     cfgChannels,
        whatsapp_instance_id: cfgWaId,
      })
      setSaveMsg({ ok: true, text: 'Configurações salvas com sucesso.' })
      // Atualizar settings local para manter coerência
      setSettings(prev => prev ? { ...prev, enabled: cfgEnabled, enabled_channels: cfgChannels, whatsapp_instance_id: cfgWaId } : prev)
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : 'Erro ao salvar' })
    } finally {
      setSaving(false)
    }
  }

  // ── Handlers de template ───────────────────────────────────────────────────
  const handleTemplateSaved = (updated: NotificationTemplateDTO) => {
    setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
    setEditingTemplate(null)
  }

  // ── Estados de carregamento / erro ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
        <p className="text-sm">Carregando configurações de notificações…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6 flex items-start gap-3 text-red-700 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <span>{loadError}</span>
      </div>
    )
  }

  // ── Editor de template (view exclusiva) ────────────────────────────────────
  if (editingTemplate) {
    return (
      <NotificationTemplateEditor
        template={editingTemplate}
        onSave={handleTemplateSaved}
        onCancel={() => setEditingTemplate(null)}
      />
    )
  }

  const waEnabled  = cfgChannels.includes('whatsapp')
  const canSave    = !saving && !(waEnabled && cfgEnabled && !cfgWaId)

  // ── Render principal ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600" />
              Notificações Automáticas
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Configure os canais de envio e edite os templates de alertas de trial.
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            cfgEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
          }`}>
            {cfgEnabled ? 'Ativo' : 'Inativo'}
          </span>
        </div>
      </div>

      {/* ── Configuração de canais ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Configuração de Canais</h3>

        {/* Toggle geral */}
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-900">Sistema de notificações ativo</p>
            <p className="text-xs text-slate-500">Quando desativado, nenhum alerta é enviado</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" className="sr-only peer" checked={cfgEnabled}
              onChange={e => { setCfgEnabled(e.target.checked); setSaveMsg(null) }} />
            <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
          </label>
        </div>

        {/* Canal E-mail */}
        <div className="flex items-center gap-3 p-3 border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          onClick={() => toggleChannel('email')}>
          <input type="checkbox" readOnly checked={cfgChannels.includes('email')}
            className="w-4 h-4 text-blue-600 rounded border-slate-300 pointer-events-none" />
          <Mail className="w-4 h-4 text-slate-500" />
          <div>
            <p className="text-sm font-medium text-slate-800">E-mail</p>
            <p className="text-xs text-slate-500">Enviado via Resend para os admins da empresa</p>
          </div>
        </div>

        {/* Canal WhatsApp */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => toggleChannel('whatsapp')}>
            <input type="checkbox" readOnly checked={waEnabled}
              className="w-4 h-4 text-blue-600 rounded border-slate-300 pointer-events-none" />
            <WhatsAppIcon className="w-4 h-4 text-green-600" />
            <div>
              <p className="text-sm font-medium text-slate-800">WhatsApp</p>
              <p className="text-xs text-slate-500">Enviado via Uazapi para o telefone principal da empresa</p>
            </div>
          </div>

          {/* Dropdown de instâncias — aparece quando WA está habilitado */}
          {waEnabled && (
            <div className="ml-7 space-y-1">
              <label className="block text-xs font-medium text-slate-700">Instância WhatsApp</label>
              {(settings?.available_instances ?? []).length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Nenhuma instância conectada disponível. Conecte uma instância em Integrações → WhatsApp.
                </p>
              ) : (
                <select
                  value={cfgWaId ?? ''}
                  onChange={e => { setCfgWaId(e.target.value || null); setSaveMsg(null) }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">Selecione uma instância…</option>
                  {(settings?.available_instances ?? []).map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              )}
              {waEnabled && cfgEnabled && !cfgWaId && (
                <p className="text-xs text-red-600">Selecione uma instância para salvar.</p>
              )}
            </div>
          )}
        </div>

        {/* Feedback de save */}
        {saveMsg && (
          <div className={`flex items-center gap-2 text-sm ${saveMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
            {saveMsg.ok ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {saveMsg.text}
          </div>
        )}

        <button type="button" onClick={() => void handleSaveSettings()} disabled={!canSave}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configurações
        </button>
      </div>

      {/* ── Templates ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Templates de Mensagem</h3>

        {templates.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">Nenhum template encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100">
                  <th className="pb-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Evento</th>
                  <th className="pb-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Canal</th>
                  <th className="pb-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome</th>
                  <th className="pb-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {templates.map(tpl => (
                  <tr key={tpl.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 pr-4 text-slate-700">{eventLabel(tpl.event_type, tpl.event_subtype)}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        tpl.channel === 'whatsapp'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {tpl.channel === 'whatsapp'
                          ? <WhatsAppIcon className="w-3 h-3" />
                          : <Mail className="w-3 h-3" />}
                        {tpl.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700 max-w-[200px] truncate" title={tpl.name}>{tpl.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        tpl.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {tpl.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <button
                        onClick={() => setEditingTemplate(tpl)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                      >
                        <Edit className="w-3 h-3" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}

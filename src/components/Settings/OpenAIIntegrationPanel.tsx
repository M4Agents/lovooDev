// =====================================================
// Painel Configurações → Integrações → OpenAI
// =====================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles, Save, PlugZap } from 'lucide-react'
import {
  fetchOpenAISettings,
  patchOpenAISettings,
  postOpenAIConnectionTest,
  type OpenAIIntegrationSettingsDTO,
} from '../../services/openaiIntegrationApi'

const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 600_000

export const OpenAIIntegrationPanel: React.FC = () => {
  const { t } = useTranslation('settings.app')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [testMessage, setTestMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [form, setForm] = useState<OpenAIIntegrationSettingsDTO>({
    enabled: false,
    model: 'gpt-4.1-mini',
    timeout_ms: 60_000,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const s = await fetchOpenAISettings()
      setForm(s)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('integrations.openai.errors.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    setSaveMessage(null)
    setSaving(true)
    try {
      const s = await patchOpenAISettings({
        enabled: form.enabled,
        model: form.model.trim(),
        timeout_ms: form.timeout_ms,
      })
      setForm(s)
      setSaveMessage({ type: 'ok', text: t('integrations.openai.messages.saved') })
    } catch (e) {
      setSaveMessage({
        type: 'err',
        text: e instanceof Error ? e.message : t('integrations.openai.errors.save'),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTestMessage(null)
    setTesting(true)
    try {
      await postOpenAIConnectionTest()
      setTestMessage({ type: 'ok', text: t('integrations.openai.messages.testOk') })
    } catch (e) {
      setTestMessage({
        type: 'err',
        text: e instanceof Error ? e.message : t('integrations.openai.errors.test'),
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        <p className="text-sm">{t('integrations.openai.loading')}</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6 text-red-700 text-sm">
        {loadError}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            {t('integrations.openai.title')}
          </h2>
          <p className="text-sm text-slate-600 mt-1">{t('integrations.openai.subtitle')}</p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            form.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {form.enabled ? t('integrations.openai.status.active') : t('integrations.openai.status.inactive')}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
        <div>
          <p className="text-sm font-medium text-slate-900">{t('integrations.openai.fields.enabled')}</p>
          <p className="text-xs text-slate-500">{t('integrations.openai.fields.enabledHint')}</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.openai.fields.model')}
          </label>
          <input
            type="text"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            autoComplete="off"
          />
          <p className="text-xs text-slate-500 mt-1">{t('integrations.openai.fields.modelHint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.openai.fields.timeout')}
          </label>
          <input
            type="number"
            min={TIMEOUT_MIN}
            max={TIMEOUT_MAX}
            step={1000}
            value={form.timeout_ms}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(v)) {
                setForm((f) => ({ ...f, timeout_ms: Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, v)) }))
              }
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            {t('integrations.openai.fields.timeoutHint', { min: TIMEOUT_MIN, max: TIMEOUT_MAX })}
          </p>
        </div>
      </div>

      {saveMessage && (
        <p
          className={`text-sm ${saveMessage.type === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
          role="status"
        >
          {saveMessage.text}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('integrations.openai.actions.save')}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
          {t('integrations.openai.actions.test')}
        </button>
      </div>

      {testMessage && (
        <p
          className={`text-sm ${testMessage.type === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
          role="status"
        >
          {testMessage.text}
        </p>
      )}
    </div>
  )
}

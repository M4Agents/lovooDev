// =====================================================
// Painel Configurações → Integrações → ElevenLabs
// =====================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic2, Save, PlugZap } from 'lucide-react'
import {
  fetchElevenLabsSettings,
  patchElevenLabsSettings,
  postElevenLabsConnectionTest,
  type ElevenLabsIntegrationSettingsDTO,
} from '../../services/elevenLabsIntegrationApi'

const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 600_000

export const ElevenLabsIntegrationPanel: React.FC = () => {
  const { t } = useTranslation('settings.app')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [testMessage, setTestMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [form, setForm] = useState<ElevenLabsIntegrationSettingsDTO>({
    enabled: false,
    timeout_ms: 60_000,
    provider_config: { version: 1 },
    api_key_configured: false,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const s = await fetchElevenLabsSettings()
      setForm(s)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('integrations.elevenlabs.errors.load'))
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
      const s = await patchElevenLabsSettings({
        enabled: form.enabled,
        timeout_ms: form.timeout_ms,
      })
      setForm(s)
      setSaveMessage({ type: 'ok', text: t('integrations.elevenlabs.messages.saved') })
    } catch (e) {
      setSaveMessage({
        type: 'err',
        text: e instanceof Error ? e.message : t('integrations.elevenlabs.errors.save'),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTestMessage(null)
    setTesting(true)
    try {
      await postElevenLabsConnectionTest()
      setTestMessage({ type: 'ok', text: t('integrations.elevenlabs.messages.testOk') })
    } catch (e) {
      setTestMessage({
        type: 'err',
        text: e instanceof Error ? e.message : t('integrations.elevenlabs.errors.test'),
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="text-sm">{t('integrations.elevenlabs.loading')}</p>
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
            <Mic2 className="w-5 h-5 text-indigo-600" />
            {t('integrations.elevenlabs.title')}
          </h2>
          <p className="text-sm text-slate-600 mt-1">{t('integrations.elevenlabs.subtitle')}</p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            form.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {form.enabled ? t('integrations.elevenlabs.status.active') : t('integrations.elevenlabs.status.inactive')}
        </span>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">{t('integrations.elevenlabs.apiKeyStatus.label')}</p>
        <p className="mt-1 text-slate-600">
          {form.api_key_configured
            ? t('integrations.elevenlabs.apiKeyStatus.configured')
            : t('integrations.elevenlabs.apiKeyStatus.missing')}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
        <div>
          <p className="text-sm font-medium text-slate-900">{t('integrations.elevenlabs.fields.enabled')}</p>
          <p className="text-xs text-slate-500">{t('integrations.elevenlabs.fields.enabledHint')}</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.elevenlabs.fields.timeout')}
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
                setForm((f) => ({
                  ...f,
                  timeout_ms: Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, v)),
                }))
              }
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            {t('integrations.elevenlabs.fields.timeoutHint', { min: TIMEOUT_MIN, max: TIMEOUT_MAX })}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.elevenlabs.fields.configVersion')}
          </label>
          <input
            type="text"
            readOnly
            value={String(form.provider_config.version)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-600"
          />
          <p className="text-xs text-slate-500 mt-1">{t('integrations.elevenlabs.fields.configVersionHint')}</p>
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('integrations.elevenlabs.actions.save')}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
          {t('integrations.elevenlabs.actions.test')}
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

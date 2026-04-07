/**
 * Formulário de criação / edição de um agente Lovoo.
 * Exibido como slide-in inline (não modal) dentro do LovooAgentsPanel.
 *
 * Exibição condicional por knowledge_mode:
 *   none   → sem knowledge_base, sem documentos
 *   inline → com knowledge_base, sem documentos
 *   rag    → sem knowledge_base, com documentos + config RAG
 *   hybrid → com knowledge_base, com documentos + config RAG
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Loader2, Save, X } from 'lucide-react'
import { lovooAgentsApi } from '../../services/lovooAgentsApi'
import { LovooAgentDocuments } from './LovooAgentDocuments'
import type {
  CreateAgentPayload,
  KnowledgeMode,
  LovooAgent,
  UpdateAgentPayload,
} from '../../types/lovoo-agents'

type Props = {
  companyId: string
  /** undefined = criação */
  agent?: LovooAgent
  /** IDs de modelos OpenAI disponíveis na conta */
  modelIds: string[]
  onSaved: (agent: LovooAgent) => void
  onCancel: () => void
}

type FormState = {
  name:           string
  description:    string
  is_active:      boolean
  model:          string
  prompt:         string
  knowledge_mode: KnowledgeMode
  knowledge_base: string
  top_k:          string
  min_similarity: string
  temperature:    string
  max_tokens:     string
}

function toForm(agent?: LovooAgent, defaultModel = 'gpt-4.1-mini'): FormState {
  return {
    name:           agent?.name ?? '',
    description:    agent?.description ?? '',
    is_active:      agent?.is_active ?? true,
    model:          agent?.model ?? defaultModel,
    prompt:         agent?.prompt ?? '',
    knowledge_mode: agent?.knowledge_mode ?? 'inline',
    knowledge_base: agent?.knowledge_base ?? '',
    top_k:          String(agent?.knowledge_base_config?.top_k ?? 5),
    min_similarity: String(agent?.knowledge_base_config?.min_similarity ?? 0),
    temperature:    String(agent?.model_config?.temperature ?? 0.7),
    max_tokens:     String(agent?.model_config?.max_tokens ?? 1024),
  }
}

const KNOWLEDGE_MODE_OPTIONS: KnowledgeMode[] = ['none', 'inline', 'rag', 'hybrid']

export const LovooAgentForm: React.FC<Props> = ({
  companyId,
  agent,
  modelIds,
  onSaved,
  onCancel,
}) => {
  const { t } = useTranslation('agents')

  const defaultModel = modelIds[0] ?? 'gpt-4.1-mini'
  const [form,   setForm]   = useState<FormState>(() => toForm(agent, defaultModel))
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    setForm(toForm(agent, defaultModel))
    setError(null)
  }, [agent, defaultModel])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const allModelOptions = (() => {
    const current = form.model.trim()
    const seen = new Set(modelIds)
    if (current) seen.add(current)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  })()

  const showKnowledgeBase = form.knowledge_mode === 'inline' || form.knowledge_mode === 'hybrid'
  const showRagConfig     = form.knowledge_mode === 'rag'    || form.knowledge_mode === 'hybrid'
  const showDocuments     = showRagConfig

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!form.name.trim()) return

    const temperature  = parseFloat(form.temperature)
    const max_tokens   = parseInt(form.max_tokens, 10)
    const top_k        = parseInt(form.top_k, 10)
    const minSimilarity = parseFloat(form.min_similarity)

    setSaving(true)
    try {
      let saved: LovooAgent

      const knowledgeBaseConfig = showRagConfig
        ? {
            top_k:          Number.isFinite(top_k) && top_k > 0 ? top_k : 5,
            min_similarity: Number.isFinite(minSimilarity) ? Math.min(1, Math.max(0, minSimilarity)) : 0,
          }
        : {}

      if (agent) {
        const patch: UpdateAgentPayload = {
          name:                  form.name,
          description:           form.description || null,
          is_active:             form.is_active,
          model:                 form.model,
          prompt:                form.prompt || null,
          knowledge_mode:        form.knowledge_mode,
          knowledge_base:        showKnowledgeBase ? (form.knowledge_base || null) : null,
          knowledge_base_config: knowledgeBaseConfig,
          model_config: {
            temperature: Number.isFinite(temperature) ? temperature : 0.7,
            max_tokens:  Number.isFinite(max_tokens)  ? max_tokens  : 1024,
          },
        }
        saved = await lovooAgentsApi.updateAgent(agent.id, patch)
      } else {
        const payload: CreateAgentPayload = {
          company_id:            companyId,
          name:                  form.name,
          description:           form.description || null,
          is_active:             form.is_active,
          model:                 form.model,
          prompt:                form.prompt || null,
          knowledge_mode:        form.knowledge_mode,
          knowledge_base:        showKnowledgeBase ? (form.knowledge_base || null) : null,
          knowledge_base_config: knowledgeBaseConfig,
          model_config: {
            temperature: Number.isFinite(temperature) ? temperature : 0.7,
            max_tokens:  Number.isFinite(max_tokens)  ? max_tokens  : 1024,
          },
        }
        saved = await lovooAgentsApi.createAgent(payload)
      }

      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-slate-900">
          {agent ? t('form.titleEdit') : t('form.titleCreate')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          aria-label={t('form.actions.cancel')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">

        {/* Nome e status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('form.fields.name')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('form.fields.namePlaceholder')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col justify-end">
            <div className="flex items-center justify-between gap-4 p-3 bg-slate-50 rounded-lg border border-slate-100 h-[42px]">
              <span className="text-sm font-medium text-slate-700">{t('form.fields.isActive')}</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={form.is_active}
                  onChange={(e) => set('is_active', e.target.checked)}
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600" />
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-1">{t('form.fields.isActiveHint')}</p>
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('form.fields.description')}
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder={t('form.fields.descriptionPlaceholder')}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            autoComplete="off"
          />
        </div>

        {/* Modelo + temperatura + max_tokens */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('form.fields.model')}
            </label>
            {allModelOptions.length > 0 ? (
              <select
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 bg-white"
              >
                {allModelOptions.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                autoComplete="off"
              />
            )}
            <p className="text-xs text-slate-400 mt-1">{t('form.fields.modelHint')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('form.fields.temperature')}
            </label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => set('temperature', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
            <p className="text-xs text-slate-400 mt-1">{t('form.fields.temperatureHint')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('form.fields.maxTokens')}
            </label>
            <input
              type="number"
              min={64}
              max={32000}
              step={64}
              value={form.max_tokens}
              onChange={(e) => set('max_tokens', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
            <p className="text-xs text-slate-400 mt-1">{t('form.fields.maxTokensHint')}</p>
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('form.fields.prompt')}
          </label>
          <textarea
            rows={6}
            value={form.prompt}
            onChange={(e) => set('prompt', e.target.value)}
            placeholder={t('form.fields.promptPlaceholder')}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-y font-mono"
          />
          <p className="text-xs text-slate-400 mt-1">{t('form.fields.promptHint')}</p>
        </div>

        {/* ── Modo de conhecimento ───────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('form.fields.knowledgeMode')}
          </label>
          <select
            value={form.knowledge_mode}
            onChange={(e) => set('knowledge_mode', e.target.value as KnowledgeMode)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 bg-white"
          >
            {KNOWLEDGE_MODE_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>
                {t(`form.fields.knowledgeModeOptions.${mode}`)}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">{t('form.fields.knowledgeModeHint')}</p>
        </div>

        {/* Base de conhecimento inline (visível em: inline, hybrid) */}
        {showKnowledgeBase && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('form.fields.knowledgeBase')}
            </label>
            <textarea
              rows={4}
              value={form.knowledge_base}
              onChange={(e) => set('knowledge_base', e.target.value)}
              placeholder={t('form.fields.knowledgeBasePlaceholder')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-y"
            />
            <p className="text-xs text-slate-400 mt-1">{t('form.fields.knowledgeBaseHint')}</p>
          </div>
        )}

        {/* Configuração RAG (visível em: rag, hybrid) */}
        {showRagConfig && (
          <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-medium text-slate-700">{t('form.fields.ragConfig')}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {t('form.fields.topK')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={form.top_k}
                  onChange={(e) => set('top_k', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 bg-white"
                />
                <p className="text-xs text-slate-400 mt-1">{t('form.fields.topKHint')}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {t('form.fields.minSimilarity')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.min_similarity}
                  onChange={(e) => set('min_similarity', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 bg-white"
                />
                <p className="text-xs text-slate-400 mt-1">{t('form.fields.minSimilarityHint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Seção de documentos RAG (visível em: rag, hybrid) */}
        {showDocuments && (
          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-medium text-slate-700">{t('documents.title')}</h4>

            {agent?.id ? (
              <LovooAgentDocuments agentId={agent.id} />
            ) : (
              <p className="text-sm text-slate-400 italic">{t('documents.saveFirst')}</p>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" role="alert">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" />{t('form.actions.saving')}</>
              : <><Save className="w-4 h-4" />{t('form.actions.save')}</>
            }
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            {t('form.actions.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

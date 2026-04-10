/**
 * AiGovernancePanel
 *
 * Painel de governança global de IA — exclusivo da empresa-pai.
 *
 * Permite que o super_admin defina as diretrizes que serão injetadas
 * automaticamente no topo do system prompt de TODOS os agentes
 * conversacionais do sistema.
 *
 * As variáveis {{}} inseridas são resolvidas em runtime com os dados
 * de cada empresa que executa o agente — nunca com dados desta plataforma.
 *
 * SEGURANÇA:
 *   - Acesso restrito: renderizado apenas quando canManageAiGovernance = true
 *   - Endpoints validam JWT + super_admin + company_type='parent' no backend
 *   - Policy nunca é logada nem exposta a empresas filhas
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Save, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PromptEditor } from '../ui/PromptEditor'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PolicyData {
  id:         string
  is_active:  boolean
  created_at: string
  updated_at: string
}

// ── Helper de autenticação ────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida')
  return `Bearer ${session.access_token}`
}

// ── Componente principal ──────────────────────────────────────────────────────

type Props = {
  companyId: string
}

export function AiGovernancePanel({ companyId }: Props) {
  const [content, setContent]           = useState('')
  const [savedAt, setSavedAt]           = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess]   = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)

  // ── Carregar policy atual ─────────────────────────────────────────────────

  async function loadPolicy() {
    setLoading(true)
    setLoadError(null)
    try {
      const auth = await getAuthHeader()
      const res  = await fetch(`/api/ai/policies?company_id=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: auth }
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? `Erro ${res.status}`)
      if (json.data) {
        setContent(json.data.content ?? '')
        setSavedAt(json.data.updated_at ?? json.data.created_at ?? null)
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar diretrizes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPolicy() }, [companyId])

  // ── Salvar policy ─────────────────────────────────────────────────────────

  async function handleSave() {
    const trimmed = content.trim()
    if (!trimmed) {
      setSaveError('As diretrizes não podem estar vazias.')
      return
    }

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const auth = await getAuthHeader()
      const res  = await fetch('/api/ai/policies-update', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body:    JSON.stringify({ company_id: companyId, content: trimmed })
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? `Erro ${res.status}`)

      const meta: PolicyData = json.data
      setSavedAt(meta.updated_at ?? meta.created_at ?? null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Erro ao salvar diretrizes.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">Diretrizes Globais de IA</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Regras aplicadas automaticamente a todos os agentes conversacionais do sistema.
          </p>
        </div>
      </div>

      {/* Aviso de impacto global */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Estas diretrizes serão aplicadas a <strong>todos os agentes conversacionais do sistema</strong>,
          incluindo agentes de empresas filhas. Alterações entram em vigor imediatamente na próxima execução.
        </p>
      </div>

      {/* Estado de carregamento */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      )}

      {/* Erro de carregamento */}
      {!loading && loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {loadError}
          <button onClick={loadPolicy} className="ml-2 underline text-red-600 hover:text-red-800">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Editor */}
      {!loading && !loadError && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Conteúdo das diretrizes
            </label>

            <PromptEditor
              value={content}
              onChange={v => { setContent(v); setSaveError(null) }}
              rows={14}
              placeholder={
                'Exemplos de diretrizes:\n\n' +
                '- Você é o assistente da empresa {{nome_fantasia}}.\n' +
                '- Nunca revelar informações internas da empresa\n' +
                '- Não prometer prazos ou valores sem confirmação\n' +
                '- Encaminhar para humano em casos de reclamação grave\n' +
                '- Ao se despedir, use: Att, equipe {{nome_fantasia}}'
              }
            />
          </div>

          {/* Feedback de erro ao salvar */}
          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {saveError}
            </p>
          )}

          {/* Feedback de sucesso */}
          {saveSuccess && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              Diretrizes salvas com sucesso. Em vigor na próxima execução dos agentes.
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-gray-400">
              {savedAt
                ? `Última atualização: ${new Date(savedAt).toLocaleString('pt-BR')}`
                : 'Nenhuma diretriz salva ainda'}
            </p>

            <button
              onClick={handleSave}
              disabled={saving || !content.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white
                         rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</>
                : <><Save className="w-4 h-4" /> Salvar diretrizes</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

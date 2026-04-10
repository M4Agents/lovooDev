/**
 * AiGovernancePanel
 *
 * Painel de governança global de IA — exclusivo da empresa-pai.
 *
 * Permite que o super_admin defina as diretrizes que serão injetadas
 * automaticamente no topo do system prompt de TODOS os agentes
 * conversacionais do sistema, independentemente da empresa.
 *
 * SEGURANÇA:
 *   - Acesso restrito: renderizado apenas quando canManageAiGovernance = true
 *   - Endpoints validam JWT + super_admin + company_type='parent' no backend
 *   - Policy nunca é logada nem exposta a empresas filhas
 */

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Loader2, Save, Shield } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Catálogo de variáveis disponíveis ─────────────────────────────────────────
// Espelhado de api/lib/utils/policyVariables.js — manter sincronizado.

const VARIABLES_CATALOG = [
  { group: 'Runtime',  variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',   example: '08/04/2026' },
  { group: 'Runtime',  variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',   example: '14:30' },
  { group: 'Runtime',  variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',              example: '08/04/2026 14:30' },
  { group: 'Empresa',  variable: '{{nome_empresa}}',    description: 'Nome oficial da empresa',                 example: 'M4 Digital' },
  { group: 'Empresa',  variable: '{{nome_fantasia}}',   description: 'Nome fantasia',                           example: 'Lovoo CRM' },
  { group: 'Empresa',  variable: '{{idioma}}',          description: 'Idioma derivado do país configurado',     example: 'Português (pt-BR)' },
  { group: 'Empresa',  variable: '{{fuso_horario}}',    description: 'Fuso horário configurado',                example: 'America/Sao_Paulo' },
  { group: 'Empresa',  variable: '{{moeda}}',           description: 'Moeda padrão',                           example: 'BRL' },
  { group: 'Empresa',  variable: '{{pais}}',            description: 'País da empresa',                        example: 'Brasil' },
  { group: 'Empresa',  variable: '{{cidade}}',          description: 'Cidade da empresa',                      example: 'São Paulo' },
  { group: 'Empresa',  variable: '{{telefone}}',        description: 'Telefone principal',                     example: '+55 11 99999-9999' },
  { group: 'Empresa',  variable: '{{email}}',           description: 'E-mail principal',                       example: 'contato@empresa.com' },
  { group: 'Empresa',  variable: '{{site}}',            description: 'Site principal',                         example: 'https://empresa.com' },
  { group: 'Empresa',  variable: '{{ramo_atividade}}',  description: 'Ramo de atividade',                      example: 'Tecnologia' },
] as const

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PolicyData {
  id:         string
  is_active:  boolean
  created_at: string
  updated_at: string
}

// ── Sub-componente: painel de variáveis ───────────────────────────────────────

function VariablesPanel({ textareaRef }: { textareaRef: React.RefObject<HTMLTextAreaElement> }) {
  const [open, setOpen]       = useState(false)
  const [copied, setCopied]   = useState<string | null>(null)

  const groups = Array.from(new Set(VARIABLES_CATALOG.map(v => v.group)))

  function handleInsert(variable: string) {
    const ta = textareaRef.current
    if (ta) {
      const start  = ta.selectionStart
      const end    = ta.selectionEnd
      const before = ta.value.slice(0, start)
      const after  = ta.value.slice(end)
      const newVal = before + variable + after
      // Disparar evento nativo para que o React state atualize
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      nativeInputValueSetter?.call(ta, newVal)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + variable.length
    } else {
      // Fallback: copiar para área de transferência
      navigator.clipboard.writeText(variable).catch(() => {})
    }
    setCopied(variable)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-gray-500" />
          Variáveis disponíveis
          <span className="text-xs font-normal text-gray-400">
            ({VARIABLES_CATALOG.length} — clique para inserir no texto)
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="divide-y divide-gray-100">
          {groups.map(group => (
            <div key={group} className="px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
              <div className="space-y-1.5">
                {VARIABLES_CATALOG.filter(v => v.group === group).map(({ variable, description, example }) => (
                  <div key={variable} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleInsert(variable)}
                      title="Clique para inserir no texto"
                      className={`flex-shrink-0 font-mono text-xs px-2 py-0.5 rounded border transition-colors ${
                        copied === variable
                          ? 'bg-green-100 border-green-300 text-green-700'
                          : 'bg-white border-gray-300 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
                      }`}
                    >
                      {copied === variable ? '✓ inserida' : variable}
                    </button>
                    <span className="text-xs text-gray-600 min-w-0">
                      {description}
                      {example && (
                        <span className="text-gray-400 ml-1">— ex: <em>{example}</em></span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const textareaRef                      = useRef<HTMLTextAreaElement>(null)
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
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => { setContent(e.target.value); setSaveError(null) }}
              onInput={e => setContent((e.target as HTMLTextAreaElement).value)}
              rows={14}
              placeholder={
                'Exemplos de diretrizes:\n\n' +
                '- Nunca revelar informações internas da empresa\n' +
                '- Não prometer prazos ou valores sem confirmação\n' +
                '- Encaminhar para humano em casos de reclamação grave\n' +
                '- Não responder a temas fora do escopo do negócio\n' +
                '- Proteger dados pessoais dos clientes'
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y font-mono leading-relaxed"
            />

            {/* Painel de variáveis disponíveis */}
            <VariablesPanel textareaRef={textareaRef} />
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
            {/* Última atualização */}
            <p className="text-xs text-gray-400">
              {savedAt
                ? `Última atualização: ${new Date(savedAt).toLocaleString('pt-BR')}`
                : 'Nenhuma diretriz salva ainda'}
            </p>

            {/* Botão salvar */}
            <button
              onClick={handleSave}
              disabled={saving || !content.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

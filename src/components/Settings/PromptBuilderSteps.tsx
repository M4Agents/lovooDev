/**
 * PromptBuilderSteps
 *
 * Sub-componentes das etapas 2, 3 e 4 do PromptBuilderWizard.
 *   StepDetectedData  — Etapa 2: dados detectados com badges de inteligência
 *   StepUserAnswers   — Etapa 3: configuração guiada com loading progressivo
 *   StepPreview       — Etapa 4: layout 2 colunas com preview ao vivo
 *   PromptLivePreview — Sub-componente do preview ao vivo (direita no Step 4)
 */

import { useCallback, useEffect, useDeferredValue, useRef, useState } from 'react'
import { AgentTestSandbox } from './AgentTestSandbox'
import { LovooAgentDocuments } from './LovooAgentDocuments'
import { PromptVariablePicker } from './PromptVariablePicker'
import { AgentToolsSelector } from '../ui/AgentToolsSelector'
import { EnrichDiffModal } from './EnrichDiffModal'
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle, ChevronDown, ChevronUp,
  ClipboardCopy, Eye, FileText, Loader2, Package, Phone, Globe, Sparkles, X, Zap,
} from 'lucide-react'
import { TOOL_CATALOG } from '../../lib/agents/toolCatalog'
import { promptBuilderApi } from '../../services/promptBuilderApi'
import type { LovooAgentDocument } from '../../types/lovoo-agents'
import type { Company } from '../../lib/supabase'
import type { FlatPromptConfig } from '../../services/promptBuilderApi'

// ── Helpers exportados para o modo de edição avançada ─────────────────────────

const ADVANCED_SECTIONS: { key: string; field: keyof FlatPromptConfig }[] = [
  { key: 'IDENTIDADE',                       field: 'identity'            },
  { key: 'OBJETIVO',                         field: 'objective'           },
  { key: 'ESTILO DE COMUNICAÇÃO',            field: 'communication_style' },
  { key: 'REGRAS DE ATENDIMENTO',            field: 'commercial_rules'    },
  { key: 'INFORMAÇÕES ADICIONAIS',           field: 'custom_notes'        },
  { key: 'INSTRUÇÕES PARA AÇÕES DO AGENTE', field: 'tool_instructions'   },
]

/** Monta os 5 campos do prompt_config em um único texto editável com marcadores de seção. */
export function buildAdvancedText(config: FlatPromptConfig): string {
  return ADVANCED_SECTIONS
    .map(({ key, field }) => `[${key}]\n${config[field] ?? ''}`)
    .join('\n\n')
}

/**
 * Parseia um texto com marcadores [SEÇÃO] de volta para os 5 campos do prompt_config.
 * Tolerante a texto sem marcadores — vai para custom_notes.
 */
export function parseAdvancedText(text: string): FlatPromptConfig {
  const config: FlatPromptConfig = { identity: '', objective: '', communication_style: '', commercial_rules: '', custom_notes: '' }
  const sectionMap: Record<string, keyof FlatPromptConfig> = {
    'IDENTIDADE':                       'identity',
    'OBJETIVO':                         'objective',
    'ESTILO DE COMUNICAÇÃO':            'communication_style',
    'REGRAS DE ATENDIMENTO':            'commercial_rules',
    'INFORMAÇÕES ADICIONAIS':           'custom_notes',
    'INSTRUÇÕES PARA AÇÕES DO AGENTE': 'tool_instructions',
  }
  const parts = text.split(/\[([^\]]+)\]/)
  for (let i = 1; i < parts.length; i += 2) {
    const markerKey = parts[i]?.trim()
    const content   = parts[i + 1]?.trim() ?? ''
    const field     = sectionMap[markerKey]
    if (field) config[field] = content
  }
  return config
}

// ── Tipos compartilhados ───────────────────────────────────────────────────────

export interface CatalogItem { id: string; name: string }

export type UserAnswers = {
  objective:            string
  communication_style:  string
  commercial_rules:     string
  custom_notes:         string
}

// ── Helper para saudação de prévia ────────────────────────────────────────────

function buildPreviewGreeting(agentName?: string, companyName?: string): string {
  if (agentName && companyName) return `Oi! 😊 Sou ${agentName}, da ${companyName}. Como posso te ajudar?`
  if (agentName)                return `Oi! 😊 Sou ${agentName}. Como posso te ajudar?`
  if (companyName)              return `Oi! 😊 Sou o assistente da ${companyName}. Como posso te ajudar?`
  return ''
}

// ── Preview ao vivo — renderiza o config como cartão visual ───────────────────

const PREVIEW_SECTIONS: { field: keyof FlatPromptConfig; icon: string; title: string }[] = [
  { field: 'identity',            icon: '🤖', title: 'Identidade' },
  { field: 'objective',           icon: '🎯', title: 'Objetivo' },
  { field: 'communication_style', icon: '💬', title: 'Comunicação' },
  { field: 'commercial_rules',    icon: '📋', title: 'Regras' },
  { field: 'custom_notes',        icon: '📝', title: 'Informações' },
  { field: 'tool_instructions',   icon: '⚡', title: 'Ações do Agente' },
]

function PromptLivePreview({
  config, agentName, companyName,
}: {
  config:       FlatPromptConfig
  agentName?:   string
  companyName?: string
}) {
  const sections = PREVIEW_SECTIONS.filter(s => config[s.field]?.trim())
  const greeting = buildPreviewGreeting(agentName, companyName)

  return (
    <div className="flex flex-col border border-blue-100 rounded-xl overflow-hidden shadow-sm">
      {/* Header do card */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-sm">
            🤖
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Como seu agente vai atuar</p>
            <p className="text-xs text-blue-200">É assim que ele vai se apresentar e trabalhar.</p>
          </div>
        </div>
      </div>

      {/* Saudação — prévia do primeiro contato */}
      {greeting && (
        <div className="px-4 pt-4 pb-1">
          <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-bl-sm px-3 py-2.5">
            <p className="text-sm text-blue-800 italic leading-relaxed">{greeting}</p>
          </div>
        </div>
      )}

      {/* Seções do preview */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gradient-to-b from-blue-50/40 to-white">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <Eye className="w-6 h-6 text-gray-300" />
            <p className="text-xs text-gray-400">
              O preview aparece conforme você preenche os campos ao lado.
            </p>
          </div>
        ) : (
          sections.map(({ field, icon, title }) => (
            <div key={field} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm leading-none">{icon}</span>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {title}
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed pl-6 whitespace-pre-wrap">
                {config[field]}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Footer de confiança */}
      <div className="border-t border-blue-100 px-4 py-2.5 bg-white flex-shrink-0">
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <Check className="w-3 h-3 text-green-500" />
          Configuração gerada com os dados da sua empresa
        </p>
      </div>
    </div>
  )
}

// ── Etapa 2 — Dados detectados automaticamente ────────────────────────────────

export function StepDetectedData({
  company, catalogItems, loadingCatalog, onBack, onContinue,
}: {
  company:        Company | null
  catalogItems:   CatalogItem[]
  loadingCatalog: boolean
  onBack:         () => void
  onContinue:     () => void
}) {
  const hasCompany  = Boolean(company?.nome_fantasia ?? company?.name)
  const hasItems    = !loadingCatalog && catalogItems.length > 0
  const emptyCatalog = !loadingCatalog && catalogItems.length === 0

  return (
    <div className="space-y-4">
      {/* Banner principal */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-sm font-medium text-blue-800">
          Encontramos essas informações automaticamente no seu sistema.
        </p>
        <p className="text-xs text-blue-600 mt-0.5">
          Elas serão usadas para personalizar seu agente sem que você precise digitar novamente.
        </p>
      </div>

      {/* Badges de inteligência */}
      {(hasCompany || hasItems) && (
        <div className="flex flex-wrap gap-2">
          {hasCompany && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 border border-green-200
                             text-green-700 text-xs rounded-full font-medium">
              <Check className="w-3 h-3" /> Empresa identificada
            </span>
          )}
          {hasItems && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 border border-green-200
                             text-green-700 text-xs rounded-full font-medium">
              <Check className="w-3 h-3" />
              {catalogItems.length} {catalogItems.length === 1 ? 'item' : 'itens'} no catálogo
            </span>
          )}
        </div>
      )}

      {/* Dados da empresa */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <Building2 className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Empresa</span>
          {hasCompany && <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        </div>

        {hasCompany ? (
          <div className="px-4 py-3 space-y-1.5">
            <p className="text-sm font-semibold text-gray-900">
              {company?.nome_fantasia ?? company?.name}
            </p>
            {(company?.cidade || company?.estado) && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                📍 {[company?.cidade, company?.estado].filter(Boolean).join(', ')}
              </p>
            )}
            {company?.ramo_atividade && (
              <p className="text-xs text-gray-500">🏢 {company.ramo_atividade}</p>
            )}
            {company?.telefone_principal && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {company.telefone_principal}
              </p>
            )}
            {company?.site_principal && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Globe className="w-3 h-3" />
                <a href={company.site_principal} target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-blue-600 truncate max-w-[200px]">
                  {company.site_principal}
                </a>
              </p>
            )}
            <p className="text-xs text-gray-400 pt-1">
              Para editar, acesse <span className="font-medium">Configurações &rsaquo; Empresa</span>
            </p>
          </div>
        ) : (
          <div className="px-4 py-3 text-sm text-gray-400 italic">
            Dados da empresa não encontrados. Cadastre em Configurações &rsaquo; Empresa.
          </div>
        )}
      </div>

      {/* Catálogo */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <Package className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Produtos / Serviços
          </span>
          {hasItems && <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />}
        </div>

        <div className="px-4 py-3">
          {loadingCatalog ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando catálogo...
            </div>
          ) : hasItems ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {catalogItems.slice(0, 8).map(item => (
                  <span key={item.id}
                    className="text-xs bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-1">
                    {item.name}
                  </span>
                ))}
                {catalogItems.length > 8 && (
                  <span className="text-xs text-gray-400 px-1 py-1">
                    +{catalogItems.length - 8} mais
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Para editar, acesse <span className="font-medium">Configurações &rsaquo; Catálogo</span>
              </p>
            </>
          ) : emptyCatalog ? (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
              <p className="text-sm text-amber-700 font-medium">Nenhum produto ou serviço cadastrado.</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Seu agente ainda pode ser criado. Cadastre o catálogo depois em{' '}
                <span className="font-medium">Configurações &rsaquo; Catálogo</span>.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Frase de confiança */}
      <p className="text-sm font-medium text-gray-700 text-center py-1">
        ✨ Seu agente já pode ser criado com essas informações.
      </p>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <button
          onClick={onContinue}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white
                     text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          Continuar
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ── Etapa 3 — Configuração guiada ─────────────────────────────────────────────

const COMM_STYLES = [
  { value: '',              label: 'Selecionar...' },
  { value: 'formal',        label: 'Formal e profissional' },
  { value: 'amigavel',      label: 'Amigável e descontraído' },
  { value: 'consultivo',    label: 'Consultivo e especialista' },
  { value: 'direto',        label: 'Direto e objetivo' },
  { value: 'entusiasmado',  label: 'Entusiasmado e motivacional' },
]

const LOADING_MESSAGES = [
  'Analisando sua empresa...',
  'Lendo seu catálogo...',
  'Montando a configuração...',
  'Quase pronto...',
]

export function StepUserAnswers({
  answers, setAnswers, onBack, onGenerate, generating, error,
}: {
  answers:    UserAnswers
  setAnswers: (v: UserAnswers) => void
  onBack:     () => void
  onGenerate: () => void
  generating: boolean
  error:      string | null
}) {
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0)

  // Cicla pelas mensagens de loading enquanto a geração está em andamento
  useEffect(() => {
    if (!generating) { setLoadingMsgIdx(0); return }
    const id = setInterval(() => {
      setLoadingMsgIdx(i => Math.min(i + 1, LOADING_MESSAGES.length - 1))
    }, 1800)
    return () => clearInterval(id)
  }, [generating])

  function update(field: keyof UserAnswers, value: string) {
    setAnswers({ ...answers, [field]: value })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100 leading-relaxed">
        Todos os campos são opcionais. O agente já usa os dados da sua empresa e catálogo como base —
        responda apenas o que quiser complementar.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Qual o principal objetivo do agente?
        </label>
        <textarea
          value={answers.objective}
          onChange={e => update('objective', e.target.value)}
          disabled={generating}
          rows={2}
          placeholder="Ex: Atender leads do WhatsApp, tirar dúvidas sobre nossos cursos e encaminhar interessados para matrícula."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400
                     disabled:opacity-50 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Como o agente deve se comunicar?
        </label>
        <select
          value={answers.communication_style}
          onChange={e => update('communication_style', e.target.value)}
          disabled={generating}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white
                     disabled:opacity-50 disabled:bg-gray-50"
        >
          {COMM_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Há alguma regra comercial importante?
        </label>
        <textarea
          value={answers.commercial_rules}
          onChange={e => update('commercial_rules', e.target.value)}
          disabled={generating}
          rows={2}
          placeholder="Ex: Não oferecer desconto sem aprovação. Sempre perguntar o nome antes de enviar proposta."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400
                     disabled:opacity-50 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Existe algo importante que o cliente precisa saber?
        </label>
        <textarea
          value={answers.custom_notes}
          onChange={e => update('custom_notes', e.target.value)}
          disabled={generating}
          rows={2}
          placeholder="Ex: Atendemos somente na região de SP. Parcelamos em até 12x sem juros no cartão."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400
                     disabled:opacity-50 disabled:bg-gray-50"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading progressivo */}
      {generating && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3.5">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-blue-800 transition-all">
              {LOADING_MESSAGES[loadingMsgIdx]}
            </p>
            <div className="flex gap-1 mt-2">
              {LOADING_MESSAGES.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i <= loadingMsgIdx ? 'bg-blue-500 flex-1' : 'bg-blue-100 flex-1'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} disabled={generating}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-40">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white
                     text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
            : <><Sparkles className="w-4 h-4" /> Gerar configuração do agente</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Etapa 4 — Preview premium com 2 colunas ───────────────────────────────────

const PREVIEW_BLOCKS: { field: keyof FlatPromptConfig; label: string; rows: number; required?: boolean; maxLength?: number }[] = [
  { field: 'identity',            label: 'Identidade do agente',   rows: 3, required: true, maxLength: 800  },
  { field: 'objective',           label: 'Objetivo principal',     rows: 3, required: true, maxLength: 600  },
  { field: 'communication_style', label: 'Estilo de comunicação',  rows: 2,                 maxLength: 500  },
  { field: 'commercial_rules',    label: 'Regras de atendimento',  rows: 2,                 maxLength: 800  },
  { field: 'custom_notes',        label: 'Informações adicionais', rows: 2,                 maxLength: 1500 },
]

// ── ToolReferencePanel ────────────────────────────────────────────────────────

/**
 * Painel colapsível de referência de ferramentas ativas.
 * Exibe o nome técnico de cada ferramenta habilitada no agente para que o
 * usuário possa referenciá-la diretamente no prompt.
 * Clicar no nome técnico copia para a área de transferência.
 */
function ToolReferencePanel({ allowedTools }: { allowedTools: string[] }) {
  const [open, setOpen]         = useState(false)
  const [copied, setCopied]     = useState<string | null>(null)

  const activeTools = TOOL_CATALOG.filter(t => allowedTools.includes(t.key))
  if (activeTools.length === 0) return null

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="border border-amber-200 rounded-lg bg-amber-50/40 text-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-amber-700 hover:text-amber-900 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-medium text-xs">
          <Zap className="w-3.5 h-3.5" />
          {activeTools.length} {activeTools.length === 1 ? 'ferramenta ativa' : 'ferramentas ativas'} — clique no nome para copiar
        </span>
        {open
          ? <ChevronUp   className="w-3.5 h-3.5 flex-shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-amber-200 px-3 py-2 space-y-2">
          {activeTools.map(tool => (
            <div key={tool.key} className="flex gap-2 items-start">
              <button
                type="button"
                onClick={() => copyKey(tool.key)}
                title="Clique para copiar o nome da ferramenta"
                className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs font-semibold
                  transition-colors cursor-pointer border
                  ${copied === tool.key
                    ? 'bg-green-100 text-green-700 border-green-300'
                    : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'
                  }`}
              >
                {copied === tool.key
                  ? <><Check className="w-3 h-3" /> copiado</>
                  : <><ClipboardCopy className="w-3 h-3" /> {tool.key}</>
                }
              </button>
              <span className="text-xs text-gray-600 leading-relaxed pt-0.5">
                <span className="font-medium text-gray-700">{tool.label}</span>
                {tool.promptSuggestion && (
                  <> — {tool.promptSuggestion}</>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function StepPreview({
  config, setConfig,
  catalogCount, companyName, agentName,
  onBack, onSave, onTest, saving, error,
  advancedManualActive, onActivateAdvancedManual,
  advancedText, setAdvancedText,
  companyId, agentId,
  knowledgeBase, setKnowledgeBase,
  hasActiveDocs, onHasActiveDocsChange,
  allowedTools, setAllowedTools,
}: {
  config:       FlatPromptConfig
  setConfig:    (v: FlatPromptConfig) => void
  catalogCount: number
  companyName:  string
  agentName:    string
  /** undefined quando modo avançado ativo — oculta o botão Voltar */
  onBack?:      () => void
  onSave:       () => void
  onTest?:      () => void
  saving:       boolean
  error:        string | null
  advancedManualActive:     boolean
  onActivateAdvancedManual: () => void
  /** Texto livre do modo avançado (concatenação dos 5 campos com marcadores) */
  advancedText:    string
  setAdvancedText: (v: string) => void
  /** Necessário para o sandbox inline no modo avançado */
  companyId: string
  agentId?:  string | null
  /** Base de conhecimento complementar — campo separado, não faz parte do prompt_config */
  knowledgeBase:    string
  setKnowledgeBase: (v: string) => void
  /** Documentos RAG — presença de docs ativos (ready | processing) */
  hasActiveDocs:          boolean
  onHasActiveDocsChange:  (v: boolean) => void
  /** Ferramentas habilitadas para function calling */
  allowedTools:    string[]
  setAllowedTools: (tools: string[]) => void
}) {
  // Preview do modo normal — atualiza com prioridade menor
  const deferredConfig       = useDeferredValue(config)
  // Preview do modo avançado — parseia o texto bruto (deferred para não travar edição)
  const deferredAdvancedText = useDeferredValue(advancedText)
  const deferredParsedConfig = advancedManualActive ? parseAdvancedText(deferredAdvancedText) : null

  // Controle do dialog de confirmação para ativação do modo avançado
  const [showAdvancedConfirm, setShowAdvancedConfirm] = useState(false)

  // Painel da base de conhecimento — expandido automaticamente se já houver conteúdo
  const [kbOpen, setKbOpen] = useState(() => knowledgeBase.trim().length > 0)

  // Verificação de dados operacionais na KB (soft warning, não bloqueia)
  const KB_MAX = 5000
  const KB_WARN_PATTERNS = [
    /\(\d{2}\)\s*\d{4,5}-?\d{4}/,             // telefone BR
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, // email
    /https?:\/\//,                              // URL
    /R\$\s*\d+/,                               // valor monetário BRL
    /\d+[.,]\d{2,}/,                           // número decimal (possível preço)
  ]
  const kbHasOperationalData = KB_WARN_PATTERNS.some(r => r.test(knowledgeBase))

  function update(field: keyof FlatPromptConfig, value: string) {
    setConfig({ ...config, [field]: value })
  }

  function handleConfirmAdvanced() {
    setShowAdvancedConfirm(false)
    onActivateAdvancedManual()
  }

  const previewConfig = deferredParsedConfig ?? deferredConfig
  const canSave = advancedManualActive
    ? advancedText.trim().length > 20
    : (config.identity?.trim().length ?? 0) >= 20 && (config.objective?.trim().length ?? 0) >= 20

  return (
    <div className="space-y-4">
      {/* Resumo dos dados */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: '🏢', label: 'Empresa',       value: companyName || '—' },
          { icon: '📦', label: 'Catálogo',      value: catalogCount > 0 ? `${catalogCount} itens` : 'Sem itens' },
          { icon: '✅', label: 'Configuração',  value: 'Gerada' },
        ].map(item => (
          <div key={item.label} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-center">
            <p className="text-base">{item.icon}</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
            <p className="text-xs font-semibold text-gray-800 truncate">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Banner de confiança (oculto em modo avançado) */}
      {!advancedManualActive && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-green-800">
            Seu agente já está pronto para atender seus clientes. 🎉
          </p>
          <p className="text-xs text-green-700 mt-0.5">
            Você pode ajustar qualquer parte abaixo, se quiser personalizar mais.
          </p>
        </div>
      )}

      {/* Badge de modo avançado */}
      {advancedManualActive && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs font-bold text-blue-800 uppercase tracking-wide">
            ✏️ Edição Avançada ativa
          </p>
          <p className="text-xs text-blue-700 leading-relaxed">
            O conteúdo do prompt é editado manualmente por você.{' '}
            <strong>Dados de empresa, produtos e serviços cadastrados no sistema continuam sendo
            injetados automaticamente em cada atendimento</strong> — o que vale sempre é o que
            está no cadastro, independentemente do que estiver escrito aqui. Não é necessário
            (nem recomendado) copiar informações do cadastro para este campo.
          </p>
        </div>
      )}

      {/* Layout 2 colunas — edição à esquerda, preview à direita */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Esquerda: modo normal (5 campos) ou modo avançado (textarea único) */}
        <div className="space-y-3 min-w-0">

          {/* Botão de ativação — acima do primeiro campo, azul, apenas no modo normal */}
          {!advancedManualActive && !showAdvancedConfirm && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowAdvancedConfirm(true)}
                disabled={saving}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2 disabled:opacity-40 transition-colors"
              >
                Ativar edição avançada
              </button>
            </div>
          )}

          {/* Dialog de confirmação — aparece no mesmo lugar do botão, topo da coluna */}
          {!advancedManualActive && showAdvancedConfirm && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">Ativar Edição Avançada?</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Esta ação é <strong>irreversível</strong> para este agente. O fluxo assistido por IA não ficará
                mais disponível — todos os campos serão editados manualmente por você.
                A injeção dinâmica de dados (empresa, catálogo, etc.) continua funcionando normalmente.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleConfirmAdvanced}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
                >
                  Confirmar — ativar edição avançada
                </button>
                <button
                  onClick={() => setShowAdvancedConfirm(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {advancedManualActive ? (
            /* Modo avançado: textarea com autocomplete de variáveis */
            <div className="space-y-2">
              <p className="text-xs text-gray-400 leading-relaxed">
                Mantenha os marcadores <code className="bg-gray-100 px-1 rounded">[IDENTIDADE]</code>,{' '}
                <code className="bg-gray-100 px-1 rounded">[OBJETIVO]</code> etc. para preservar a estrutura do agente.
              </p>
              <PromptVariablePicker
                value={advancedText}
                onChange={setAdvancedText}
                disabled={saving}
                rows={22}
                className="w-full border border-blue-200 rounded-lg px-3 py-3 text-sm resize-y
                           leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-blue-400
                           disabled:opacity-50 disabled:bg-gray-50 bg-blue-50/30"
              />
              <ToolReferencePanel allowedTools={allowedTools} />
            </div>
          ) : (
            /* Modo normal: 5 campos separados */
            <>
              {PREVIEW_BLOCKS.map(({ field, label, rows, required, maxLength }) => {
                const currentLen = (config[field] ?? '').length
                const overLimit  = maxLength != null && currentLen > maxLength
                return (
                  <div key={field}>
                    <label className="flex items-center justify-between gap-1 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                      <span className="flex items-center gap-1">
                        {label}
                        {required && <span className="text-red-400 font-normal normal-case tracking-normal">obrigatório</span>}
                      </span>
                      {maxLength != null && (
                        <span className={`font-normal normal-case tracking-normal tabular-nums ${overLimit ? 'text-red-500' : 'text-gray-400'}`}>
                          {currentLen}/{maxLength}
                        </span>
                      )}
                    </label>
                    <textarea
                      value={config[field] ?? ''}
                      onChange={e => update(field, e.target.value)}
                      disabled={saving}
                      rows={rows}
                      className={`w-full border rounded-lg px-3 py-2 text-sm resize-y leading-relaxed
                                  focus:outline-none focus:ring-2
                                  disabled:opacity-50 disabled:bg-gray-50 ${
                        overLimit
                          ? 'border-red-300 bg-red-50 focus:ring-red-300'
                          : required && !config[field]?.trim()
                            ? 'border-red-200 bg-red-50 focus:ring-red-300'
                            : 'border-gray-200 focus:ring-blue-400'
                      }`}
                    />
                    {overLimit && (
                      <p className="mt-1 text-xs text-red-500">
                        Reduza em {currentLen - maxLength} caractere{currentLen - maxLength !== 1 ? 's' : ''} para salvar.
                      </p>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Direita: sandbox inline no modo avançado; preview ao vivo no modo normal */}
        <div className="min-w-0">
          {advancedManualActive ? (
            /* Sandbox embutido — usa o config parseado do textarea em tempo quase-real */
            <div className="border border-violet-200 rounded-xl overflow-hidden shadow-sm h-[560px] flex flex-col">
              <AgentTestSandbox
                compact
                companyId={companyId}
                promptConfig={previewConfig}
                agentName={agentName}
                companyName={companyName}
                agentId={agentId ?? null}
              />
            </div>
          ) : (
            <PromptLivePreview
              config={previewConfig}
              agentName={agentName}
              companyName={companyName}
            />
          )}
        </div>
      </div>

      {/* ── Base de conhecimento complementar ──────────────────────────────── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* Cabeçalho colapsável */}
        <button
          type="button"
          onClick={() => setKbOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                     transition-colors text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none">📚</span>
            <span className="text-sm font-semibold text-gray-700">Base de conhecimento</span>
            <span className="text-xs text-gray-400 font-normal">(opcional)</span>
            {knowledgeBase.trim().length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700
                               text-xs rounded-full font-medium ml-1">
                Ativa
              </span>
            )}
          </div>
          <span className="text-gray-400 text-xs ml-2 flex-shrink-0">
            {kbOpen ? '▲ Fechar' : '▼ Abrir'}
          </span>
        </button>

        {kbOpen && (
          <div className="px-4 py-4 space-y-3 bg-white">
            {/* Descrição */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-xs text-blue-800 leading-relaxed">
              <strong>Para que serve:</strong> adicione conteúdo complementar que o agente pode consultar —
              FAQs, políticas de garantia, procedimentos internos, fichas técnicas, roteiros de objeções,
              informações institucionais.<br />
              <strong className="text-red-700">Não inclua:</strong> preços, estoque, disponibilidade,
              contatos, horário ou endereço. Esses dados vêm automaticamente do sistema e têm prioridade
              sobre qualquer conteúdo desta seção.
            </div>

            {/* Warning de dados operacionais */}
            {kbHasOperationalData && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
                <span className="flex-shrink-0 mt-0.5">⚠️</span>
                <span>
                  Detectamos dados que podem ser operacionais (telefone, e-mail, URL ou valor monetário).
                  Esses dados mudam com frequência — use apenas o que está cadastrado no sistema para evitar
                  informações desatualizadas.
                </span>
              </div>
            )}

            {/* Textarea */}
            <div className="relative">
              <textarea
                value={knowledgeBase}
                onChange={e => setKnowledgeBase(e.target.value.slice(0, KB_MAX))}
                disabled={saving}
                rows={6}
                placeholder={
                  'Exemplos:\n' +
                  '- Pergunta: Como funciona a garantia? → Resposta: Nosso produto tem 12 meses de garantia contra defeitos de fabricação...\n' +
                  '- Política de devolução: o cliente tem até 7 dias corridos para solicitar a troca...\n' +
                  '- Procedimento de segunda via: o cliente deve enviar CPF + nota fiscal por e-mail...'
                }
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-y
                           leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400
                           placeholder:text-gray-400 disabled:opacity-50 disabled:bg-gray-50"
              />
              {/* Contador de caracteres */}
              <p className={`text-right text-xs mt-1 ${
                knowledgeBase.length >= KB_MAX ? 'text-red-500 font-semibold' : 'text-gray-400'
              }`}>
                {knowledgeBase.length.toLocaleString('pt-BR')} / {KB_MAX.toLocaleString('pt-BR')} caracteres
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Documentos RAG ──────────────────────────────────────────────────── */}
      <AgentDocumentsSection
        agentId={agentId ?? null}
        saving={saving}
        onHasActiveDocsChange={onHasActiveDocsChange}
      />

      {/* ── Ações do agente (ferramentas) ───────────────────────────────────── */}
      <AgentToolsSection
        allowedTools={allowedTools}
        setAllowedTools={setAllowedTools}
        saving={saving}
        companyId={companyId}
        advancedText={advancedText}
        setAdvancedText={setAdvancedText}
        advancedManualActive={advancedManualActive}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
        {/* Esquerda: Voltar — oculto em modo avançado (irreversível) */}
        <div>
          {onBack && (
            <button onClick={onBack} disabled={saving}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-40">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onTest && (
            <button
              onClick={onTest}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700
                         text-sm rounded-lg hover:bg-violet-100 disabled:opacity-40
                         transition-colors font-medium border border-violet-200"
            >
              🧪 Testar agente
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || !canSave}
            className="inline-flex items-center gap-2 px-5 py-2 bg-green-600 text-white
                       text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors font-medium"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
              : <><Check className="w-4 h-4" /> Salvar agente</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AgentDocumentsSection ─────────────────────────────────────────────────────
//
// Seção colapsável de documentos RAG dentro do modal de Company Agent.
// Reutiliza LovooAgentDocuments e notifica o wizard sobre presença de docs ativos.
//
// agentId == null → agente ainda não salvo → exibe CTA para salvar primeiro.

function AgentDocumentsSection({
  agentId,
  saving,
  onHasActiveDocsChange,
}: {
  agentId:               string | null
  saving:                boolean
  onHasActiveDocsChange: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeBadge, setActiveBadge] = useState<{ ready: number; processing: number } | null>(null)

  const handleDocsChange = useCallback(
    (docs: LovooAgentDocument[]) => {
      const ready      = docs.filter(d => d.status === 'ready').length
      const processing = docs.filter(d => d.status === 'processing' || d.status === 'pending').length
      setActiveBadge({ ready, processing })
      onHasActiveDocsChange(ready > 0 || processing > 0)
      // Auto-expande o painel se houver documentos carregados
      if (ready + processing > 0) setOpen(true)
    },
    [onHasActiveDocsChange]
  )

  const hasAny = activeBadge !== null && (activeBadge.ready + activeBadge.processing) > 0

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Cabeçalho colapsável */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                   transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-700">Documentos</span>
          <span className="text-xs text-gray-400 font-normal">(opcional)</span>

          {activeBadge && activeBadge.processing > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700
                             text-xs rounded-full font-medium ml-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processando...
            </span>
          )}
          {activeBadge && activeBadge.ready > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700
                             text-xs rounded-full font-medium ml-1">
              {activeBadge.ready} doc{activeBadge.ready > 1 ? 's' : ''} ativo{activeBadge.ready > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs ml-2 flex-shrink-0">
          {open ? '▲ Fechar' : '▼ Abrir'}
        </span>
      </button>

      {open && (
        <div className="bg-white">
          {/* Descrição */}
          <div className="px-4 pt-4">
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-xs text-blue-800 leading-relaxed">
              <strong>Para que serve:</strong> adicione arquivos <code className="font-mono">.txt</code> ou{' '}
              <code className="font-mono">.md</code> para que o agente consulte automaticamente durante o atendimento.
              Use para manuais extensos, políticas longas ou bases de conhecimento estruturadas que não cabem
              no campo de texto acima.<br />
              <strong className="text-red-700">Os dados do sistema (preços, catálogo, horário) continuam sendo
              a fonte de verdade</strong> — os documentos são apenas conteúdo de apoio.
            </div>

            {hasAny && (
              <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg
                              px-3 py-2.5 text-xs text-amber-800">
                <span className="flex-shrink-0 mt-0.5">⚠️</span>
                <span>
                  Documentos em processamento podem não ser consultados pelo agente ainda.
                  Aguarde o status <strong>Ativo</strong> antes de testar.
                </span>
              </div>
            )}
          </div>

          {agentId ? (
            /* Agente já salvo — exibe lista + upload */
            <div className="px-4 pb-4 pt-3">
              <LovooAgentDocuments
                agentId={agentId}
                onDocsChange={handleDocsChange}
              />
            </div>
          ) : (
            /* Agente novo — CTA para salvar primeiro */
            <div className="px-4 pb-4 pt-3">
              <div className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed
                              border-gray-200 rounded-xl text-center">
                <FileText className="w-8 h-8 text-gray-300" />
                <p className="text-sm text-gray-500 font-medium">
                  Para adicionar documentos, salve o agente primeiro.
                </p>
                <p className="text-xs text-gray-400">
                  Clique em <strong>Salvar agente</strong> abaixo e depois reabra para editar.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ManualToolSuggestionsPanel ────────────────────────────────────────────────
//
// Modo B: painel inline com sugestões copiáveis por tool ativa.
// Não requer backend — usa promptSuggestion do toolCatalog.ts.

function ManualToolSuggestionsPanel({
  allowedTools,
  onClose,
}: {
  allowedTools: string[]
  onClose:      () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)

  const activeTools = TOOL_CATALOG.filter(t => allowedTools.includes(t.key) && t.promptSuggestion)

  function copyText(text: string, key: string) {
    void navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  function copyAll() {
    const block = activeTools
      .map(t => `[${t.label}]\n${t.promptSuggestion}`)
      .join('\n\n')
    const full = `# Instruções para ações do agente\n\n${block}`
    copyText(full, '__all__')
  }

  if (activeTools.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-gray-500">
        Nenhuma ação ativa possui sugestão de instrução.
      </div>
    )
  }

  return (
    <div className="px-4 pb-4 pt-2 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Copie as instruções abaixo e cole no campo{' '}
          <span className="font-mono bg-gray-100 px-1 rounded">[INFORMAÇÕES ADICIONAIS]</span>{' '}
          do prompt.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={copyAll}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800
                       border border-blue-200 rounded-md px-2.5 py-1 bg-blue-50 hover:bg-blue-100
                       transition-colors"
          >
            <ClipboardCopy className="w-3 h-3" />
            {copied === '__all__' ? 'Copiado!' : 'Copiar tudo'}
          </button>
          <button
            onClick={onClose}
            aria-label="Fechar sugestões manuais"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {activeTools.map(tool => (
        <div key={tool.key} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-700">{tool.label}</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{tool.promptSuggestion}</p>
            </div>
            <button
              onClick={() => copyText(tool.promptSuggestion!, tool.key)}
              className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 transition-colors
                         flex items-center gap-1 border border-blue-200 rounded px-2 py-1
                         bg-white hover:bg-blue-50"
            >
              <ClipboardCopy className="w-3 h-3" />
              {copied === tool.key ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── AgentToolsSection ─────────────────────────────────────────────────────────
//
// Seção colapsável de ferramentas (function calling) dentro do Step 4.
// Suporta dois modos de enriquecimento do prompt:
//   Modo A — "Adaptar com IA": chama backend, exibe diff, usuário aprova.
//   Modo B — "Ver sugestões manuais": painel inline com instruções copiáveis.
// Os dois modos são mutuamente exclusivos.

type EnrichState = 'idle' | 'warning' | 'loading' | 'diff' | 'error'

function AgentToolsSection({
  allowedTools, setAllowedTools, saving,
  companyId, advancedText, setAdvancedText, advancedManualActive,
}: {
  allowedTools:         string[]
  setAllowedTools:      (tools: string[]) => void
  saving:               boolean
  companyId:            string
  advancedText:         string
  setAdvancedText:      (v: string) => void
  advancedManualActive: boolean
}) {
  const [open, setOpen]                           = useState(false)
  const [enrichState, setEnrichState]             = useState<EnrichState>('idle')
  const [enrichError, setEnrichError]             = useState<string | null>(null)
  const [suggestedPrompt, setSuggestedPrompt]     = useState<string | null>(null)
  const [manualSuggestionsOpen, setManualOpen]    = useState(false)

  const showEnrichButtons = advancedManualActive && allowedTools.length > 0 && !saving

  // Fechar painel manual ao iniciar fluxo IA e vice-versa
  function startAiFlow() {
    setManualOpen(false)
    setEnrichError(null)
    setEnrichState('warning')
  }

  function openManual() {
    if (enrichState !== 'idle') return
    setManualOpen(v => !v)
  }

  async function handleConfirmEnrich() {
    setEnrichState('loading')
    try {
      const suggested = await promptBuilderApi.enrichTools(companyId, advancedText, allowedTools)
      setSuggestedPrompt(suggested)
      setEnrichState('diff')
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Erro ao gerar sugestão.')
      setEnrichState('error')
    }
  }

  function handleApply() {
    if (suggestedPrompt) setAdvancedText(suggestedPrompt)
    setSuggestedPrompt(null)
    setEnrichState('idle')
  }

  function handleCopy() {
    if (suggestedPrompt) void navigator.clipboard.writeText(suggestedPrompt)
  }

  function handleCancelDiff() {
    setSuggestedPrompt(null)
    setEnrichState('idle')
  }

  return (
    <>
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* Header toggle */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100
                     transition-colors text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none">⚡</span>
            <span className="text-sm font-semibold text-gray-700">Ações do agente</span>
            <span className="text-xs text-gray-400 font-normal">(ferramentas)</span>
            {allowedTools.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700
                               text-xs rounded-full font-medium ml-1">
                {allowedTools.length} {allowedTools.length === 1 ? 'ação' : 'ações'}
              </span>
            )}
          </div>
          <span className="text-gray-400 text-xs ml-2 flex-shrink-0">
            {open ? '▲ Fechar' : '▼ Abrir'}
          </span>
        </button>

        {open && (
          <div className="divide-y divide-gray-100">
            {/* Seletor de tools */}
            <div className="px-4 py-4">
              <AgentToolsSelector
                selectedTools={allowedTools}
                onChange={setAllowedTools}
                disabled={saving}
              />
            </div>

            {/* Botões de enriquecimento — apenas no modo avançado com tools ativas */}
            {showEnrichButtons && (
              <div className="px-4 py-3 bg-gray-50/60">
                {/* Aviso de warning */}
                {enrichState === 'warning' && (
                  <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm">
                    <p className="text-amber-800 font-medium text-xs">Antes de continuar</p>
                    <p className="text-amber-700 text-xs mt-1">
                      O prompt será adaptado para incluir instruções das ações do agente.
                      Recomendamos salvar uma cópia do prompt atual antes de aplicar.
                    </p>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => void handleConfirmEnrich()}
                        className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded-md
                                   hover:bg-amber-700 transition-colors font-medium"
                      >
                        Continuar
                      </button>
                      <button
                        onClick={() => setEnrichState('idle')}
                        className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-md
                                   hover:bg-gray-50 transition-colors text-gray-600"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Loading */}
                {enrichState === 'loading' && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <span className="text-xs">Gerando sugestão de prompt com IA...</span>
                  </div>
                )}

                {/* Erro */}
                {enrichState === 'error' && (
                  <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-red-700">{enrichError}</p>
                    <button
                      onClick={() => setEnrichState('idle')}
                      className="text-xs text-red-600 underline mt-1"
                    >
                      Fechar
                    </button>
                  </div>
                )}

                {/* Botões principais (idle) */}
                {enrichState === 'idle' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={startAiFlow}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5
                                 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                                 transition-colors font-medium"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Adaptar com IA
                    </button>
                    <button
                      onClick={openManual}
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5
                                  rounded-lg border transition-colors font-medium
                                  ${manualSuggestionsOpen
                                    ? 'bg-gray-200 text-gray-700 border-gray-300'
                                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                  }`}
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" />
                      Ver sugestões manuais
                    </button>
                  </div>
                )}

                {/* Painel de sugestões manuais (Modo B) */}
                {manualSuggestionsOpen && enrichState === 'idle' && (
                  <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                    <ManualToolSuggestionsPanel
                      allowedTools={allowedTools}
                      onClose={() => setManualOpen(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de diff (Modo A) — renderizado via portal */}
      {enrichState === 'diff' && suggestedPrompt && (
        <EnrichDiffModal
          currentPrompt={advancedText}
          suggestedPrompt={suggestedPrompt}
          onApply={handleApply}
          onCopy={handleCopy}
          onCancel={handleCancelDiff}
        />
      )}
    </>
  )
}

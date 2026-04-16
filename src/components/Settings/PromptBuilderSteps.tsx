/**
 * PromptBuilderSteps
 *
 * Sub-componentes das etapas 2, 3 e 4 do PromptBuilderWizard.
 *   StepDetectedData  — Etapa 2: exibe dados detectados automaticamente
 *   StepUserAnswers   — Etapa 3: perguntas de configuração (4 campos opcionais)
 *   StepPreview       — Etapa 4: preview editável por bloco + salvar
 */

import { ArrowLeft, ArrowRight, Building2, CheckCircle, Loader2, Package, Phone, Globe, Sparkles } from 'lucide-react'
import type { Company } from '../../lib/supabase'
import type { FlatPromptConfig } from '../../services/promptBuilderApi'

// ── Tipos compartilhados ───────────────────────────────────────────────────────

export interface CatalogItem { id: string; name: string }

export type UserAnswers = {
  objective:            string
  communication_style:  string
  commercial_rules:     string
  custom_notes:         string
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
  const hasCompany = Boolean(company?.nome_fantasia ?? company?.name)

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <p className="text-sm font-medium text-blue-800">
          Encontramos essas informações automaticamente no seu sistema.
        </p>
        <p className="text-xs text-blue-600 mt-0.5">
          Elas serão usadas para personalizar seu agente sem que você precise digitar novamente.
        </p>
      </div>

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
          {!loadingCatalog && catalogItems.length > 0 && (
            <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />
          )}
        </div>

        <div className="px-4 py-3">
          {loadingCatalog ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando catálogo...
            </div>
          ) : catalogItems.length > 0 ? (
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
          ) : (
            <p className="text-sm text-gray-400 italic">
              Nenhum produto ou serviço cadastrado ainda.
            </p>
          )}
        </div>
      </div>

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
          rows={2}
          placeholder="Ex: Atender leads do WhatsApp, tirar dúvidas sobre nossos cursos e encaminhar interessados para matrícula."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Como o agente deve se comunicar?
        </label>
        <select
          value={answers.communication_style}
          onChange={e => update('communication_style', e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
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
          rows={2}
          placeholder="Ex: Não oferecer desconto sem aprovação. Sempre perguntar o nome antes de enviar proposta."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Existe algo importante que o cliente precisa saber?
        </label>
        <textarea
          value={answers.custom_notes}
          onChange={e => update('custom_notes', e.target.value)}
          rows={2}
          placeholder="Ex: Atendemos somente na região de SP. Parcelamos em até 12x sem juros no cartão."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none
                     focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Feedback de progresso visível durante a geração */}
      {generating && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              Analisando sua empresa e montando seu agente...
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Isso leva alguns segundos. Por favor, aguarde.
            </p>
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
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Aguardando...</>
            : <><Sparkles className="w-4 h-4" /> Gerar configuração do agente</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Etapa 4 — Preview editável ─────────────────────────────────────────────────

const PREVIEW_BLOCKS: { field: keyof FlatPromptConfig; label: string; rows: number; required?: boolean }[] = [
  { field: 'identity',            label: 'Identidade do agente',  rows: 3, required: true },
  { field: 'objective',           label: 'Objetivo principal',    rows: 3, required: true },
  { field: 'communication_style', label: 'Estilo de comunicação', rows: 2 },
  { field: 'commercial_rules',    label: 'Regras de atendimento', rows: 2 },
  { field: 'custom_notes',        label: 'Informações adicionais', rows: 2 },
]

export function StepPreview({
  config, setConfig,
  catalogCount, companyName,
  onBack, onSave, saving, error,
}: {
  config:       FlatPromptConfig
  setConfig:    (v: FlatPromptConfig) => void
  catalogCount: number
  companyName:  string
  onBack:       () => void
  onSave:       () => void
  saving:       boolean
  error:        string | null
}) {
  function update(field: keyof FlatPromptConfig, value: string) {
    setConfig({ ...config, [field]: value })
  }

  const canSave = config.identity?.trim().length >= 20 && config.objective?.trim().length >= 20

  return (
    <div className="space-y-4">
      {/* Resumo do que foi detectado */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: '🏢', label: 'Empresa', value: companyName || '—' },
          { icon: '📦', label: 'Catálogo', value: catalogCount > 0 ? `${catalogCount} itens` : 'Sem itens' },
          { icon: '✅', label: 'Configuração', value: 'Gerada' },
        ].map(item => (
          <div key={item.label} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-center">
            <p className="text-base">{item.icon}</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
            <p className="text-xs font-semibold text-gray-800 truncate">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
        <p className="text-sm font-semibold text-green-800">
          Seu agente já está pronto para atender seus clientes. 🎉
        </p>
        <p className="text-xs text-green-700 mt-0.5">
          Você pode ajustar qualquer parte abaixo, se quiser personalizar mais.
        </p>
      </div>

      {/* Blocos editáveis */}
      <div className="space-y-3">
        {PREVIEW_BLOCKS.map(({ field, label, rows, required }) => (
          <div key={field}>
            <label className="flex items-center gap-1 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              {label}
              {required && <span className="text-red-400 font-normal normal-case tracking-normal">obrigatório</span>}
            </label>
            <textarea
              value={config[field] ?? ''}
              onChange={e => update(field, e.target.value)}
              rows={rows}
              className={`w-full border rounded-lg px-3 py-2 text-sm resize-y leading-relaxed
                          focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                required && !config[field]?.trim()
                  ? 'border-red-200 bg-red-50 focus:ring-red-300'
                  : 'border-gray-200'
              }`}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} disabled={saving}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-40">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <button
          onClick={onSave}
          disabled={saving || !canSave}
          className="inline-flex items-center gap-2 px-5 py-2 bg-green-600 text-white
                     text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors font-medium"
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
            : '✓ Salvar agente'
          }
        </button>
      </div>
    </div>
  )
}

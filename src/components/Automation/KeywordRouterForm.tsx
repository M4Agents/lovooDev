// =====================================================
// COMPONENT: KEYWORD ROUTER FORM
// Formulário de configuração do nó keyword_router.
// Gerencia regras (label + keywords) com handles estáveis.
// =====================================================

import { useState, KeyboardEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { KeywordRouterConfig, KeywordRouterRule } from '../../types/automation'

const MAX_RULES = 20

function generateRuleId(): string {
  return (
    crypto?.randomUUID?.() ??
    `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

interface KeywordRouterFormProps {
  config: KeywordRouterConfig
  setConfig: (config: KeywordRouterConfig) => void
}

export default function KeywordRouterForm({ config, setConfig }: KeywordRouterFormProps) {
  const rules: KeywordRouterRule[] = Array.isArray(config.rules) ? config.rules : []
  const comparisonType = config.comparisonType ?? 'contains'
  const caseSensitive = config.caseSensitive ?? false

  // Input temporário de keyword por regra (id → texto digitado)
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({})

  // --------------------------------------------------
  // Helpers de update
  // --------------------------------------------------
  const updateRules = (updated: KeywordRouterRule[]) =>
    setConfig({ ...config, rules: updated })

  const addRule = () => {
    if (rules.length >= MAX_RULES) return
    const id = generateRuleId()
    updateRules([
      ...rules,
      { id, handle: `route-${id}`, label: '', keywords: [] },
    ])
  }

  const removeRule = (ruleId: string) => {
    updateRules(rules.filter((r) => r.id !== ruleId))
    setKeywordInputs((prev) => {
      const next = { ...prev }
      delete next[ruleId]
      return next
    })
  }

  const updateRule = (ruleId: string, patch: Partial<KeywordRouterRule>) => {
    updateRules(rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)))
  }

  // --------------------------------------------------
  // Gerenciamento de keywords de uma regra
  // --------------------------------------------------
  const addKeyword = (ruleId: string, value: string) => {
    const kw = value.trim()
    if (!kw) return
    const rule = rules.find((r) => r.id === ruleId)
    if (!rule) return
    if (rule.keywords.includes(kw)) return
    updateRule(ruleId, { keywords: [...rule.keywords, kw] })
    setKeywordInputs((prev) => ({ ...prev, [ruleId]: '' }))
  }

  const removeKeyword = (ruleId: string, kw: string) => {
    const rule = rules.find((r) => r.id === ruleId)
    if (!rule) return
    updateRule(ruleId, { keywords: rule.keywords.filter((k) => k !== kw) })
  }

  const handleKeywordKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    ruleId: string
  ) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword(ruleId, keywordInputs[ruleId] ?? '')
    }
  }

  // --------------------------------------------------
  // Render
  // --------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Tipo de comparação */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tipo de comparação
        </label>
        <select
          value={comparisonType}
          onChange={(e) =>
            setConfig({
              ...config,
              comparisonType: e.target.value as 'contains' | 'equals',
            })
          }
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
        >
          <option value="contains">Contém</option>
          <option value="equals">Igual a</option>
        </select>
        <p className="text-xs text-gray-400 mt-1">
          {comparisonType === 'contains'
            ? 'A mensagem deve conter pelo menos uma das palavras-chave.'
            : 'A mensagem deve ser exatamente igual a uma das palavras-chave (texto completo).'}
        </p>
      </div>

      {/* Case sensitive */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) =>
              setConfig({ ...config, caseSensitive: e.target.checked })
            }
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-sm text-gray-700">
            Diferenciar maiúsculas e minúsculas
          </span>
        </label>
        <p className="text-xs text-gray-400 mt-0.5 ml-6">
          {caseSensitive
            ? '"Olá" e "olá" são tratados como diferentes.'
            : '"Olá" e "OLÁ" são tratados como iguais.'}
        </p>
      </div>

      {/* Regras */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Regras{' '}
            <span className="text-gray-400 font-normal">
              ({rules.length}/{MAX_RULES})
            </span>
          </span>
          <button
            type="button"
            onClick={addRule}
            disabled={rules.length >= MAX_RULES}
            className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar regra
          </button>
        </div>

        {rules.length === 0 && (
          <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-xs text-gray-400">
              Nenhuma regra configurada.
              <br />
              Clique em "Adicionar regra" para começar.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50"
            >
              {/* Cabeçalho da regra */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  Regra {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Remover regra"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Label da regra */}
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">
                  Nome (exibido no nó)
                </label>
                <input
                  type="text"
                  value={rule.label}
                  onChange={(e) =>
                    updateRule(rule.id, { label: e.target.value })
                  }
                  placeholder="Ex: Elétrica, Solar, Móveis..."
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                />
              </div>

              {/* Keywords */}
              <div>
                <label className="block text-xs text-gray-600 mb-0.5">
                  Palavras-chave{' '}
                  <span className="text-gray-400">(Enter ou vírgula para adicionar)</span>
                </label>

                {/* Tags de keywords existentes */}
                {rule.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {rule.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-[10px] font-medium px-1.5 py-0.5 rounded"
                      >
                        {kw}
                        <button
                          type="button"
                          onClick={() => removeKeyword(rule.id, kw)}
                          className="hover:text-purple-900 transition-colors"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={keywordInputs[rule.id] ?? ''}
                  onChange={(e) =>
                    setKeywordInputs((prev) => ({
                      ...prev,
                      [rule.id]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => handleKeywordKeyDown(e, rule.id)}
                  onBlur={() => addKeyword(rule.id, keywordInputs[rule.id] ?? '')}
                  placeholder="Digite e pressione Enter..."
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                />

                {rule.keywords.length === 0 && (
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    Adicione ao menos uma palavra-chave para esta regra.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
        <strong>Como funciona:</strong> quando uma mensagem for recebida, o texto
        é verificado contra cada regra. Todas as regras que derem match serão
        executadas em paralelo. Se nenhuma bater, o ramo <em>Padrão</em> é
        ativado.
      </div>
    </div>
  )
}

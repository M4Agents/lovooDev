import { useState, useEffect } from 'react'
import { AlertCircle, Loader2, Info } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { companyOwnAgentsApi, type CompanyAgent } from '../../../services/companyOwnAgentsApi'

// Regex idêntica ao backend (agentNodeHandler.js)
const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const VARIABLE_NAME_MAX = 64

interface ExecuteAgentFormProps {
  config: Record<string, any>
  setConfig: (config: Record<string, any>) => void
}

function validateVariableName(value: string): string | null {
  const trimmed = value.trim().slice(0, VARIABLE_NAME_MAX)
  if (!trimmed) return 'Nome da variável é obrigatório'
  if (!VARIABLE_NAME_RE.test(trimmed)) {
    return 'Use apenas letras, números e underscores. Deve começar com letra ou _'
  }
  return null
}

export default function ExecuteAgentForm({ config, setConfig }: ExecuteAgentFormProps) {
  const { company } = useAuth()

  const [agents, setAgents] = useState<CompanyAgent[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)

  const [varError, setVarError] = useState<string | null>(null)

  // Carrega agentes ativos da empresa
  useEffect(() => {
    if (!company?.id) return

    setLoadingAgents(true)
    setAgentError(null)

    companyOwnAgentsApi.list(company.id)
      .then((list) => {
        setAgents(list.filter((a) => a.is_active))
      })
      .catch((err) => {
        setAgentError(err?.message ?? 'Erro ao carregar agentes')
      })
      .finally(() => {
        setLoadingAgents(false)
      })
  }, [company?.id])

  // Ao selecionar agente, persiste também o nome para o card do canvas exibir sem extra-fetch
  const handleAgentChange = (agentId: string) => {
    const selected = agents.find((a) => a.id === agentId)
    setConfig({ ...config, agentId, agentName: selected?.name ?? null })
  }

  const handlePromptChange = (value: string) => {
    setConfig({ ...config, promptTemplate: value })
  }

  const handleVariableChange = (value: string) => {
    setVarError(validateVariableName(value))
    setConfig({ ...config, saveToVariable: value })
  }

  const handleOnErrorChange = (value: string) => {
    setConfig({ ...config, onError: value })
  }

  const currentOnError = config.onError || 'continue'

  return (
    <div className="space-y-5">

      {/* ── Agente ── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Agente <span className="text-red-500">*</span>
        </label>

        {loadingAgents ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando agentes…
          </div>
        ) : agentError ? (
          <div className="flex items-center gap-2 text-sm text-red-600 py-1">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {agentError}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-gray-400 italic py-1">
            Nenhum agente ativo encontrado nesta empresa.
          </div>
        ) : (
          <select
            value={config.agentId || ''}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-violet-500 focus:ring-violet-500"
          >
            <option value="">— Selecione um agente —</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Prompt ── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Prompt <span className="text-red-500">*</span>
        </label>
        <textarea
          value={config.promptTemplate || ''}
          onChange={(e) => handlePromptChange(e.target.value)}
          rows={5}
          placeholder={'Ex: Classifique a intenção do lead abaixo:\n\nNome: {{nome}}\nMensagem: {{ultima_mensagem}}'}
          className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-violet-500 focus:ring-violet-500 font-mono resize-y"
        />
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
          <Info className="w-3 h-3 flex-shrink-0" />
          Use{' '}
          <code className="bg-gray-100 px-1 rounded text-violet-700 font-mono">
            {'{{variavel}}'}
          </code>{' '}
          para inserir variáveis do contexto.
        </p>
      </div>

      {/* ── Variável de saída ── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Salvar resposta em <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-400 font-mono select-none">{'{{'}</span>
          <input
            type="text"
            value={config.saveToVariable || ''}
            onChange={(e) => handleVariableChange(e.target.value)}
            maxLength={VARIABLE_NAME_MAX}
            placeholder="resposta_agente"
            className={`flex-1 rounded-md text-sm shadow-sm font-mono focus:ring-violet-500 ${
              varError
                ? 'border-red-400 focus:border-red-500'
                : 'border-gray-300 focus:border-violet-500'
            }`}
          />
          <span className="text-sm text-gray-400 font-mono select-none">{'}}'}</span>
        </div>
        {varError && (
          <div className="flex items-start gap-1.5 mt-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">{varError}</p>
          </div>
        )}
        {!varError && config.saveToVariable?.trim() && (
          <p className="text-xs text-gray-400 mt-1">
            A resposta do agente ficará disponível como{' '}
            <code className="bg-gray-100 px-1 rounded text-violet-700 font-mono">
              {'{{' + config.saveToVariable.trim() + '}}'}
            </code>{' '}
            nos próximos nós.
          </p>
        )}
      </div>

      {/* ── Comportamento em caso de erro ── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Em caso de falha do agente
        </label>
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="onError"
              value="continue"
              checked={currentOnError === 'continue'}
              onChange={() => handleOnErrorChange('continue')}
              className="mt-0.5 text-violet-600 focus:ring-violet-500"
            />
            <div>
              <span className="text-sm text-gray-900 font-medium">Continuar o flow</span>
              <p className="text-xs text-gray-500">
                O nó é marcado como ignorado e o flow segue normalmente.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="onError"
              value="stop"
              checked={currentOnError === 'stop'}
              onChange={() => handleOnErrorChange('stop')}
              className="mt-0.5 text-violet-600 focus:ring-violet-500"
            />
            <div>
              <span className="text-sm text-gray-900 font-medium">Parar o flow</span>
              <p className="text-xs text-gray-500">
                A execução é interrompida e marcada como falha.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* ── Aviso sobre tools ── */}
      <div className="flex items-start gap-2 rounded-md bg-violet-50 border border-violet-200 px-3 py-2.5">
        <Info className="w-3.5 h-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-violet-700 leading-snug">
          <strong>v1:</strong> O agente responde apenas em texto. Ferramentas e structured output serão liberados em breve.
        </p>
      </div>
    </div>
  )
}

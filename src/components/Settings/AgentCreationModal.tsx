/**
 * AgentCreationModal
 *
 * Shell do modal premium para criação de agente conversacional.
 *
 * Responsabilidades:
 *   - overlay + container + animação de entrada
 *   - header dinâmico: título, stepper, botão Ajuda, botão X
 *   - drawer interno do Assistente de Configuração (steps 3–4)
 *   - fechamento controlado com confirmação de perda de progresso
 *   - toda a lógica de estado e API permanece no PromptBuilderWizard
 *
 * Layout:
 *   - Steps 1–3, 5: max-w-4xl
 *   - Step 4 (preview 2 colunas): max-w-6xl
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Sparkles, Check, X } from 'lucide-react'
import { PromptBuilderStepper } from './PromptBuilderStepper'
import { PromptBuilderWizard } from './PromptBuilderWizard'
import { PromptBuilderSupportChat } from './PromptBuilderSupportChat'
import { AgentTestSandbox } from './AgentTestSandbox'
import type { CompanyAgent } from '../../services/companyOwnAgentsApi'
import type { FlatPromptConfig } from '../../services/promptBuilderApi'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Props {
  isOpen:     boolean
  onClose:    () => void
  companyId:  string
  onSaved:    (agent: CompanyAgent) => void
  onAdvanced: () => void
}

// ── Componente ─────────────────────────────────────────────────────────────────

export function AgentCreationModal({ isOpen, onClose, companyId, onSaved, onAdvanced }: Props) {
  const [step, setStep]               = useState<number>(1)
  const [showConfirm, setShowConfirm] = useState(false)
  const [visible, setVisible]         = useState(false)
  const [isSupportOpen, setSupport]   = useState(false)

  // Estado do sandbox
  const [sandboxOpen, setSandboxOpen]           = useState(false)
  const [sandboxConfig, setSandboxConfig]       = useState<FlatPromptConfig | null>(null)
  const [sandboxAgentName, setSandboxAgentName] = useState('')
  const [sandboxCompanyName, setSandboxCompany] = useState('')
  const [sandboxIsSaved, setSandboxIsSaved]     = useState(false)
  const [sandboxAgentId, setSandboxAgentId]     = useState<string | null>(null)

  // #region agent log — debug scroll
  const scrollRef = useRef<HTMLDivElement>(null)
  // #endregion

  // Animação de entrada / saída e lock do scroll do body
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
      document.body.style.overflow = ''
      setStep(1)
      setSupport(false)
      setSandboxOpen(false)
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Fechar suporte quando sair dos steps 3–4
  useEffect(() => {
    if (step < 3 || step > 4) setSupport(false)
  }, [step])

  // #region agent log — debug scroll
  useEffect(() => {
    if (!isOpen) return
    const el = scrollRef.current
    if (!el) return
    const cs = window.getComputedStyle(el)
    const parentEl = el.parentElement
    const parentCs = parentEl ? window.getComputedStyle(parentEl) : null
    console.log('[DBG:cf8832] AgentCreationModal scroll container', {
      step,
      scrollHeight:  el.scrollHeight,
      clientHeight:  el.clientHeight,
      offsetHeight:  el.offsetHeight,
      overflows:     el.scrollHeight > el.clientHeight,
      overflowY:     cs.overflowY,
      height:        cs.height,
      parentOverflow:  parentCs?.overflow  ?? 'n/a',
      parentOverflowY: parentCs?.overflowY ?? 'n/a',
      parentHeight:    parentEl?.clientHeight ?? 'n/a',
      scrollbarWidth:  cs.scrollbarWidth ?? 'n/a',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isOpen])
  // #endregion

  // Fechar com Escape (confirmação se houver progresso)
  useEffect(() => {
    if (!isOpen) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSupportOpen) { setSupport(false); return }
        handleRequestClose()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isOpen, step, isSupportOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRequestClose() {
    if (step > 2 && step < 5) {
      setShowConfirm(true)
    } else {
      doClose()
    }
  }

  function doClose() {
    setShowConfirm(false)
    setSupport(false)
    onClose()
  }

  function handleSaved(agent: CompanyAgent) {
    setSandboxIsSaved(true)
    // Ao salvar, armazena o agent_id para que o sandbox use a knowledge_base real
    setSandboxAgentId(agent.id ?? null)
    onSaved(agent)
  }

  function handleTest(config: FlatPromptConfig, agentName: string, companyName: string) {
    setSandboxConfig(config)
    setSandboxAgentName(agentName)
    setSandboxCompany(companyName)
    setSupport(false)     // fecha drawer de ajuda se estiver aberto
    setSandboxOpen(true)
  }

  if (!isOpen) return null

  const isSuccess      = step === 5
  const showSupport    = step >= 3 && step <= 4
  // Step 4 usa container mais largo para acomodar o layout 2 colunas
  const containerWidth = step === 4
    ? 'sm:max-w-5xl lg:max-w-6xl'
    : 'sm:max-w-3xl md:max-w-4xl'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Criar novo agente"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 md:p-6"
    >
      {/* Overlay */}
      <div
        aria-hidden="true"
        onClick={handleRequestClose}
        className={`absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Container do modal — largura dinâmica conforme o step */}
      <div
        onClick={e => e.stopPropagation()}
        className={`
          relative w-full bg-white flex flex-col overflow-hidden shadow-2xl
          rounded-t-2xl sm:rounded-2xl
          max-h-[92vh] sm:max-h-[90vh] min-h-[540px]
          transition-all duration-200 ease-out
          ${containerWidth}
          ${visible
            ? 'opacity-100 translate-y-0 sm:scale-100'
            : 'opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95'
          }
        `}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className={`
          flex items-center justify-between gap-4
          px-5 py-4 border-b border-gray-100 flex-shrink-0
          ${isSuccess
            ? 'bg-green-50'
            : 'bg-gradient-to-r from-blue-50 to-indigo-50'
          }
        `}>
          {/* Ícone + título */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isSuccess ? 'bg-green-100' : 'bg-white shadow-sm'
            }`}>
              {isSuccess
                ? <Check className="w-4 h-4 text-green-600" />
                : <Sparkles className="w-4 h-4 text-blue-600" />
              }
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {isSuccess ? 'Agente criado com sucesso!' : 'Criar novo agente'}
              </p>
              {!isSuccess && (
                <p className="text-xs text-gray-500 hidden sm:block">
                  O sistema detecta os dados da sua empresa automaticamente
                </p>
              )}
            </div>
          </div>

          {/* Ações do header: stepper + botão Ajuda + botão X */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden sm:block">
              <PromptBuilderStepper current={step} />
            </div>

            {/* Botão Ajuda — visível apenas nos steps 3 e 4 */}
            {showSupport && (
              <button
                onClick={() => setSupport(v => !v)}
                aria-label={isSupportOpen ? 'Fechar assistente' : 'Abrir assistente de configuração'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                            transition-colors border ${
                  isSupportOpen
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Ajuda</span>
              </button>
            )}

            <button
              onClick={handleRequestClose}
              aria-label="Fechar"
              className="w-8 h-8 flex items-center justify-center rounded-full
                         text-gray-400 hover:text-gray-600 hover:bg-white/80
                         transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stepper mobile (abaixo do header) */}
        <div className="sm:hidden flex-shrink-0 px-5 py-3 border-b border-gray-100 bg-white">
          <PromptBuilderStepper current={step} />
        </div>

        {/* ── Body + Drawer ─────────────────────────────────────────────────
         *  min-h-0 é essencial: sem ele, flex-1 herda min-height: auto do
         *  conteúdo filho e ultrapassa o max-h do container, quebrando o scroll.
         *  O overflow-hidden clippa o drawer absoluto dentro dos limites do body.
         ──────────────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 relative overflow-hidden">

          {/* Conteúdo scrollável do wizard — ocupa 100% e rola internamente */}
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto scroll-smooth [scrollbar-width:thin] [scrollbar-color:#CBD5E1_transparent]
                          [&::-webkit-scrollbar]:w-1.5
                          [&::-webkit-scrollbar-track]:bg-transparent
                          [&::-webkit-scrollbar-thumb]:bg-gray-300
                          [&::-webkit-scrollbar-thumb]:rounded-full
                          [&::-webkit-scrollbar-thumb:hover]:bg-gray-400"
          >
            <PromptBuilderWizard
              companyId={companyId}
              onSaved={handleSaved}
              onAdvanced={onAdvanced}
              onCancel={doClose}
              insideModal
              onStepChange={setStep}
              onTest={handleTest}
            />
          </div>

          {/* Gradiente inferior — indica ao usuário que há mais conteúdo abaixo */}
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none
                       bg-gradient-to-t from-white/90 to-transparent z-[5]"
          />

          {/* Drawer do Assistente de Configuração
           *  Posicionado absolute sobre o conteúdo — NÃO empurra nem redimensiona
           *  o wizard. O conteúdo principal mantém largura original sempre.
           ── */}
          {showSupport && (
            <div
              className={`
                absolute inset-y-0 right-0 w-full sm:w-80
                border-l border-gray-200 shadow-xl z-10
                transform transition-transform duration-200 ease-out
                ${isSupportOpen ? 'translate-x-0' : 'translate-x-full'}
              `}
            >
              <PromptBuilderSupportChat
                companyId={companyId}
                asDrawer
                onClose={() => setSupport(false)}
              />
            </div>
          )}

          {/* Overlay do Sandbox — cobre o body inteiro quando aberto */}
          {sandboxOpen && sandboxConfig && (
            <div className="absolute inset-0 z-20 bg-white">
              <AgentTestSandbox
                companyId={companyId}
                promptConfig={sandboxConfig}
                agentName={sandboxAgentName}
                companyName={sandboxCompanyName}
                agentId={sandboxAgentId}
                isSaved={sandboxIsSaved}
                onBack={() => setSandboxOpen(false)}
                onSave={!sandboxIsSaved ? doClose : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Diálogo de confirmação de saída ─────────────────────────────── */}
      {showConfirm && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h4 className="text-base font-semibold text-gray-900">Sair da criação?</h4>
              <p className="text-sm text-gray-500">
                O progresso da configuração será perdido. Tem certeza?
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900
                           rounded-lg hover:bg-gray-100 transition-colors"
              >
                Continuar editando
              </button>
              <button
                onClick={doClose}
                className="px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg
                           hover:bg-red-100 transition-colors font-medium"
              >
                Sair mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

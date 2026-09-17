// =============================================================================
// MetaWhatsAppPanel
//
// Painel de gerenciamento de instâncias Meta WhatsApp Cloud API.
//
// Estados:
//   1. loading        — carregando instâncias
//   2. error          — falha na API + botão tentar novamente
//   3. sem conexão    — empresa sem instâncias + explicação + botão desabilitado
//   4. conectado      — lista de instâncias ativas com dados públicos
//
// Regras:
//   - company vem de useCompany() — nunca prop
//   - dados via useMetaWhatsAppInstances — nunca Supabase direto
//   - botão "Conectar" desabilitado — onboarding será fase posterior
//   - 401/403/500 tratados como erro/indisponibilidade — sem bypass
//   - nenhum ID técnico exposto desnecessariamente na UI
//   - zero window.FB / SDK Meta / Uazapi / feature flag como autorização
// =============================================================================

import { useTranslation }                  from 'react-i18next'
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Phone, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useCompany }                      from '../../hooks/useCompany'
import { useMetaOnboarding }              from '../../hooks/useMetaOnboarding'
import { useMetaWhatsAppInstances }        from '../../hooks/useMetaWhatsAppInstances'
import type { MetaWhatsAppInstance }       from '../../types/meta-whatsapp'

// ── Status badge ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: MetaWhatsAppInstance['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation('settings.app')
  const mw = (key: string) => t(`metaWhatsApp.${key}`)

  const config = {
    connected: {
      icon:  <Wifi className="w-3 h-3" />,
      label: mw('status.connected'),
      cls:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    disconnected: {
      icon:  <WifiOff className="w-3 h-3" />,
      label: mw('status.disconnected'),
      cls:   'bg-slate-100 text-slate-500 border-slate-200',
    },
    error: {
      icon:  <AlertCircle className="w-3 h-3" />,
      label: mw('status.error'),
      cls:   'bg-red-50 text-red-600 border-red-200',
    },
    token_revoked: {
      icon:  <AlertCircle className="w-3 h-3" />,
      label: mw('status.token_revoked'),
      cls:   'bg-amber-50 text-amber-700 border-amber-200',
    },
  } as const

  const { icon, label, cls } = config[status] ?? config.disconnected

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  )
}

// ── Card de instância ─────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: MetaWhatsAppInstance }) {
  const displayName = instance.display_name ?? instance.verified_name ?? '—'

  return (
    <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100">
          <MessageCircle className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">{displayName}</p>
          {instance.phone_number && (
            <p className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
              <Phone className="w-3 h-3" />
              {instance.phone_number}
            </p>
          )}
        </div>
      </div>
      <StatusBadge status={instance.status} />
    </div>
  )
}

// ── Painel principal ──────────────────────────────────────────────────────────

export function MetaWhatsAppPanel() {
  const { t }                             = useTranslation('settings.app')
  const mw = (key: string, opts?: Record<string, unknown>) =>
    t(`metaWhatsApp.${key}`, opts)
  const { company }                       = useCompany()
  const { instances, loading, error, refresh } = useMetaWhatsAppInstances(company?.id)

  // Onboarding habilitado somente quando company presente, GET concluído e sem erro
  const {
    step,
    onboardingError,
    triggerPopup,
    cancelFlow,
    isReady,
    selectionOptions,
    selectWaba,
  } = useMetaOnboarding({
    enabled:   Boolean(company?.id) && !loading && !error,
    onSuccess: refresh,
  })

  // Derivados do step — calculados antes dos early returns (sem hooks aqui)
  const isProcessing       = step === 'loading_session' || step === 'completing' || step === 'resolving_selection'
  const progressLabel      = step === 'loading_session'
    ? mw('onboarding.preparing')
    : mw('onboarding.completing')
  const connectButtonIcon  = isProcessing
    ? <Loader2 className="w-4 h-4 animate-spin" />
    : <MessageCircle className="w-4 h-4" />

  // ── 1. Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  // ── 2. Error ────────────────────────────────────────────────────────────────
  // 401, 403 e 500 chegam aqui como mensagem sanitizada do service.
  // Não revelar causa técnica — mostrar ação de retry.
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-600">{error}</p>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {mw('error.retry')}
        </button>
      </div>
    )
  }

  // ── 3. Seleção de WABA (múltiplos WABAs autorizados) ──────────────────────
  // Renderizado quando awaiting_selection OU resolving_selection.
  // Nunca expõe IDs técnicos (WABA ID, phone_number_id, continuation_token).
  if (step === 'awaiting_selection' || step === 'resolving_selection') {
    const isResolving = step === 'resolving_selection'
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center">

        {/* Ícone */}
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
          <Phone className="w-8 h-8 text-green-600" />
        </div>

        {/* Título + descrição */}
        <div className="space-y-1.5 max-w-sm">
          <h3 className="text-base font-semibold text-slate-900">
            {mw('selection.title')}
          </h3>
          <p className="text-sm text-slate-500">
            {mw('selection.description')}
          </p>
        </div>

        {/* Lista de opções */}
        <div className="flex flex-col gap-2 w-full max-w-md">
          {(selectionOptions ?? []).map((option) => (
            <button
              key={option.index}
              onClick={() => selectWaba(option.index)}
              disabled={isResolving}
              className={`flex flex-col items-start gap-0.5 w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-left transition-colors ${
                isResolving
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:border-green-400 hover:bg-green-50'
              }`}
            >
              {/* name (verified_name) se disponível — NÃO renderizar IDs técnicos */}
              {option.name && (
                <span className="text-sm font-medium text-slate-900">{option.name}</span>
              )}
              {/* label: número de telefone formatado */}
              <span className="flex items-center gap-1.5 text-sm text-slate-500">
                <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                {option.label}
              </span>
            </button>
          ))}
        </div>

        {/* Loading durante resolving_selection */}
        {isResolving && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {mw('selection.selecting')}
          </div>
        )}

        {/* Cancelar — usa lifecycle seguro existente */}
        {!isResolving && (
          <button
            onClick={cancelFlow}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {mw('selection.cancelButton')}
          </button>
        )}
      </div>
    )
  }

  // ── 4. Sem conexão ─────────────────────────────────────────────────────────
  if (instances.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center">

        {/* Ícone */}
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
          <MessageCircle className="w-8 h-8 text-green-600" />
        </div>

        {/* Título + descrição */}
        <div className="space-y-1.5 max-w-sm">
          <h3 className="text-base font-semibold text-slate-900">
            {mw('empty.title')}
          </h3>
          <p className="text-sm text-slate-500">
            {mw('empty.description')}
          </p>
        </div>

        {/* Destaques */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg text-left">
          {(['highlight1', 'highlight2', 'highlight3'] as const).map((key) => (
            <div key={key} className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-slate-600">{mw(`empty.${key}`)}</span>
            </div>
          ))}
        </div>

        {/* Botão Conectar + estados de onboarding */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={triggerPopup}
            disabled={!isReady}
            className={`flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg ${isReady ? 'hover:bg-green-700 transition-colors' : 'opacity-50 cursor-not-allowed'}`}
          >
            {connectButtonIcon}
            {isProcessing ? progressLabel : mw('empty.connectButton')}
          </button>

          {/* comingSoon: somente idle sem erro de onboarding */}
          {step === 'idle' && !onboardingError && (
            <p className="text-xs text-slate-400">{mw('empty.comingSoon')}</p>
          )}

          {/* Erro de onboarding — visualmente separado do erro de GET instances */}
          {onboardingError && (
            <div className="flex flex-col items-center gap-1.5">
              <p className="text-xs text-red-500">{onboardingError}</p>
              <button
                onClick={cancelFlow}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                {mw('error.retry')}
              </button>
            </div>
          )}
        </div>

      </div>
    )
  }

  // ── 5. Conectado — listar instâncias ───────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {mw('connected.title')}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {mw('connected.subtitle', { count: instances.length })}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {mw('connected.refresh')}
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {instances.map((instance) => (
          <InstanceCard key={instance.id} instance={instance} />
        ))}
      </div>

      {/* Botão conectar outro número */}
      <button
        onClick={triggerPopup}
        disabled={!isReady}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg ${isReady ? 'hover:bg-green-100 transition-colors' : 'opacity-50 cursor-not-allowed'}`}
      >
        {connectButtonIcon}
        {isProcessing ? progressLabel : mw('connected.addButton')}
      </button>

      {/* Erro de onboarding — separado do erro de GET instances */}
      {onboardingError && (
        <div className="flex items-center justify-center gap-2 mt-1.5">
          <p className="text-xs text-red-500">{onboardingError}</p>
          <button
            onClick={cancelFlow}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {mw('error.retry')}
          </button>
        </div>
      )}

    </div>
  )
}

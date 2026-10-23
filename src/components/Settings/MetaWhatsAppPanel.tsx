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

import { useEffect, useRef, useState }     from 'react'
import { useTranslation }                  from 'react-i18next'
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Phone, RefreshCw, Unlink, Wifi, WifiOff, X } from 'lucide-react'
import { useAccessControl }                from '../../hooks/useAccessControl'
import { useCompany }                      from '../../hooks/useCompany'
import { useMetaOnboarding }              from '../../hooks/useMetaOnboarding'
import { useMetaWhatsAppInstances }        from '../../hooks/useMetaWhatsAppInstances'
import { metaWhatsAppApi }                 from '../../services/metaWhatsAppApi'
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

function InstanceCard({
  instance,
  canDisconnect,
  onRequestDisconnect,
}: {
  instance: MetaWhatsAppInstance
  canDisconnect: boolean
  onRequestDisconnect: (instance: MetaWhatsAppInstance) => void
}) {
  const { t } = useTranslation('settings.app')
  const displayName = instance.display_name ?? instance.verified_name ?? '—'
  const showDisconnect = canDisconnect && instance.status === 'connected'

  return (
    <div className="flex items-center justify-between gap-3 p-4 bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 shrink-0">
          <MessageCircle className="w-5 h-5 text-green-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{displayName}</p>
          {instance.phone_number && (
            <p className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
              <Phone className="w-3 h-3" />
              {instance.phone_number}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={instance.status} />
        {showDisconnect && (
          <button
            type="button"
            onClick={() => onRequestDisconnect(instance)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            <Unlink className="w-3.5 h-3.5" />
            {t('metaWhatsApp.disconnect.action')}
          </button>
        )}
      </div>
    </div>
  )
}

function mapDisconnectError(message: string, translate: (key: string) => string): string {
  if (message === 'invalid_request' || message === 'company_id inválido') {
    return translate('disconnect.errorInvalid')
  }
  if (
    message === 'Autenticação necessária' ||
    message === 'Sessão inválida ou expirada'
  ) {
    return translate('disconnect.errorSession')
  }
  if (
    message === 'instance_not_found'
  ) {
    return translate('disconnect.errorNotFound')
  }
  if (message === 'instance_state_conflict') {
    return translate('disconnect.errorConflict')
  }
  if (
    message === 'Permissão insuficiente para esta operação' ||
    message === 'Partner sem assignment ativo para esta empresa' ||
    message === 'Meta WhatsApp não habilitado para esta empresa' ||
    message === 'Acesso negado a esta empresa' ||
    message === 'Empresa não encontrada ou sem acesso'
  ) {
    return translate('disconnect.errorForbidden')
  }
  return translate('disconnect.errorGeneric')
}

function shouldRefreshAfterDisconnectError(message: string): boolean {
  return message === 'instance_not_found' || message === 'instance_state_conflict'
}

function DisconnectConfirmModal({
  loading,
  error,
  onConfirm,
  onCancel,
}: {
  loading: boolean
  error:   string | null
  onConfirm: () => void
  onCancel:  () => void
}) {
  const { t } = useTranslation('settings.app')
  const mw = (key: string) => t(`metaWhatsApp.${key}`)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meta-disconnect-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 id="meta-disconnect-title" className="text-lg font-semibold text-slate-900">
            {mw('disconnect.confirmTitle')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-600">{mw('disconnect.confirmDescription')}</p>
          <p className="text-sm text-slate-600">{mw('disconnect.confirmPreserve')}</p>
          <p className="text-sm text-slate-600">{mw('disconnect.confirmMeta')}</p>
          <p className="text-sm text-slate-500">{mw('disconnect.confirmReconnect')}</p>
          {error && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}
        </div>

        <div className="flex gap-3 p-6 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mw('disconnect.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {mw('disconnect.confirming')}
              </span>
            ) : mw('disconnect.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Painel principal ──────────────────────────────────────────────────────────

export function MetaWhatsAppPanel() {
  const { t }                             = useTranslation('settings.app')
  const mw = (key: string, opts?: Record<string, unknown>) =>
    t(`metaWhatsApp.${key}`, opts)
  const { canConnectMetaWhatsApp }        = useAccessControl()
  const { company }                       = useCompany()
  const { instances, loading, error, refresh } = useMetaWhatsAppInstances(company?.id)
  const [pendingInstance, setPendingInstance] = useState<MetaWhatsAppInstance | null>(null)
  const [disconnecting, setDisconnecting]     = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const [disconnectSuccess, setDisconnectSuccess] = useState<string | null>(null)

  // Geração do contexto de desconexão. Incrementa a cada troca de empresa
  // para que callbacks assíncronos da empresa anterior não atualizem a UI.
  const disconnectGenerationRef = useRef(0)
  // Guard síncrono: o estado `disconnecting` só bloqueia no próximo render.
  const disconnectInFlightRef   = useRef(false)

  useEffect(() => {
    disconnectGenerationRef.current += 1
    disconnectInFlightRef.current = false
    setPendingInstance(null)
    setDisconnecting(false)
    setDisconnectError(null)
    setDisconnectSuccess(null)
  }, [company?.id])

  const requestDisconnect = (instance: MetaWhatsAppInstance) => {
    if (disconnecting || disconnectInFlightRef.current) return
    setDisconnectError(null)
    setDisconnectSuccess(null)
    setPendingInstance(instance)
  }

  const cancelDisconnect = () => {
    if (disconnecting || disconnectInFlightRef.current) return
    setPendingInstance(null)
    setDisconnectError(null)
  }

  const confirmDisconnect = async () => {
    if (!pendingInstance || !company?.id || disconnectInFlightRef.current) return

    disconnectInFlightRef.current = true
    const startedGeneration = disconnectGenerationRef.current
    const startedCompanyId  = company.id
    const startedInstanceId = pendingInstance.id

    setDisconnecting(true)
    setDisconnectError(null)
    try {
      await metaWhatsAppApi.disconnectInstance(startedCompanyId, startedInstanceId)
      if (disconnectGenerationRef.current !== startedGeneration) return
      setPendingInstance(null)
      setDisconnectSuccess(mw('disconnect.success'))
      refresh()
    } catch (err: unknown) {
      if (disconnectGenerationRef.current !== startedGeneration) return
      const message = err instanceof Error ? err.message : 'internal_error'
      setDisconnectError(mapDisconnectError(message, mw))
      if (shouldRefreshAfterDisconnectError(message)) {
        refresh()
      }
    } finally {
      if (disconnectGenerationRef.current === startedGeneration) {
        disconnectInFlightRef.current = false
        setDisconnecting(false)
      }
    }
  }

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

      {disconnectSuccess && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" role="status">
          {disconnectSuccess}
        </p>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {instances.map((instance) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            canDisconnect={canConnectMetaWhatsApp}
            onRequestDisconnect={requestDisconnect}
          />
        ))}
      </div>

      {pendingInstance && (
        <DisconnectConfirmModal
          loading={disconnecting}
          error={disconnectError}
          onConfirm={() => { void confirmDisconnect() }}
          onCancel={cancelDisconnect}
        />
      )}

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

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

import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Phone, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useCompany }                      from '../../hooks/useCompany'
import { useMetaWhatsAppInstances }        from '../../hooks/useMetaWhatsAppInstances'
import type { MetaWhatsAppInstance }       from '../../types/meta-whatsapp'

// ── Status badge ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: MetaWhatsAppInstance['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    connected: {
      icon:  <Wifi className="w-3 h-3" />,
      label: 'Conectado',
      cls:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    disconnected: {
      icon:  <WifiOff className="w-3 h-3" />,
      label: 'Desconectado',
      cls:   'bg-slate-100 text-slate-500 border-slate-200',
    },
    error: {
      icon:  <AlertCircle className="w-3 h-3" />,
      label: 'Erro',
      cls:   'bg-red-50 text-red-600 border-red-200',
    },
    token_revoked: {
      icon:  <AlertCircle className="w-3 h-3" />,
      label: 'Token revogado',
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
  const { company }                       = useCompany()
  const { instances, loading, error, refresh } = useMetaWhatsAppInstances(company?.id)

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
          Tentar novamente
        </button>
      </div>
    )
  }

  // ── 3. Sem conexão ─────────────────────────────────────────────────────────
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
            WhatsApp Cloud API (Meta)
          </h3>
          <p className="text-sm text-slate-500">
            Conecte um número de WhatsApp oficial usando a API nativa da Meta
            (Cloud API). Sem número espelho — direto na plataforma oficial.
          </p>
        </div>

        {/* Destaques */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg text-left">
          {[
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />, text: 'Número oficial verificado pela Meta' },
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />, text: 'Envio de templates aprovados' },
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />, text: 'Sem risco de ban por uso de API não oficial' },
          ].map(({ icon, text }, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              {icon}
              <span className="text-xs text-slate-600">{text}</span>
            </div>
          ))}
        </div>

        {/* Botão desabilitado — onboarding habilitado na próxima fase */}
        <div className="flex flex-col items-center gap-2">
          <button
            disabled
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg opacity-50 cursor-not-allowed"
          >
            <MessageCircle className="w-4 h-4" />
            Conectar WhatsApp
          </button>
          <p className="text-xs text-slate-400">
            Funcionalidade de conexão em breve
          </p>
        </div>

      </div>
    )
  }

  // ── 4. Conectado — listar instâncias ───────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Números conectados
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {instances.length} {instances.length === 1 ? 'número ativo' : 'números ativos'} via WhatsApp Cloud API
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {instances.map((instance) => (
          <InstanceCard key={instance.id} instance={instance} />
        ))}
      </div>

      {/* Botão de adicionar — desabilitado por enquanto */}
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg opacity-50 cursor-not-allowed"
      >
        <MessageCircle className="w-4 h-4" />
        Conectar outro número
      </button>

    </div>
  )
}

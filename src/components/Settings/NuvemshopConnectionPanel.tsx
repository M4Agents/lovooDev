import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Plus,
  Unlink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Loader2,
  Globe,
  Calendar,
  Clock,
  DollarSign,
  BarChart3,
} from 'lucide-react';
import { useNuvemshopConnection } from '../../hooks/useNuvemshopConnection';
import {
  getNuvemshopMetrics,
  type NuvemshopHealthStatus,
  type NuvemshopMetrics,
} from '../../services/nuvemshopApi';
import { NuvemshopDashboard } from '../Nuvemshop/NuvemshopDashboard';

// ── Componente de badge de saúde ─────────────────────────────────────────────

interface HealthBadgeProps {
  health: NuvemshopHealthStatus;
}

function HealthBadge({ health }: HealthBadgeProps) {
  const config = {
    healthy: {
      icon:  <CheckCircle2 className="w-3.5 h-3.5" />,
      label: 'Saudável',
      class: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    warning: {
      icon:  <AlertTriangle className="w-3.5 h-3.5" />,
      label: 'Atenção',
      class: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    critical: {
      icon:  <AlertCircle className="w-3.5 h-3.5" />,
      label: 'Crítico',
      class: 'bg-red-50 text-red-700 border-red-200',
    },
    disconnected: {
      icon:  <WifiOff className="w-3.5 h-3.5" />,
      label: 'Desconectado',
      class: 'bg-slate-100 text-slate-500 border-slate-200',
    },
  } as const;

  const { icon, label, class: cls } = config[health] ?? config.disconnected;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

// ── Utilitários de formatação ─────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  companyId: string;
}

export function NuvemshopConnectionPanel({ companyId }: Props) {
  const { status, loading, loadingAction, error, refetch, connect, disconnect } =
    useNuvemshopConnection(companyId);

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [actionError, setActionError]             = useState<string | null>(null);
  const [successMsg, setSuccessMsg]               = useState<string | null>(null);
  const [showDashboard, setShowDashboard]         = useState(false);
  const [metrics, setMetrics]                     = useState<NuvemshopMetrics | null>(null);
  const [metricsLoading, setMetricsLoading]       = useState(false);

  async function loadMetrics() {
    setMetricsLoading(true);
    try {
      const data = await getNuvemshopMetrics(companyId);
      setMetrics(data);
    } catch {
      // silencioso — dashboard mostra estado vazio
    } finally {
      setMetricsLoading(false);
    }
  }

  useEffect(() => {
    if (showDashboard) loadMetrics();
  }, [showDashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnect() {
    setActionError(null);
    setSuccessMsg(null);
    await connect();
  }

  async function handleDisconnect() {
    setActionError(null);
    setSuccessMsg(null);
    const result = await disconnect();
    setConfirmDisconnect(false);
    if (result.success) {
      setSuccessMsg('Integração desconectada. Dados históricos preservados.');
    } else {
      setActionError(result.error ?? 'Erro ao desconectar.');
    }
  }

  // ── Loading inicial ──────────────────────────────────────────────────────────
  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  // ── Mensagem de erro de fetch ────────────────────────────────────────────────
  if (error && !status) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-600">{error}</p>
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  const isConnected = status?.connected ?? false;
  const canConnect    = status?.actions?.can_connect    ?? false;
  const canDisconnect = status?.actions?.can_disconnect ?? false;

  return (
    <div className="space-y-6">

      {/* Mensagens de feedback */}
      {(actionError || error) && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{actionError ?? error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Estado: Não conectada ────────────────────────────────────────────────── */}
      {!isConnected && (
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <div className="p-4 bg-gradient-to-br from-purple-100 to-pink-100 rounded-2xl">
            <ShoppingBag className="w-10 h-10 text-purple-600" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-slate-900">
              Conecte sua loja Nuvemshop
            </h3>
            <p className="text-sm text-slate-500 max-w-sm">
              Sincronize clientes, pedidos, produtos e carrinhos abandonados
              diretamente com o LoovooCRM.
            </p>
          </div>

          {status?.status === 'disconnected' && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
              <WifiOff className="w-3.5 h-3.5" />
              Integração desconectada — dados históricos preservados
            </div>
          )}

          {canConnect && (
            <button
              onClick={handleConnect}
              disabled={loadingAction}
              className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loadingAction
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Plus className="w-4 h-4" />
              }
              {status?.status === 'disconnected' ? 'Reconectar Nuvemshop' : 'Conectar Nuvemshop'}
            </button>
          )}

          {!canConnect && !loading && (
            <p className="text-xs text-slate-400">
              Você não possui permissão para conectar esta integração.
            </p>
          )}
        </div>
      )}

      {/* Estado: Conectada ──────────────────────────────────────────────────── */}
      {isConnected && status && (
        <div className="space-y-5">

          {/* Cabeçalho da loja */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-sm">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {status.store_name ?? 'Loja Nuvemshop'}
                </p>
                {status.store_domain && (
                  <a
                    href={`https://${status.store_domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-purple-600 hover:underline flex items-center gap-1"
                  >
                    <Globe className="w-3 h-3" />
                    {status.store_domain}
                  </a>
                )}
              </div>
            </div>
            <HealthBadge health={status.health_status} />
          </div>

          {/* Metadados */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {status.currency && (
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  Moeda
                </div>
                <p className="text-sm font-medium text-slate-700">{status.currency}</p>
              </div>
            )}
            {status.plan_name && (
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Plano
                </div>
                <p className="text-sm font-medium text-slate-700 truncate">{status.plan_name}</p>
              </div>
            )}
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
                <Calendar className="w-3.5 h-3.5" />
                Conectada em
              </div>
              <p className="text-sm font-medium text-slate-700">{formatDate(status.connected_at)}</p>
            </div>
            {status.last_sync_at && (
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
                  <Clock className="w-3.5 h-3.5" />
                  Última sincronização
                </div>
                <p className="text-sm font-medium text-slate-700">{formatDate(status.last_sync_at)}</p>
              </div>
            )}
          </div>

          {/* Aviso de metadata_status */}
          {status.metadata_status === 'failed' && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Não foi possível recuperar os dados da loja durante a conexão.
                Considere reconectar para atualizar as informações.
              </span>
            </div>
          )}

          {/* Botões de ação */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canConnect && (
              <button
                onClick={handleConnect}
                disabled={loadingAction}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-60 rounded-lg transition-colors border border-purple-200"
              >
                {loadingAction
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />
                }
                Reconectar
              </button>
            )}

            {canDisconnect && !confirmDisconnect && (
              <button
                onClick={() => setConfirmDisconnect(true)}
                disabled={loadingAction}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-60 rounded-lg transition-colors border border-red-200"
              >
                <Unlink className="w-4 h-4" />
                Desconectar
              </button>
            )}

            {/* Confirmação de desconexão */}
            {confirmDisconnect && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span className="text-sm text-red-700 mr-1">
                  Confirma a desconexão? Webhooks e sincronizações serão interrompidos.
                  Dados históricos são preservados.
                </span>
                <button
                  onClick={handleDisconnect}
                  disabled={loadingAction}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-md transition-colors"
                >
                  {loadingAction ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Confirmar
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={loadingAction}
                  className="px-3 py-1 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 rounded-md border border-slate-200 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}

            <button
              onClick={refetch}
              disabled={loading || loadingAction}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              title="Atualizar status"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          {/* Dashboard Operacional — expansível */}
          <div className="border-t border-slate-100 pt-4">
            <button
              onClick={() => setShowDashboard(v => !v)}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              {metricsLoading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <BarChart3 className="w-3.5 h-3.5" />
              }
              {showDashboard ? 'Ocultar Dashboard Operacional' : 'Ver Dashboard Operacional'}
            </button>

            {showDashboard && metrics && (
              <div className="mt-4">
                <NuvemshopDashboard
                  companyId={companyId}
                  metrics={metrics}
                  onRefresh={() => { refetch(); loadMetrics(); }}
                />
              </div>
            )}
            {showDashboard && !metrics && !metricsLoading && (
              <p className="mt-3 text-xs text-slate-400">Não foi possível carregar o dashboard.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

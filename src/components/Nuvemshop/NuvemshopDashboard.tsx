// =============================================================================
// NuvemshopDashboard — Dashboard Operacional da Integração Nuvemshop
//
// Exibe três seções conforme o Plano v5.1:
//   1. Conexão: loja, domínio, plano, status, script, datas
//   2. Saúde: health_score, último webhook, último sucesso, último erro
//   3. Métricas: eventos por status, recursos sincronizados
//
// Recursos administrativos (via useAccessControl):
//   can_replay:           replay de evento dead
//   can_force_resync:     forçar re-sync completo
//   can_reset_checkpoint: reiniciar checkpoint por tipo
//   can_validate:         validar conexão e script
//
// NOTA: este componente é exclusivamente UX — toda validação de segurança
// ocorre no backend via RBAC + company_id + RLS.
// =============================================================================

import React, { useState, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, AlertTriangle, AlertCircle,
  WifiOff, Zap, BarChart3, Settings2,
  RotateCcw, Link2, FileCode2, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { NuvemshopCloudIcon } from '../icons/NuvemshopIcon';
import {
  getNuvemshopMetrics,
  forceNuvemshopResync,
  resetNuvemshopCheckpoint,
  validateNuvemshopConnection,
  validateNuvemshopScript,
  type NuvemshopMetrics,
  type NuvemshopHealthStatus,
} from '../../services/nuvemshopApi';
import { useAccessControl } from '../../hooks/useAccessControl';

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Badge de saúde ────────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<NuvemshopHealthStatus, { icon: React.ReactNode; label: string; cls: string }> = {
  healthy:     { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Saudável',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warning:     { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Atenção',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  critical:    { icon: <AlertCircle className="w-3.5 h-3.5" />,   label: 'Crítico',      cls: 'bg-red-50 text-red-700 border-red-200' },
  disconnected:{ icon: <WifiOff className="w-3.5 h-3.5" />,       label: 'Desconectado', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function HealthBadge({ status }: { status: NuvemshopHealthStatus }) {
  const { icon, label, cls } = HEALTH_CONFIG[status] ?? HEALTH_CONFIG.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── Linha de métrica genérica ────────────────────────────────────────────────

function MetricRow({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${highlight ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

// ── Seção colapsável ──────────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 font-medium text-slate-700 text-sm">
          {icon}{title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-4 py-3 divide-y divide-slate-100">{children}</div>}
    </div>
  );
}

// ── Botão administrativo ──────────────────────────────────────────────────────

function AdminButton({
  onClick, loading, disabled, icon, label, variant = 'default',
}: {
  onClick: () => void; loading?: boolean; disabled?: boolean;
  icon: React.ReactNode; label: string; variant?: 'default' | 'danger';
}) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50';
  const style = variant === 'danger'
    ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50';
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${style}`}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  companyId: string;
  metrics:   NuvemshopMetrics;
  onRefresh: () => void;
}

export function NuvemshopDashboard({ companyId, metrics, onRefresh }: Props) {
  const { canManageNuvemshopIntegration } = useAccessControl();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult,  setActionResult]  = useState<{ key: string; msg: string; ok: boolean } | null>(null);

  const runAction = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setActionLoading(key);
    setActionResult(null);
    try {
      const r = await fn() as { message?: string; ok?: boolean; valid?: boolean };
      const ok  = r?.ok !== false && r?.valid !== false;
      const msg = r?.message ?? (ok ? 'Operação concluída.' : 'Operação não concluída.');
      setActionResult({ key, msg, ok });
      if (ok) onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro inesperado.';
      setActionResult({ key, msg: message, ok: false });
    } finally {
      setActionLoading(null);
    }
  }, [onRefresh]);

  const { connection: conn, health, events, resources, actions, checkpoints } = metrics;

  return (
    <div className="space-y-3">

      {/* Seção Conexão */}
      <Section title="Conexão" icon={<NuvemshopCloudIcon className="w-4 h-4 text-indigo-500" />}>
        <MetricRow label="Loja"             value={conn?.store_name   ?? '—'} />
        <MetricRow label="Domínio"          value={conn?.store_domain ?? '—'} />
        <MetricRow label="Plano"            value={conn?.plan_name    ?? '—'} />
        <MetricRow label="Status"           value={conn?.status       ?? '—'} />
        <MetricRow label="Script"           value={
          conn?.script_active
            ? <span className="text-emerald-600 font-medium">Ativo</span>
            : <span className="text-amber-600">{conn?.script_status ?? 'Não instalado'}</span>
        } />
        <MetricRow label="Conectado em"     value={fmtDate(conn?.connected_at     ?? null)} />
        <MetricRow label="Última sincronização" value={fmtDate(conn?.last_sync_at ?? null)} />
      </Section>

      {/* Seção Saúde */}
      <Section title="Saúde" icon={<Zap className="w-4 h-4 text-amber-500" />}>
        <div className="py-1.5 flex items-center justify-between text-sm">
          <span className="text-slate-500">Health Score</span>
          <HealthBadge status={health.status} />
        </div>
        <MetricRow label="Último Webhook"    value={fmtDate(health.last_webhook_at)}  />
        <MetricRow label="Último Sucesso"    value={fmtDate(health.last_success_at)}  />
        <MetricRow label="Último Erro"       value={fmtDate(health.last_error_at)} highlight={!!health.last_error_at} />
        {health.last_error_message && (
          <div className="py-1.5 text-xs text-red-600 bg-red-50 rounded px-2 mt-1">
            {health.last_error_message}
          </div>
        )}
      </Section>

      {/* Seção Métricas de Eventos */}
      {events && (
        <Section title="Métricas de Eventos" icon={<BarChart3 className="w-4 h-4 text-blue-500" />}>
          <MetricRow label="Pendentes"     value={events.pending}    />
          <MetricRow label="Processados"   value={events.processed}  />
          <MetricRow label="Falhados"      value={events.failed} highlight={events.failed > 0}  />
          <MetricRow label="Dead Letter"   value={events.dead}   highlight={events.dead > 0}    />
          <MetricRow label="Replayados"    value={events.replayed}   />
          <MetricRow label="Tempo médio"   value={fmtMs(events.avg_processing_ms)} />
        </Section>
      )}

      {/* Seção Recursos Sincronizados */}
      {resources && (
        <Section title="Recursos Sincronizados" icon={<BarChart3 className="w-4 h-4 text-purple-500" />} defaultOpen={false}>
          <MetricRow label="Leads"       value={resources.leads.toLocaleString('pt-BR')}      />
          <MetricRow label="Pedidos"     value={resources.orders.toLocaleString('pt-BR')}     />
          <MetricRow label="Produtos"    value={resources.products.toLocaleString('pt-BR')}   />
          <MetricRow label="Categorias"  value={resources.categories.toLocaleString('pt-BR')} />
          <MetricRow label="Checkouts"   value={resources.checkouts.toLocaleString('pt-BR')}  />
        </Section>
      )}

      {/* Checkpoints */}
      {checkpoints.length > 0 && (
        <Section title="Checkpoints de Reconciliação" icon={<Settings2 className="w-4 h-4 text-slate-400" />} defaultOpen={false}>
          {checkpoints.map(cp => (
            <div key={cp.sync_type} className="py-1.5 flex items-center justify-between text-sm">
              <span className="text-slate-500 capitalize">{cp.sync_type}</span>
              <div className="text-right">
                <span className={`text-xs font-medium ${cp.status === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                  {cp.status}
                </span>
                <span className="text-slate-400 text-xs ml-2">
                  {cp.total_processed?.toLocaleString('pt-BR') ?? 0} itens
                </span>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Recursos Administrativos */}
      {canManageNuvemshopIntegration && (actions.can_validate || actions.can_replay || actions.can_force_resync) && (
        <Section title="Ações Administrativas" icon={<Settings2 className="w-4 h-4 text-slate-500" />} defaultOpen={false}>
          <div className="py-2 flex flex-wrap gap-2">
            {actions.can_validate && (
              <>
                <AdminButton
                  icon={<Link2 className="w-3.5 h-3.5" />}
                  label="Validar Conexão"
                  loading={actionLoading === 'validate_conn'}
                  onClick={() => runAction('validate_conn', () => validateNuvemshopConnection(companyId))}
                />
                <AdminButton
                  icon={<FileCode2 className="w-3.5 h-3.5" />}
                  label="Validar Script"
                  loading={actionLoading === 'validate_script'}
                  onClick={() => runAction('validate_script', () => validateNuvemshopScript(companyId))}
                />
              </>
            )}
            {actions.can_reset_checkpoint && (
              <AdminButton
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                label="Reiniciar Categorias"
                loading={actionLoading === 'reset_cat'}
                onClick={() => runAction('reset_cat', () => resetNuvemshopCheckpoint(companyId, 'categories'))}
              />
            )}
            {actions.can_force_resync && (
              <AdminButton
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                label="Forçar Re-sync"
                variant="danger"
                loading={actionLoading === 'force_resync'}
                onClick={() => runAction('force_resync', () => forceNuvemshopResync(companyId))}
              />
            )}
          </div>
          {actionResult && (
            <div className={`mt-2 text-xs rounded px-3 py-2 ${actionResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {actionResult.msg}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

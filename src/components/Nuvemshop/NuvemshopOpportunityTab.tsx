// =============================================================================
// NuvemshopOpportunityTab — Aba Nuvemshop no modal de Oportunidade
//
// Exibe os dados de integração Nuvemshop de uma Oportunidade:
//   - Pedido, Status, Pagamento, Fulfillment, Rastreamento
//   - Timeline de eventos da integração (idempotente)
//
// ── Visibilidade ──────────────────────────────────────────────────────────────
// Este componente só é renderizado quando:
//   1. A oportunidade possui nuvemshop_order_id (verificado pelo pai)
//   2. O usuário possui permissão (canManageNuvemshopIntegration)
//
// ── Integração desconectada ────────────────────────────────────────────────
// Se integration_status = 'disconnected', exibe aviso de modo somente leitura.
//
// ── Dados NUNCA exibidos ───────────────────────────────────────────────────
//   - Número completo do cartão, CVV, tokens, credenciais
//   - nuvemshop_payment_data raw — apenas campos extraídos pelo backend
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, Store, Hash, CreditCard, Truck, Package,
  RefreshCw, AlertTriangle, Loader2, CheckCircle2, Clock,
  ExternalLink,
} from 'lucide-react';
import {
  getNuvemshopOpportunityTab,
  type NuvemshopOpportunityTabData,
  type NuvemshopTimelineEvent,
} from '../../services/nuvemshopApi';

// ── Helpers de formatação ──────────────────────────────────────────────────

function formatCurrency(value: number | null, currency = 'BRL'): string {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusLabel(rawStatus: string | null): { label: string; cls: string } {
  switch (rawStatus) {
    case 'open':         return { label: 'Aberto',      cls: 'bg-blue-100 text-blue-800' };
    case 'closed':       return { label: 'Fechado',     cls: 'bg-slate-100 text-slate-700' };
    case 'cancelled':    return { label: 'Cancelado',   cls: 'bg-red-100 text-red-800' };
    case 'paid':         return { label: 'Pago',        cls: 'bg-green-100 text-green-800' };
    case 'pending':      return { label: 'Pendente',    cls: 'bg-yellow-100 text-yellow-800' };
    case 'refunded':     return { label: 'Estornado',   cls: 'bg-orange-100 text-orange-800' };
    case 'authorized':   return { label: 'Autorizado',  cls: 'bg-teal-100 text-teal-800' };
    case 'voided':       return { label: 'Anulado',     cls: 'bg-slate-100 text-slate-600' };
    case 'packed':       return { label: 'Embalado',    cls: 'bg-indigo-100 text-indigo-800' };
    case 'fulfilled':    return { label: 'Enviado',     cls: 'bg-green-100 text-green-800' };
    case 'unshipped':    return { label: 'Não enviado', cls: 'bg-slate-100 text-slate-600' };
    case 'shipped':      return { label: 'Despachado',  cls: 'bg-blue-100 text-blue-800' };
    default:
      return { label: rawStatus ?? 'N/A', cls: 'bg-slate-100 text-slate-600' };
  }
}

function syncStatusBadge(status: string | null) {
  switch (status) {
    case 'synced':  return { label: 'Sincronizado', cls: 'bg-green-100 text-green-800' };
    case 'pending': return { label: 'Pendente',     cls: 'bg-yellow-100 text-yellow-800' };
    case 'failed':  return { label: 'Falha',        cls: 'bg-red-100 text-red-800' };
    default:        return { label: status ?? '—',  cls: 'bg-slate-100 text-slate-600' };
  }
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value, mono = false,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="mt-0.5 text-slate-400 shrink-0">{icon}</span>
      <span className="text-sm text-slate-500 w-40 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-900 break-all ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-slate-400 font-normal">—</span>}
      </span>
    </div>
  );
}

function SectionCard({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 flex items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <span className="text-sm font-semibold text-slate-700">{title}</span>
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

function TimelineIcon({ eventType }: { eventType: string }) {
  if (eventType.includes('fulfilled') || eventType.includes('shipped')) {
    return <Truck className="w-4 h-4 text-green-600" />;
  }
  if (eventType.includes('packed')) {
    return <Package className="w-4 h-4 text-indigo-500" />;
  }
  return <CheckCircle2 className="w-4 h-4 text-slate-400" />;
}

function TimelineSection({ events }: { events: NuvemshopTimelineEvent[] }) {
  if (!events.length) {
    return (
      <p className="text-sm text-slate-400 py-4 text-center italic">
        Nenhum evento de integração registrado.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((evt, idx) => (
        <div key={evt.id} className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
          <div className="flex flex-col items-center">
            <TimelineIcon eventType={evt.event_type} />
            {idx < events.length - 1 && (
              <div className="w-px flex-1 bg-slate-200 mt-1" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900">{evt.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatDate(evt.occurred_at)}</p>
            {evt.tracking_number && (
              <p className="text-xs text-slate-600 mt-1">
                Rastreio: <span className="font-mono">{evt.tracking_number}</span>
                {evt.carrier && ` · ${evt.carrier}`}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────

interface NuvemshopOpportunityTabProps {
  opportunityId: string;
  companyId:     string;
}

export function NuvemshopOpportunityTab({ opportunityId, companyId }: NuvemshopOpportunityTabProps) {
  const [data,    setData]    = useState<NuvemshopOpportunityTabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNuvemshopOpportunityTab(opportunityId, companyId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados Nuvemshop.');
    } finally {
      setLoading(false);
    }
  }, [opportunityId, companyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Estados de carregamento e erro ────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Carregando dados Nuvemshop…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">Erro ao carregar</p>
          <p className="text-sm text-red-700 mt-0.5">{error}</p>
          <button
            type="button"
            onClick={fetchData}
            className="mt-2 text-sm text-red-700 underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!data || !data.has_nuvemshop) {
    return (
      <div className="text-center py-10 text-slate-400">
        <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Esta oportunidade não possui vínculo com a Nuvemshop.</p>
      </div>
    );
  }

  const orderStatus       = statusLabel(data.nuvemshop_raw_status);
  const fulfillmentStatus = statusLabel(data.nuvemshop_fulfillment_status);
  const sync              = syncStatusBadge(data.nuvemshop_sync_status);
  const currency          = 'BRL';  // nuvemshop_payment_data.currency se disponível

  return (
    <div className="space-y-4">
      {/* Aviso de integração desconectada */}
      {data.integration_status === 'disconnected' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Integração desconectada — exibindo dados históricos.
          </p>
        </div>
      )}

      {/* Seção: Pedido */}
      <SectionCard icon={<ShoppingBag className="w-4 h-4" />} title="Pedido">
        <InfoRow
          icon={<Store className="w-4 h-4" />}
          label="Loja"
          value={data.store_name ?? data.nuvemshop_store_id ?? '—'}
        />
        <InfoRow
          icon={<Hash className="w-4 h-4" />}
          label="ID do pedido"
          value={data.nuvemshop_order_id}
          mono
        />
        <InfoRow
          icon={<RefreshCw className="w-4 h-4" />}
          label="Status"
          value={
            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${orderStatus.cls}`}>
              {orderStatus.label}
            </span>
          }
        />
        <InfoRow
          icon={<Clock className="w-4 h-4" />}
          label="Status sync"
          value={
            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${sync.cls}`}>
              {sync.label}
            </span>
          }
        />
      </SectionCard>

      {/* Seção: Pagamento */}
      <SectionCard icon={<CreditCard className="w-4 h-4" />} title="Pagamento">
        <InfoRow
          icon={<CreditCard className="w-4 h-4" />}
          label="Status pagamento"
          value={(() => {
            const ps = statusLabel(data.payment_status ?? null);
            return data.payment_status ? (
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${ps.cls}`}>
                {ps.label}
              </span>
            ) : null;
          })()}
        />
        <InfoRow
          icon={<CreditCard className="w-4 h-4" />}
          label="Método"
          value={data.payment_method}
        />
        <InfoRow
          icon={<CreditCard className="w-4 h-4" />}
          label="Parcelas"
          value={data.installments != null ? `${data.installments}x` : null}
        />
        <InfoRow
          icon={<CreditCard className="w-4 h-4" />}
          label="Bandeira"
          value={data.brand}
        />
        <InfoRow
          icon={<CreditCard className="w-4 h-4" />}
          label="Valor capturado"
          value={data.captured_amount != null ? formatCurrency(data.captured_amount, currency) : null}
        />
        {/* Nenhum dado sensível (cartão completo, CVV, tokens) é exibido aqui */}
      </SectionCard>

      {/* Seção: Fulfillment */}
      <SectionCard icon={<Truck className="w-4 h-4" />} title="Envio e Rastreamento">
        <InfoRow
          icon={<Truck className="w-4 h-4" />}
          label="Status envio"
          value={
            data.nuvemshop_fulfillment_status ? (
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${fulfillmentStatus.cls}`}>
                {fulfillmentStatus.label}
              </span>
            ) : null
          }
        />
        <InfoRow
          icon={<Package className="w-4 h-4" />}
          label="Transportadora"
          value={data.nuvemshop_shipping_carrier}
        />
        <InfoRow
          icon={<Hash className="w-4 h-4" />}
          label="Código de rastreio"
          value={data.nuvemshop_tracking_number}
          mono
        />
        {data.nuvemshop_tracking_url && (
          <InfoRow
            icon={<ExternalLink className="w-4 h-4" />}
            label="Rastreamento"
            value={
              <a
                href={data.nuvemshop_tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
              >
                <ExternalLink className="w-3 h-3" />
                Rastrear envio
              </a>
            }
          />
        )}
      </SectionCard>

      {/* Seção: Timeline de integração */}
      <SectionCard icon={<Clock className="w-4 h-4" />} title="Timeline da integração">
        <TimelineSection events={data.timeline} />
      </SectionCard>
    </div>
  );
}

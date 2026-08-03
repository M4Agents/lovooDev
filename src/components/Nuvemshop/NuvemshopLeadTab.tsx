// =============================================================================
// NuvemshopLeadTab — Aba Nuvemshop no modal de Lead
//
// Exibe os dados de integração Nuvemshop de um Lead:
//   - Cliente Nuvemshop, Loja, Checkout ID, Valor do carrinho, Itens
//   - Status de sincronização e última atualização
//
// ── Visibilidade ──────────────────────────────────────────────────────────────
// Este componente só é renderizado quando:
//   1. A empresa possui integração Nuvemshop (verificado pelo pai)
//   2. O usuário possui permissão (canManageNuvemshopIntegration)
//   3. O lead possui vínculo com a Nuvemshop (verificado ao buscar dados)
//
// ── Integração desconectada ────────────────────────────────────────────────
// Se integration_status = 'disconnected', exibe aviso de modo somente leitura.
//
// ── checkout_url ──────────────────────────────────────────────────────────────
// NUNCA carregado automaticamente.
// Apenas quando o usuário clica em "Ver link" → carrega via endpoint restrito.
// Apenas roles com permissão de gestão podem usar este botão.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, Store, Hash, RefreshCw, AlertTriangle,
  ExternalLink, Loader2, Package, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  getNuvemshopLeadTab,
  getNuvemshopCheckoutUrl,
  type NuvemshopLeadTabData,
  type NuvemshopCartItem,
} from '../../services/nuvemshopApi';
import { useAccessControl } from '../../hooks/useAccessControl';
// canViewNuvemshopSensitiveData: apenas roles que podem ver checkout_url (admin/manager+)
// Espelha SENSITIVE_DATA_ROLES do backend validateNuvemshopCaller.js

// ── Helpers de formatação ──────────────────────────────────────────────────

function formatCurrency(value: number | null, currency: string | null): string {
  if (value == null) return '—';
  const code = currency ?? 'BRL';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
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

function syncStatusLabel(status: string | null): { label: string; cls: string } {
  switch (status) {
    case 'synced':    return { label: 'Sincronizado',   cls: 'bg-green-100 text-green-800' };
    case 'pending':   return { label: 'Pendente',       cls: 'bg-yellow-100 text-yellow-800' };
    case 'failed':    return { label: 'Falha',          cls: 'bg-red-100 text-red-800' };
    case 'deleted':   return { label: 'Removido',       cls: 'bg-slate-100 text-slate-600' };
    default:          return { label: status ?? 'N/A',  cls: 'bg-slate-100 text-slate-600' };
  }
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value, mono = false,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="mt-0.5 text-slate-400 shrink-0">{icon}</span>
      <span className="text-sm text-slate-500 w-36 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-900 break-all ${mono ? 'font-mono' : ''}`}>
        {value ?? <span className="text-slate-400 font-normal">—</span>}
      </span>
    </div>
  );
}

function CartItemsSection({ items, currency }: { items: NuvemshopCartItem[]; currency?: string | null }) {
  const [open, setOpen] = useState(false);

  if (!items.length) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
      >
        <Package className="w-4 h-4 text-slate-400" />
        {items.length} {items.length === 1 ? 'item no carrinho' : 'itens no carrinho'}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 text-slate-500 font-medium">Produto</th>
                <th className="text-center px-3 py-2 text-slate-500 font-medium">Qtd</th>
                <th className="text-right px-3 py-2 text-slate-500 font-medium">Preço</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900">{item.name ?? '—'}</p>
                    {item.sku && <p className="text-xs text-slate-400">SKU: {item.sku}</p>}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-700">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {formatCurrency(item.price, item.currency ?? currency ?? null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────

interface NuvemshopLeadTabProps {
  leadId:    string;
  companyId: string;
}

export function NuvemshopLeadTab({ leadId, companyId }: NuvemshopLeadTabProps) {
  const { canViewNuvemshopSensitiveData } = useAccessControl();

  const [data,         setData]         = useState<NuvemshopLeadTabData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [checkoutUrl,  setCheckoutUrl]  = useState<string | null>(null);
  const [loadingUrl,   setLoadingUrl]   = useState(false);
  const [urlError,     setUrlError]     = useState<string | null>(null);
  const [urlRevealed,  setUrlRevealed]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNuvemshopLeadTab(leadId, companyId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados Nuvemshop.');
    } finally {
      setLoading(false);
    }
  }, [leadId, companyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRevealUrl = async () => {
    if (urlRevealed || loadingUrl) return;
    setLoadingUrl(true);
    setUrlError(null);
    try {
      const result = await getNuvemshopCheckoutUrl(leadId, companyId);
      setCheckoutUrl(result.checkout_url);
      setUrlRevealed(true);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Sem permissão para acessar este link.');
    } finally {
      setLoadingUrl(false);
    }
  };

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
        <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Este lead não possui vínculo com a Nuvemshop.</p>
      </div>
    );
  }

  const syncStatus = syncStatusLabel(data.nuvemshop_sync_status);
  const currency   = data.cart_items?.[0]?.currency ?? null;

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

      {/* Dados do cliente Nuvemshop */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">Dados Nuvemshop</span>
          </div>
          {data.integration_status === 'active' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Ativo
            </span>
          )}
        </div>

        <div className="px-4">
          <InfoRow
            icon={<Store className="w-4 h-4" />}
            label="Loja"
            value={data.store_name ?? data.nuvemshop_store_id ?? '—'}
          />
          <InfoRow
            icon={<Hash className="w-4 h-4" />}
            label="Cliente NS"
            value={data.nuvemshop_customer_id}
            mono
          />
          {data.nuvemshop_checkout_id && (
            <InfoRow
              icon={<Hash className="w-4 h-4" />}
              label="Checkout ID"
              value={data.nuvemshop_checkout_id}
              mono
            />
          )}
          <InfoRow
            icon={<ShoppingCart className="w-4 h-4" />}
            label="Valor do carrinho"
            value={data.cart_total != null ? formatCurrency(data.cart_total, currency) : null}
          />
          <InfoRow
            icon={<RefreshCw className="w-4 h-4" />}
            label="Status sync"
            value={
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${syncStatus.cls}`}>
                {syncStatus.label}
              </span>
            }
          />
          <InfoRow
            icon={<RefreshCw className="w-4 h-4" />}
            label="Última sync"
            value={formatDate(data.synced_at)}
          />
        </div>
      </div>

      {/* Itens do carrinho */}
      {data.cart_items.length > 0 && (
        <CartItemsSection items={data.cart_items} currency={currency} />
      )}

      {/* Checkout URL — carregado apenas sob demanda */}
      {/* checkout_url: visível apenas para roles com acesso a dados sensíveis (admin/manager+) */}
      {data.nuvemshop_checkout_id && canViewNuvemshopSensitiveData && (
        <div className="border border-slate-200 rounded-xl px-4 py-3">
          <p className="text-sm text-slate-500 mb-2">Link do carrinho abandonado</p>

          {!urlRevealed ? (
            <button
              type="button"
              onClick={handleRevealUrl}
              disabled={loadingUrl}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-60"
            >
              {loadingUrl
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ExternalLink className="w-3.5 h-3.5" />
              }
              {loadingUrl ? 'Carregando…' : 'Ver link'}
            </button>
          ) : checkoutUrl ? (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 break-all"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              Abrir carrinho na loja
            </a>
          ) : (
            <p className="text-sm text-slate-400 italic">Link indisponível.</p>
          )}

          {urlError && (
            <p className="mt-1 text-xs text-red-600">{urlError}</p>
          )}
        </div>
      )}
    </div>
  );
}

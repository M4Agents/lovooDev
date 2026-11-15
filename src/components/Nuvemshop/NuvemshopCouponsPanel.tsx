// =============================================================================
// NuvemshopCouponsPanel — Painel de cupons de desconto da Nuvemshop
//
// Permite listar e criar cupons na loja Nuvemshop diretamente do CRM.
// Visível apenas quando a loja está conectada (isConnected).
// RBAC: apenas admin/manager podem criar; qualquer membro pode listar.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Tag, Plus, Loader2, AlertCircle, RefreshCw, CheckCircle2, Hash, X,
} from 'lucide-react';
import {
  listNuvemshopCoupons,
  createNuvemshopCoupon,
  type NuvemshopCoupon,
  type CreateCouponPayload,
} from '../../services/nuvemshopApi';
import { useAccessControl } from '../../hooks/useAccessControl';
import { couponTypeLabel, NuvemshopCouponCreateModal } from './NuvemshopCouponCreateModal';

function formatCouponValue(coupon: NuvemshopCoupon): string {
  if (coupon.type === 'percentage') return `${coupon.value}%`;
  if (coupon.type === 'absolute')   return `R$ ${coupon.value.toFixed(2)}`;
  return 'Frete grátis';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ── Componente principal ───────────────────────────────────────────────────────

interface Props {
  companyId: string;
  storeId:   string;
}

export function NuvemshopCouponsPanel({ companyId, storeId }: Props) {
  const { canManageNuvemshopIntegration } = useAccessControl();

  const [coupons,     setCoupons]     = useState<NuvemshopCoupon[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMsg,  setSuccessMsg]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listNuvemshopCoupons(companyId, storeId);
      setCoupons(data.coupons ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar cupons.');
    } finally {
      setLoading(false);
    }
  }, [companyId, storeId]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(payload: CreateCouponPayload) {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createNuvemshopCoupon(companyId, storeId, payload);
      setCoupons(prev => [created, ...prev]);
      setShowModal(false);
      setSuccessMsg(`Cupom "${created.code}" criado com sucesso!`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro ao criar cupom.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-slate-700">Cupons de desconto</span>
          {coupons.length > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 font-medium px-1.5 py-0.5 rounded-full">
              {coupons.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManageNuvemshopIntegration && (
            <button
              onClick={() => { setShowModal(true); setCreateError(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo cupom
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {successMsg && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !coupons.length && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      )}

      {/* Lista de cupons */}
      {!loading && coupons.length === 0 && !error && (
        <div className="text-center py-6 text-slate-400">
          <Tag className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhum cupom criado ainda.</p>
        </div>
      )}

      {coupons.length > 0 && (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {coupons.map(c => {
            const { label, icon } = couponTypeLabel(c.type);
            return (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {c.code}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      c.valid
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {c.valid ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {c.valid ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      {icon} {label} · <strong className="text-slate-700">{formatCouponValue(c)}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {c.used_times}{c.max_uses ? `/${c.max_uses}` : ''} uso{c.used_times !== 1 ? 's' : ''}
                    </span>
                    {c.min_price && (
                      <span>Mín: R$ {c.min_price.toFixed(2)}</span>
                    )}
                    {(c.start_date || c.end_date) && (
                      <span>
                        {c.start_date ? formatDate(c.start_date) : '—'}
                        {' → '}
                        {c.end_date ? formatDate(c.end_date) : 'sem fim'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de criação */}
      {showModal && (
        <NuvemshopCouponCreateModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
          creating={creating}
          error={createError}
        />
      )}
    </div>
  );
}

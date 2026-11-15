import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listNuvemshopCoupons,
  listPromoLinks,
  savePromoLink,
  copyPromoLink,
  createNuvemshopCoupon,
  type CouponType,
  type NuvemshopCoupon,
  type PromoLink,
  type CreateCouponPayload,
} from '../../services/nuvemshopApi';
import { couponTypeLabel, NuvemshopCouponCreateModal } from './NuvemshopCouponCreateModal';

const WRITE_ROLES = ['super_admin', 'system_admin', 'admin', 'manager'];

interface Props {
  companyId: string;
  storeId: string;
}

export function NuvemshopPromoLinksPanel({ companyId, storeId }: Props) {
  const { currentRole, isImpersonating } = useAuth();
  const canWrite = isImpersonating || WRITE_ROLES.includes(currentRole ?? '');
  const [benefit, setBenefit] = useState<'discount' | 'shipping'>('discount');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('/live');
  const [couponCode, setCouponCode] = useState('');
  const [coupons, setCoupons] = useState<NuvemshopCoupon[]>([]);
  const [links, setLinks] = useState<PromoLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [host, setHost] = useState('');
  const [pendingCopy, setPendingCopy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [couponPage, stored] = await Promise.all([
        listNuvemshopCoupons(companyId, storeId),
        listPromoLinks(companyId, storeId),
      ]);
      setCoupons(couponPage.coupons ?? []);
      setLinks(stored);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar os links.');
    } finally {
      setLoading(false);
    }
  }, [companyId, storeId]);

  useEffect(() => { load(); }, [load]);

  const visibleCoupons = coupons.filter((coupon) => (
    benefit === 'shipping' ? coupon.type === 'shipping' : coupon.type === 'percentage' || coupon.type === 'absolute'
  ));

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const link = await savePromoLink(companyId, storeId, {
        name,
        benefit,
        coupon_code: couponCode,
        destination,
        host: host || undefined,
      });
      setLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setSaved(true);
      setName('');
    } catch (err) {
      const failure = err as Error & { hosts?: string[] };
      setError(failure.message);
      if (failure.hosts?.length) {
        setHosts(failure.hosts);
        setHost(failure.hosts[0]);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(id: string, chosenHost?: string) {
    setError(null);
    setCopied(null);
    try {
      const result = await copyPromoLink(companyId, storeId, id, chosenHost);
      await navigator.clipboard.writeText(result.url);
      setCopied(id);
      setHosts(null);
      setPendingCopy(null);
    } catch (err) {
      const failure = err as Error & { code?: string; hosts?: string[] };
      if (failure.code === 'public_domain_choice' && failure.hosts?.length) {
        setError(failure.message);
        setHosts(failure.hosts);
        setHost(failure.hosts[0]);
        setPendingCopy(id);
        return;
      }
      setError(failure.message);
    }
  }

  async function handleCreate(payload: CreateCouponPayload) {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createNuvemshopCoupon(companyId, storeId, payload);
      setCoupons((current) => [created, ...current]);
      setCouponCode(created.code);
      if (created.type === 'shipping') setBenefit('shipping');
      else setBenefit('discount');
      setShowCreate(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro ao criar cupom.');
    } finally {
      setCreating(false);
    }
  }

  const allowedTypes: CouponType[] = benefit === 'shipping'
    ? ['shipping']
    : ['percentage', 'absolute'];

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500">
        Este link pode ser compartilhado. Ele não identifica individualmente quem participa da live.
        Copiar um link salvo não confirma se o cupom ainda está vigente.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando
        </div>
      )}

      {!loading && canWrite && (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-700">
            Nome da campanha
            <input
              aria-label="Nome da campanha"
              value={name}
              onChange={(event) => { setName(event.target.value); setSaved(false); }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
            />
          </label>

          <div className="flex gap-2">
            {(['discount', 'shipping'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => { setBenefit(item); setCouponCode(''); }}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  benefit === item ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                {item === 'discount' ? 'Desconto percentual ou valor fixo' : 'Frete grátis'}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium text-slate-700">
            Cupom
            <select
              aria-label="Cupom"
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
            >
              <option value="">Selecione</option>
              {visibleCoupons.map((coupon) => (
                <option key={coupon.id} value={coupon.code}>
                  {coupon.code} · {couponTypeLabel(coupon.type).label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => { setShowCreate(true); setCreateError(null); }}
            className="text-xs font-medium text-purple-700"
          >
            Criar cupom
          </button>

          <label className="block text-xs font-medium text-slate-700">
            Destino na loja
            <input
              aria-label="Destino na loja"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="/live"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
            />
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim() || !couponCode || !destination.trim()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar campanha'}
          </button>
        </div>
      )}

      {!canWrite && (
        <p className="text-xs text-slate-500">Somente administradores e gerentes podem salvar uma campanha.</p>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Campanha salva.
        </div>
      )}

      {hosts && pendingCopy && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Domínio público
            <select
              aria-label="Domínio público"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {hosts.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => handleCopy(pendingCopy, host)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
          >
            Copiar com este domínio
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {links.map((link) => (
          <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{link.name}</p>
              <p className="truncate text-xs text-slate-500">
                {link.coupon_code} · {couponTypeLabel(link.coupon_type).label} · {link.destination_path}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(link.id)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
            >
              <Copy className="h-3 w-3" />
              {copied === link.id ? 'Copiado' : 'Copiar link'}
            </button>
          </li>
        ))}
        {!loading && links.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-slate-400">Nenhuma campanha salva.</li>
        )}
      </ul>

      {showCreate && (
        <NuvemshopCouponCreateModal
          initialType={benefit === 'shipping' ? 'shipping' : 'percentage'}
          allowedTypes={allowedTypes}
          creating={creating}
          error={createError}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

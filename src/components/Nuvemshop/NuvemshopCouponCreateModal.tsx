import { useState } from 'react';
import {
  Tag, Plus, Loader2, AlertCircle, X,
  PercentIcon, DollarSign, Truck,
} from 'lucide-react';
import {
  type CouponType,
  type CreateCouponPayload,
} from '../../services/nuvemshopApi';

export function couponTypeLabel(type: CouponType): { label: string; icon: React.ReactNode } {
  switch (type) {
    case 'percentage': return { label: 'Percentual', icon: <PercentIcon className="w-3 h-3" /> };
    case 'absolute':   return { label: 'Valor fixo', icon: <DollarSign className="w-3 h-3" /> };
    case 'shipping':   return { label: 'Frete grátis', icon: <Truck className="w-3 h-3" /> };
  }
}

const EMPTY_FORM: CreateCouponPayload = {
  code: '',
  type: 'percentage',
  value: 10,
  max_uses: null,
  min_price: null,
  start_date: null,
  end_date: null,
  includes_shipping: false,
  valid: true,
};

interface CreateModalProps {
  onClose: () => void;
  onCreate: (payload: CreateCouponPayload) => Promise<void>;
  creating: boolean;
  error: string | null;
  initialType?: CouponType;
  allowedTypes?: CouponType[];
}

export function NuvemshopCouponCreateModal({
  onClose,
  onCreate,
  creating,
  error,
  initialType = 'percentage',
  allowedTypes = ['percentage', 'absolute', 'shipping'],
}: CreateModalProps) {
  const [form, setForm] = useState<CreateCouponPayload>({ ...EMPTY_FORM, type: initialType });

  function set<K extends keyof CreateCouponPayload>(key: K, value: CreateCouponPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const payload: CreateCouponPayload = { ...form };
    if (form.type === 'shipping') {
      delete payload.value;
      delete payload.includes_shipping;
    }
    await onCreate(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-600" />
            Criar cupom de desconto
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Código do cupom <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.code}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
              placeholder="ex: DESCONTO10"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono uppercase"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de desconto</label>
            <div className="flex gap-2">
              {allowedTypes.map((type) => {
                const { label, icon } = couponTypeLabel(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => set('type', type)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      form.type === type
                        ? 'bg-purple-50 border-purple-300 text-purple-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {icon}{label}
                  </button>
                );
              })}
            </div>
          </div>

          {form.type !== 'shipping' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Valor {form.type === 'percentage' ? '(%)' : '(R$)'} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                min={form.type === 'percentage' ? 1 : 0.01}
                max={form.type === 'percentage' ? 100 : undefined}
                step={form.type === 'percentage' ? 1 : 0.01}
                value={form.value ?? ''}
                onChange={(event) => set('value', Number(event.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Limite de usos <span className="text-slate-400">(vazio = ilimitado)</span>
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={form.max_uses ?? ''}
              onChange={(event) => set('max_uses', event.target.value ? Number(event.target.value) : null)}
              placeholder="Ilimitado"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Pedido mínimo (R$) <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.min_price ?? ''}
              onChange={(event) => set('min_price', event.target.value ? Number(event.target.value) : null)}
              placeholder="Sem mínimo"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data início</label>
              <input
                type="date"
                value={form.start_date ?? ''}
                onChange={(event) => set('start_date', event.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data fim</label>
              <input
                type="date"
                value={form.end_date ?? ''}
                onChange={(event) => set('end_date', event.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creating || !form.code}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 rounded-lg transition-colors"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar cupom
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

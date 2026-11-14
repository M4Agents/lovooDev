import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getWelcomePopup,
  saveWelcomePopup,
  type WelcomePopupCampaign,
  type WelcomePopupDraft,
} from '../../services/nuvemshopWelcomePopupApi';
import { WelcomePopupPreview, type WelcomePopupPreviewContent } from './WelcomePopupPreview';

const WRITE_ROLES = ['super_admin', 'system_admin', 'admin', 'manager'];

type DraftForm = {
  title: string;
  description: string;
  image_url: string;
  button_label: string;
  background_color: string;
  text_color: string;
  button_color: string;
  consent_text: string;
  consent_version: string;
  coupon_code: string;
  delay_seconds: string;
  resurface_days: string;
};

const FIELDS: { key: keyof DraftForm; label: string; placeholder: string }[] = [
  { key: 'title', label: 'Título', placeholder: 'Bem-vindo' },
  { key: 'description', label: 'Descrição', placeholder: 'Texto curto, pode ficar vazio' },
  { key: 'image_url', label: 'Imagem (URL https, opcional)', placeholder: 'https://' },
  { key: 'button_label', label: 'Texto do botão', placeholder: 'Quero participar' },
  { key: 'background_color', label: 'Cor de fundo', placeholder: '#ffffff' },
  { key: 'text_color', label: 'Cor do texto', placeholder: '#0f172a' },
  { key: 'button_color', label: 'Cor do botão', placeholder: '#6d28d9' },
  { key: 'consent_text', label: 'Texto do consentimento', placeholder: 'Autorizo o uso dos meus dados para receber o cupom.' },
  { key: 'consent_version', label: 'Versão do consentimento', placeholder: '2026-11' },
  { key: 'coupon_code', label: 'Código do cupom já existente', placeholder: 'CUPOM10' },
  { key: 'delay_seconds', label: 'Atraso em segundos', placeholder: '10' },
  { key: 'resurface_days', label: 'Dias para reaparecer', placeholder: '7' },
];

function emptyForm(): DraftForm {
  return {
    title: '',
    description: '',
    image_url: '',
    button_label: '',
    background_color: '',
    text_color: '',
    button_color: '',
    consent_text: '',
    consent_version: '',
    coupon_code: '',
    delay_seconds: '',
    resurface_days: '',
  };
}

function campaignToForm(campaign: WelcomePopupCampaign): DraftForm {
  return {
    title: campaign.title ?? '',
    description: campaign.description ?? '',
    image_url: campaign.image_url ?? '',
    button_label: campaign.button_label ?? '',
    background_color: campaign.background_color ?? '',
    text_color: campaign.text_color ?? '',
    button_color: campaign.button_color ?? '',
    consent_text: campaign.consent_text ?? '',
    consent_version: campaign.consent_version ?? '',
    coupon_code: campaign.coupon_code ?? '',
    delay_seconds: campaign.delay_seconds == null ? '' : String(campaign.delay_seconds),
    resurface_days: campaign.resurface_days == null ? '' : String(campaign.resurface_days),
  };
}

function isVisibleField(value: string | null): value is keyof DraftForm {
  return FIELDS.some((item) => item.key === value);
}

function toPreview(form: DraftForm): WelcomePopupPreviewContent {
  return {
    title: form.title,
    description: form.description,
    imageUrl: form.image_url,
    buttonLabel: form.button_label,
    consentText: form.consent_text,
    backgroundColor: form.background_color,
    textColor: form.text_color,
    buttonColor: form.button_color,
  };
}

interface Props {
  companyId: string;
  storeId: string;
}

export function NuvemshopWelcomePopupPanel({ companyId, storeId }: Props) {
  const { currentRole, isImpersonating } = useAuth();
  const canWrite = isImpersonating || WRITE_ROLES.includes(currentRole ?? '');
  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setField(null);
    setSaved(false);
    getWelcomePopup(companyId, storeId)
      .then((campaign) => {
        if (cancelled) return;
        setForm(campaignToForm(campaign));
        setHasStoredDraft(campaign.id != null);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar o rascunho.');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [companyId, storeId, reloadKey]);

  async function handleSave() {
    if (phase !== 'ready') return;
    setSaving(true);
    setError(null);
    setField(null);
    setSaved(false);
    const payload: WelcomePopupDraft = { ...form, enabled: false };
    try {
      const campaign = await saveWelcomePopup(companyId, storeId, payload);
      setForm(campaignToForm(campaign));
      setHasStoredDraft(campaign.id != null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar o rascunho.');
      if (err && typeof err === 'object' && 'field' in err) {
        const value = (err as { field?: unknown }).field;
        setField(typeof value === 'string' ? value : null);
      }
    } finally {
      setSaving(false);
    }
  }

  const preview = toPreview(form);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
        Em configuração — ainda não publicado
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        O visitante ainda não vê este formulário. O rascunho pode ser salvo incompleto.
        O que estiver preenchido é validado. A ativação fica bloqueada até o formulário público existir.
      </p>

      {phase === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando rascunho
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((item) => (
              <label key={item.key} className="block min-w-0 text-xs font-medium text-slate-700">
                {item.label}
                <input
                  aria-label={item.label}
                  value={form[item.key]}
                  disabled={!canWrite || saving}
                  placeholder={item.placeholder}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({ ...current, [item.key]: value }));
                    setSaved(false);
                  }}
                  className="mt-1 w-full max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 disabled:bg-slate-50"
                />
                {field === item.key && error && (
                  <span className="mt-1 block font-normal text-red-600">{error}</span>
                )}
              </label>
            ))}
          </div>
          {!hasStoredDraft && (
            <p className="text-xs text-slate-500">Nenhum rascunho salvo para esta loja.</p>
          )}
          <p className="text-xs text-slate-500">Página: somente a inicial. Nome, e-mail e WhatsApp serão obrigatórios no formulário futuro.</p>

          {!canWrite && (
            <p className="text-xs text-slate-500">Somente administradores e gerentes podem salvar esta configuração.</p>
          )}

          {error && !isVisibleField(field) && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Rascunho salvo. O pop-up continua desativado.
            </div>
          )}

          {canWrite && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar rascunho'}
            </button>
          )}

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium text-slate-500">Computador</p>
              <WelcomePopupPreview viewport="desktop" content={preview} />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium text-slate-500">Celular</p>
              <WelcomePopupPreview viewport="mobile" content={preview} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

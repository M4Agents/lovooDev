import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configureInstagramByoWebhook } from '../../services/instagramByoWebhookApi';

type Props = {
  companyId: string;
  canWrite: boolean;
  routeId: string | null;
  enabled: boolean;
  verifyConfigured: boolean;
  onRefresh: () => void;
};

function callbackUrl(routeId: string) {
  if (typeof window === 'undefined') return `/api/instagram/byo-poc/webhook/${routeId}`;
  return `${window.location.origin}/api/instagram/byo-poc/webhook/${routeId}`;
}

export function InstagramByoWebhookSection({
  companyId,
  canWrite,
  routeId,
  enabled,
  verifyConfigured,
  onRefresh,
}: Props) {
  const { t } = useTranslation('settings.app');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ companyId: string; token: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const companyRef = useRef(companyId);
  const mountedRef = useRef(true);
  companyRef.current = companyId;
  const token = revealed?.companyId === companyId ? revealed.token : null;
  const url = routeId ? callbackUrl(routeId) : '';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setRevealed(null);
    setNotice(null);
    setCopied(false);
  }, [companyId]);

  async function submit(action: 'generate' | 'rotate') {
    if (!canWrite || busy) return;
    const requestedCompany = companyId;
    setBusy(true);
    setNotice(null);
    const result = await configureInstagramByoWebhook({ companyId: requestedCompany, action });
    if (!mountedRef.current) return;
    setBusy(false);
    if (companyRef.current !== requestedCompany) return;
    if (result.kind !== 'ok') {
      setNotice(t('integrations.instagramByo.webhookUnavailable'));
      return;
    }
    setRevealed({ companyId: requestedCompany, token: result.webhookVerifyToken });
    setCopied(false);
    onRefresh();
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const stateKey = !routeId
    ? 'integrations.instagramByo.webhookNotConfigured'
    : enabled && verifyConfigured
      ? 'integrations.instagramByo.webhookConfigured'
      : 'integrations.instagramByo.webhookDisabled';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3" aria-labelledby="instagram-byo-webhook-title">
      <h4 id="instagram-byo-webhook-title" className="text-sm font-semibold text-slate-900">
        {t('integrations.instagramByo.webhookTitle')}
      </h4>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.webhookNotOperational')}</p>
      <p className="text-sm text-slate-600">{t(stateKey)}</p>
      {url && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t('integrations.instagramByo.webhookUrl')}</p>
          <p className="break-all text-sm text-slate-900">{url}</p>
          <button type="button" onClick={copyUrl} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {copied ? t('integrations.instagramByo.webhookCopied') : t('integrations.instagramByo.webhookCopy')}
          </button>
        </div>
      )}
      {token && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('integrations.instagramByo.webhookTokenOnce')} {token}
        </p>
      )}
      {notice && <p className="text-sm text-slate-600">{notice}</p>}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {!routeId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('generate')}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {t('integrations.instagramByo.webhookGenerate')}
            </button>
          )}
          {routeId && (
            <button
              type="button"
              disabled={busy || !enabled}
              onClick={() => submit('rotate')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
            >
              {t('integrations.instagramByo.webhookRotate')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getInstagramByoStatus,
  type ByoStatusPayload,
  type ByoStatusResult,
} from '../../services/instagramByoApi';

const FIELD_IDS = ['app-id', 'app-secret', 'suat'] as const;

type PanelView =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'temporary' }
  | { kind: 'ok'; status: ByoStatusPayload };

type Props = {
  companyId?: string | null;
};

function statusTextKey(view: PanelView): string | null {
  if (view.kind === 'loading') return 'integrations.instagramByo.statusLoading';
  if (view.kind === 'unavailable') return 'integrations.instagramByo.statusUnavailable';
  if (view.kind === 'denied') return 'integrations.instagramByo.statusDenied';
  if (view.kind === 'temporary') return 'integrations.instagramByo.statusTemporary';
  if (view.kind === 'ok' && !view.status.credentials.configured) {
    return 'integrations.instagramByo.stateCredentials';
  }
  if (view.kind === 'ok') return 'integrations.instagramByo.statusConfigured';
  return null;
}

export function InstagramByoMetaPanel({ companyId = null }: Props) {
  const { t } = useTranslation('settings.app');
  const [view, setView] = useState<PanelView>({ kind: 'idle' });

  useEffect(() => {
    if (!companyId) {
      setView({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setView({ kind: 'loading' });

    getInstagramByoStatus(companyId, controller.signal).then((result: ByoStatusResult) => {
      if (!active || result.kind === 'cancelled') return;
      setView(result);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [companyId]);

  const messageKey = statusTextKey(view);
  const credentials = view.kind === 'ok' && view.status.credentials.configured
    ? view.status.credentials
    : null;

  return (
    <section className="space-y-6" aria-labelledby="instagram-byo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="instagram-byo-title" className="text-lg font-semibold text-slate-900">
            {t('integrations.instagramByo.title')}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">{t('integrations.instagramByo.description')}</p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
          {t('integrations.instagramByo.badgePreparing')}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2" aria-busy={view.kind === 'loading'}>
        <p className="text-sm font-medium text-slate-900">{t('integrations.instagramByo.stateTitle')}</p>
        {messageKey && <p className="text-sm text-slate-600">{t(messageKey)}</p>}
        {credentials && (
          <dl className="space-y-1 text-sm text-slate-600">
            <div>
              <dt className="inline">{t('integrations.instagramByo.metaAppId')}: </dt>
              <dd className="inline">{credentials.meta_app_id ?? ''}</dd>
            </div>
            <div>
              <dt className="inline">{t('integrations.instagramByo.validationStatus')}: </dt>
              <dd className="inline">{credentials.validation_status}</dd>
            </div>
            <div>
              <dt className="inline">{t('integrations.instagramByo.credentialVersion')}: </dt>
              <dd className="inline">{credentials.credential_version ?? ''}</dd>
            </div>
            {credentials.validated_at && (
              <div>
                <dt className="inline">{t('integrations.instagramByo.validatedAt')}: </dt>
                <dd className="inline">{credentials.validated_at}</dd>
              </div>
            )}
            {credentials.revoked_at && (
              <div>
                <dt className="inline">{t('integrations.instagramByo.revokedAt')}: </dt>
                <dd className="inline">{credentials.revoked_at}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {FIELD_IDS.map((field) => (
          <label key={field} className="block" htmlFor={`instagram-byo-${field}`}>
            <span className="block text-sm font-medium text-slate-700 mb-1">
              {t(`integrations.instagramByo.fields.${field}`)}
            </span>
            <input
              id={`instagram-byo-${field}`}
              type={field === 'app-id' ? 'text' : 'password'}
              defaultValue=""
              disabled
              readOnly
              autoComplete="off"
              className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
            />
          </label>
        ))}
      </div>

      <p className="text-sm text-slate-600">{t('integrations.instagramByo.encryptionNotice')}</p>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.officialIndependent')}</p>
    </section>
  );
}

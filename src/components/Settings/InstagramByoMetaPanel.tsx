import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstagramByoReplaceForm } from './InstagramByoReplaceForm';
import { InstagramByoRotateSecretForm } from './InstagramByoRotateSecretForm';
import { InstagramByoRotateSuatForm } from './InstagramByoRotateSuatForm';
import { InstagramByoSetForm } from './InstagramByoSetForm';
import {
  getInstagramByoStatus,
  resolveByoSetMode,
  type ByoStatusPayload,
  type ByoStatusResult,
} from '../../services/instagramByoApi';
import {
  resolveByoReplaceMode,
  resolveByoRotateSecretMode,
  resolveByoRotateSuatMode,
} from '../../services/instagramByoWriteApi';

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
  canWrite?: boolean;
};

function statusTextKey(view: PanelView): string | null {
  if (view.kind === 'loading') return 'integrations.instagramByo.statusLoading';
  if (view.kind === 'unavailable') return 'integrations.instagramByo.statusUnavailable';
  if (view.kind === 'denied') return 'integrations.instagramByo.statusDenied';
  if (view.kind === 'temporary') return 'integrations.instagramByo.statusTemporary';
  if (view.kind === 'ok' && !view.status.credentials.configured) {
    const mode = resolveByoSetMode(view.status.credentials);
    if (mode.kind === 'initial') return 'integrations.instagramByo.stateCredentials';
    if (mode.kind === 'revoked') return 'integrations.instagramByo.statusRevoked';
    return 'integrations.instagramByo.statusSetBlocked';
  }
  if (view.kind === 'ok') return 'integrations.instagramByo.statusConfigured';
  return null;
}

export function InstagramByoMetaPanel({ companyId = null, canWrite = false }: Props) {
  const { t } = useTranslation('settings.app');
  const [view, setView] = useState<PanelView>({ kind: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setView({ kind: 'idle' });
      setNotice(null);
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
  }, [companyId, reloadKey]);

  const messageKey = statusTextKey(view);
  const configured = view.kind === 'ok' && view.status.credentials.configured
    ? view.status.credentials
    : null;
  const setMode = view.kind === 'ok' ? resolveByoSetMode(view.status.credentials) : { kind: 'blocked' as const };
  const replaceMode = view.kind === 'ok' ? resolveByoReplaceMode(view.status.credentials) : { kind: 'blocked' as const };
  const rotateSecretMode = view.kind === 'ok' ? resolveByoRotateSecretMode(view.status.credentials) : { kind: 'blocked' as const };
  const rotateSuatMode = view.kind === 'ok' ? resolveByoRotateSuatMode(view.status.credentials) : { kind: 'blocked' as const };
  const showSetForm = Boolean(canWrite && companyId && setMode.kind !== 'blocked');
  const showReplaceForm = Boolean(canWrite && companyId && replaceMode.kind === 'ready');
  const showRotateSecretForm = Boolean(canWrite && companyId && rotateSecretMode.kind === 'ready');
  const showRotateSuatForm = Boolean(canWrite && companyId && rotateSuatMode.kind === 'ready');
  const revoked = setMode.kind === 'revoked' && view.kind === 'ok' ? view.status.credentials : null;

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
        {notice && <p className="text-sm text-slate-600">{t(notice)}</p>}
        {configured && (
          <dl className="space-y-1 text-sm text-slate-600">
            <div>
              <dt className="inline">{t('integrations.instagramByo.metaAppId')}: </dt>
              <dd className="inline">{configured.meta_app_id ?? ''}</dd>
            </div>
            <div>
              <dt className="inline">{t('integrations.instagramByo.validationStatus')}: </dt>
              <dd className="inline">{configured.validation_status}</dd>
            </div>
            <div>
              <dt className="inline">{t('integrations.instagramByo.credentialVersion')}: </dt>
              <dd className="inline">{configured.credential_version ?? ''}</dd>
            </div>
            {configured.validated_at && (
              <div>
                <dt className="inline">{t('integrations.instagramByo.validatedAt')}: </dt>
                <dd className="inline">{configured.validated_at}</dd>
              </div>
            )}
            {configured.revoked_at && (
              <div>
                <dt className="inline">{t('integrations.instagramByo.revokedAt')}: </dt>
                <dd className="inline">{configured.revoked_at}</dd>
              </div>
            )}
          </dl>
        )}
        {revoked && (
          <dl className="space-y-1 text-sm text-slate-600">
            <div>
              <dt className="inline">{t('integrations.instagramByo.validationStatus')}: </dt>
              <dd className="inline">{revoked.validation_status}</dd>
            </div>
            <div>
              <dt className="inline">{t('integrations.instagramByo.credentialVersion')}: </dt>
              <dd className="inline">{revoked.credential_version}</dd>
            </div>
            {revoked.revoked_at && (
              <div>
                <dt className="inline">{t('integrations.instagramByo.revokedAt')}: </dt>
                <dd className="inline">{revoked.revoked_at}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {showSetForm && companyId && setMode.kind !== 'blocked' ? (
        <InstagramByoSetForm
          companyId={companyId}
          mode={setMode}
          onRefresh={() => setReloadKey((current) => current + 1)}
          onNotice={setNotice}
        />
      ) : (showReplaceForm || showRotateSecretForm || showRotateSuatForm) && companyId ? (
        <div className="space-y-8">
          {showReplaceForm && replaceMode.kind === 'ready' && (
            <InstagramByoReplaceForm
              companyId={companyId}
              expectedVersion={replaceMode.expectedVersion}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={setNotice}
            />
          )}
          {showRotateSecretForm && rotateSecretMode.kind === 'ready' && (
            <InstagramByoRotateSecretForm
              companyId={companyId}
              expectedVersion={rotateSecretMode.expectedVersion}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={setNotice}
            />
          )}
          {showRotateSuatForm && rotateSuatMode.kind === 'ready' && (
            <InstagramByoRotateSuatForm
              companyId={companyId}
              expectedVersion={rotateSuatMode.expectedVersion}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={setNotice}
            />
          )}
        </div>
      ) : (
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
      )}

      <p className="text-sm text-slate-600">{t('integrations.instagramByo.encryptionNotice')}</p>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.officialIndependent')}</p>
    </section>
  );
}

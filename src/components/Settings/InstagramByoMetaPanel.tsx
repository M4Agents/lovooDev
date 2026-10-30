import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstagramByoReplaceForm } from './InstagramByoReplaceForm';
import { InstagramByoRotateSecretForm } from './InstagramByoRotateSecretForm';
import { InstagramByoRotateSuatForm } from './InstagramByoRotateSuatForm';
import { InstagramByoRevokeForm } from './InstagramByoRevokeForm';
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
  resolveByoRevokeMode,
} from '../../services/instagramByoWriteApi';

const FIELD_IDS = ['app-id', 'app-secret', 'suat'] as const;

type Sync = 'initial' | 'ready' | 'refreshing' | 'unconfirmed';
type Fault = 'unavailable' | 'denied' | 'temporary' | null;
type Shown = { set: boolean; replace: boolean; rotateSecret: boolean; rotateSuat: boolean; revoke: boolean };
type Notices = Record<keyof Shown, string | null>;
const NONE_SHOWN: Shown = { set: false, replace: false, rotateSecret: false, rotateSuat: false, revoke: false };
const EMPTY_NOTICES: Notices = { set: null, replace: null, rotateSecret: null, rotateSuat: null, revoke: null };

type Props = {
  companyId?: string | null;
  canWrite?: boolean;
};

function latchShown(shown: Shown, status: ByoStatusPayload, canWrite: boolean): Shown {
  if (!canWrite) return shown;
  const credentials = status.credentials;
  return {
    set: shown.set || resolveByoSetMode(credentials).kind !== 'blocked',
    replace: shown.replace || resolveByoReplaceMode(credentials).kind === 'ready',
    rotateSecret: shown.rotateSecret || resolveByoRotateSecretMode(credentials).kind === 'ready',
    rotateSuat: shown.rotateSuat || resolveByoRotateSuatMode(credentials).kind === 'ready',
    revoke: shown.revoke || resolveByoRevokeMode(credentials).kind === 'ready',
  };
}

function fallbackVersion(status: ByoStatusPayload | null): number {
  const version = status?.credentials.credential_version;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : 1;
}

function messageKey(sync: Sync, fault: Fault, snapshot: ByoStatusPayload | null): string | null {
  if (!snapshot && fault === 'unavailable') return 'integrations.instagramByo.statusUnavailable';
  if (!snapshot && fault === 'denied') return 'integrations.instagramByo.statusDenied';
  if (!snapshot && fault === 'temporary') return 'integrations.instagramByo.statusTemporary';
  if (!snapshot) return 'integrations.instagramByo.statusLoading';
  if (sync === 'refreshing') return 'integrations.instagramByo.statusRefreshing';
  if (sync === 'unconfirmed') return 'integrations.instagramByo.statusUnconfirmed';
  if (!snapshot.credentials.configured) {
    const mode = resolveByoSetMode(snapshot.credentials);
    if (mode.kind === 'initial') return 'integrations.instagramByo.stateCredentials';
    if (mode.kind === 'revoked') return 'integrations.instagramByo.statusRevoked';
    return 'integrations.instagramByo.statusSetBlocked';
  }
  return 'integrations.instagramByo.statusConfigured';
}

export function InstagramByoMetaPanel({ companyId = null, canWrite = false }: Props) {
  const { t } = useTranslation('settings.app');
  const [snapshot, setSnapshot] = useState<ByoStatusPayload | null>(null);
  const [sync, setSync] = useState<Sync>('initial');
  const [fault, setFault] = useState<Fault>(null);
  const [shown, setShown] = useState<Shown>(NONE_SHOWN);
  const [notices, setNotices] = useState<Notices>(EMPTY_NOTICES);
  const [reloadKey, setReloadKey] = useState(0);
  const snapshotRef = useRef<ByoStatusPayload | null>(null);
  const seenCompany = useRef<string | null | undefined>(undefined);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;

  useEffect(() => {
    const companyChanged = seenCompany.current !== companyId;
    seenCompany.current = companyId;
    if (!companyId || companyChanged) {
      snapshotRef.current = null;
      setSnapshot(null);
      setSync('initial');
      setFault(null);
      setShown(NONE_SHOWN);
      setNotices(EMPTY_NOTICES);
    }
    if (!companyId) return undefined;

    const controller = new AbortController();
    let active = true;
    const keep = snapshotRef.current !== null;
    setSync(keep ? 'refreshing' : 'initial');

    getInstagramByoStatus(companyId, controller.signal).then((result: ByoStatusResult) => {
      if (!active || result.kind === 'cancelled') return;
      if (result.kind === 'ok') {
        snapshotRef.current = result.status;
        setSnapshot(result.status);
        setSync('ready');
        setFault(null);
        setShown((current) => latchShown(current, result.status, canWriteRef.current));
        return;
      }
      if (snapshotRef.current) {
        setSync('unconfirmed');
        return;
      }
      setSync('initial');
      setFault(result.kind);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [companyId, reloadKey]);

  const credentials = snapshot?.credentials ?? null;
  const setMode = credentials ? resolveByoSetMode(credentials) : { kind: 'blocked' as const };
  const replaceMode = credentials ? resolveByoReplaceMode(credentials) : { kind: 'blocked' as const };
  const rotateSecretMode = credentials ? resolveByoRotateSecretMode(credentials) : { kind: 'blocked' as const };
  const rotateSuatMode = credentials ? resolveByoRotateSuatMode(credentials) : { kind: 'blocked' as const };
  const revokeMode = credentials ? resolveByoRevokeMode(credentials) : { kind: 'blocked' as const };
  const openForNew = sync === 'ready' && Boolean(canWrite && companyId);
  const version = fallbackVersion(snapshot);
  const textKey = messageKey(sync, fault, snapshot);
  const showVersion = sync === 'ready' && snapshot !== null;
  const configured = showVersion && snapshot.credentials.configured ? snapshot.credentials : null;
  const revoked = showVersion && setMode.kind === 'revoked' ? snapshot.credentials : null;
  const anyForm = shown.set || shown.replace || shown.rotateSecret || shown.rotateSuat || shown.revoke;
  const noticeSetter = (slot: keyof Notices) => (notice: string | null) => {
    setNotices((current) => ({ ...current, [slot]: notice }));
  };

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

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2" aria-busy={sync === 'initial' || sync === 'refreshing'}>
        <p className="text-sm font-medium text-slate-900">{t('integrations.instagramByo.stateTitle')}</p>
        {textKey && <p className="text-sm text-slate-600">{t(textKey)}</p>}
        {(Object.keys(notices) as (keyof Notices)[]).map((slot) => (
          notices[slot] ? <p key={slot} className="text-sm text-slate-600">{t(notices[slot])}</p> : null
        ))}
        {sync === 'unconfirmed' && (
          <button
            type="button"
            data-testid="instagram-byo-refresh-status"
            onClick={() => setReloadKey((current) => current + 1)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.refreshStatus')}
          </button>
        )}
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

      {shown.set && companyId && (
        <InstagramByoSetForm
          companyId={companyId}
          mode={setMode}
          acceptNewAttempt={openForNew && setMode.kind !== 'blocked'}
          onRefresh={() => setReloadKey((current) => current + 1)}
          onNotice={noticeSetter('set')}
        />
      )}
      {(shown.replace || shown.rotateSecret || shown.rotateSuat || shown.revoke) && companyId && (
        <div className="space-y-8">
          {shown.replace && (
            <InstagramByoReplaceForm
              companyId={companyId}
              expectedVersion={replaceMode.kind === 'ready' ? replaceMode.expectedVersion : version}
              acceptNewAttempt={openForNew && replaceMode.kind === 'ready'}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={noticeSetter('replace')}
            />
          )}
          {shown.rotateSecret && (
            <InstagramByoRotateSecretForm
              companyId={companyId}
              expectedVersion={rotateSecretMode.kind === 'ready' ? rotateSecretMode.expectedVersion : version}
              acceptNewAttempt={openForNew && rotateSecretMode.kind === 'ready'}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={noticeSetter('rotateSecret')}
            />
          )}
          {shown.rotateSuat && (
            <InstagramByoRotateSuatForm
              companyId={companyId}
              expectedVersion={rotateSuatMode.kind === 'ready' ? rotateSuatMode.expectedVersion : version}
              acceptNewAttempt={openForNew && rotateSuatMode.kind === 'ready'}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={noticeSetter('rotateSuat')}
            />
          )}
          {shown.revoke && (
            <InstagramByoRevokeForm
              companyId={companyId}
              expectedVersion={revokeMode.kind === 'ready' ? revokeMode.expectedVersion : version}
              acceptNewAttempt={openForNew && revokeMode.kind === 'ready'}
              onRefresh={() => setReloadKey((current) => current + 1)}
              onNotice={noticeSetter('revoke')}
            />
          )}
        </div>
      )}
      {!anyForm && (
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

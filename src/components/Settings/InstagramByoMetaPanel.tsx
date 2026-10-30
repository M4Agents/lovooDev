import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstagramByoActionForms } from './InstagramByoActionForms';
import { InstagramByoSetupGuide } from './InstagramByoSetupGuide';
import { InstagramByoValidationSection } from './InstagramByoValidationSection';
import { InstagramByoSetForm } from './InstagramByoSetForm';
import {
  getInstagramByoStatus,
  resolveByoSetMode,
  type ByoStatusPayload,
  type ByoStatusResult,
} from '../../services/instagramByoApi';
import {
  byoStatusMessageKey,
  byoStatusValueKey,
  type ByoFault,
  type ByoSync,
} from './instagramByoPresentation';
import {
  resolveByoReplaceMode,
  resolveByoRotateSecretMode,
  resolveByoRotateSuatMode,
  resolveByoRevokeMode,
} from '../../services/instagramByoWriteApi';

const FIELD_IDS = ['app-id', 'app-secret', 'suat'] as const;

type Sync = ByoSync;
type Fault = ByoFault;
type ManageAction = 'replace' | 'rotateSecret' | 'rotateSuat' | 'revoke';
type ByoAttemptPhase = 'edit' | 'confirm' | 'sending' | 'retryable';
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

export function InstagramByoMetaPanel({ companyId = null, canWrite = false }: Props) {
  const { t } = useTranslation('settings.app');
  const [snapshot, setSnapshot] = useState<ByoStatusPayload | null>(null);
  const [sync, setSync] = useState<Sync>('initial');
  const [fault, setFault] = useState<Fault>(null);
  const [shown, setShown] = useState<Shown>(NONE_SHOWN);
  const [notices, setNotices] = useState<Notices>(EMPTY_NOTICES);
  const [action, setAction] = useState<ManageAction | null>(null);
  const [setPhase, setSetPhase] = useState<ByoAttemptPhase>('edit');
  const [manageUncertain, setManageUncertain] = useState(false);
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
      setAction(null);
      setSetPhase('edit');
      setManageUncertain(false);
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
  const textKey = byoStatusMessageKey(sync, fault, snapshot);
  const showVersion = sync === 'ready' && snapshot !== null;
  const configured = showVersion && snapshot.credentials.configured ? snapshot.credentials : null;
  const revoked = showVersion && setMode.kind === 'revoked' ? snapshot.credentials : null;
  const setVisible = setMode.kind === 'initial' || setMode.kind === 'revoked' || setPhase !== 'edit';
  const canManage = Boolean(canWrite && configured && (shown.replace || shown.rotateSecret || shown.rotateSuat || shown.revoke));
  const setUncertain = setPhase === 'sending' || setPhase === 'retryable';
  const canRefresh = sync === 'unconfirmed' || (!snapshot && fault !== null);
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
        <InstagramByoSetupGuide />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2" aria-busy={sync === 'initial' || sync === 'refreshing'}>
        <p className="text-sm font-medium text-slate-900">{t('integrations.instagramByo.stateTitle')}</p>
        {textKey && <p className="text-sm text-slate-600">{t(textKey)}</p>}
        {(Object.keys(notices) as (keyof Notices)[]).map((slot) => (
          notices[slot] ? <p key={slot} className="text-sm text-slate-600">{t(notices[slot])}</p> : null
        ))}
        {canRefresh && (
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
              <dd className="inline">{t(byoStatusValueKey(configured.validation_status))}</dd>
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
        <InstagramByoValidationSection
          companyId={companyId}
          canWrite={Boolean(canWrite)}
          ready={sync === 'ready'}
          credentials={snapshot?.credentials ?? null}
          accounts={snapshot?.accounts ?? []}
          onRefresh={() => setReloadKey((current) => current + 1)}
        />
        {revoked && (
          <dl className="space-y-1 text-sm text-slate-600">
            <div>
              <dt className="inline">{t('integrations.instagramByo.validationStatus')}: </dt>
              <dd className="inline">{t(byoStatusValueKey(revoked.validation_status))}</dd>
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
        <div hidden={!setVisible}>
          <InstagramByoSetForm
            companyId={companyId}
            mode={setMode}
            acceptNewAttempt={openForNew && setMode.kind !== 'blocked' && !manageUncertain}
            onRefresh={() => setReloadKey((current) => current + 1)}
            onNotice={noticeSetter('set')}
            onPhase={setSetPhase}
          />
        </div>
      )}
      {companyId && (
        <InstagramByoActionForms
          companyId={companyId}
          action={action}
          onAction={setAction}
          canManage={canManage}
          externalUncertain={setUncertain}
          onUncertain={setManageUncertain}
          onRefresh={() => setReloadKey((current) => current + 1)}
          onNotice={(slot, notice) => noticeSetter(slot)(notice)}
          replace={{
            shown: shown.replace,
            expectedVersion: replaceMode.kind === 'ready' ? replaceMode.expectedVersion : version,
            acceptNewAttempt: openForNew && replaceMode.kind === 'ready',
          }}
          rotateSecret={{
            shown: shown.rotateSecret,
            expectedVersion: rotateSecretMode.kind === 'ready' ? rotateSecretMode.expectedVersion : version,
            acceptNewAttempt: openForNew && rotateSecretMode.kind === 'ready',
          }}
          rotateSuat={{
            shown: shown.rotateSuat,
            expectedVersion: rotateSuatMode.kind === 'ready' ? rotateSuatMode.expectedVersion : version,
            acceptNewAttempt: openForNew && rotateSuatMode.kind === 'ready',
          }}
          revoke={{
            shown: shown.revoke,
            expectedVersion: revokeMode.kind === 'ready' ? revokeMode.expectedVersion : version,
            acceptNewAttempt: openForNew && revokeMode.kind === 'ready',
          }}
        />
      )}
      {!companyId && (
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

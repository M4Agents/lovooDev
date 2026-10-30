import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  setInstagramByoCredentials,
  type ByoSetMode,
  type ByoSetResult,
} from '../../services/instagramByoApi';

type Notice =
  | 'applied'
  | 'idempotent'
  | 'stale'
  | 'conflict'
  | 'request_reused'
  | 'rejected'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'too_large'
  | 'unsupported_media'
  | 'service_unavailable'
  | 'unknown';

type Attempt = {
  companyId: string;
  requestId: string;
  metaAppId: string;
  appSecret: string;
  suat: string;
  expectedVersion?: number;
};

type Phase = 'edit' | 'confirm' | 'sending' | 'retryable';

type Props = {
  companyId: string;
  mode: Exclude<ByoSetMode, { kind: 'blocked' }>;
  onRefresh: () => void;
  onNotice: (notice: string | null) => void;
};

const NOTICE_KEY: Record<Notice, string> = {
  applied: 'integrations.instagramByo.setApplied',
  idempotent: 'integrations.instagramByo.setIdempotent',
  stale: 'integrations.instagramByo.setStale',
  conflict: 'integrations.instagramByo.setConflict',
  request_reused: 'integrations.instagramByo.setRequestReused',
  rejected: 'integrations.instagramByo.setRejected',
  unauthorized: 'integrations.instagramByo.setUnauthorized',
  forbidden: 'integrations.instagramByo.setForbidden',
  unavailable: 'integrations.instagramByo.setWriteUnavailable',
  too_large: 'integrations.instagramByo.setTooLarge',
  unsupported_media: 'integrations.instagramByo.setUnsupported',
  service_unavailable: 'integrations.instagramByo.setServiceUnavailable',
  unknown: 'integrations.instagramByo.setUnknownOutcome',
};

function createRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function InstagramByoSetForm({ companyId, mode, onRefresh, onNotice }: Props) {
  const { t } = useTranslation('settings.app');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [suat, setSuat] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const companyRef = useRef(companyId);
  companyRef.current = companyId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setAppId('');
    setAppSecret('');
    setSuat('');
    setPhase('edit');
    setAttempt(null);
  }, [companyId]);

  function clearSecrets() {
    setAppId('');
    setAppSecret('');
    setSuat('');
    setAttempt(null);
    setPhase('edit');
  }

  function prepare() {
    if (!appId || !appSecret || !suat) return;
    setAttempt({
      companyId,
      requestId: createRequestId(),
      metaAppId: appId,
      appSecret,
      suat,
      expectedVersion: mode.kind === 'revoked' ? mode.expectedVersion : undefined,
    });
    setPhase('confirm');
    onNotice(null);
  }

  async function send(current: Attempt) {
    if (sendingRef.current) return;
    const retryingUnknown = phase === 'retryable';
    sendingRef.current = true;
    setPhase('sending');
    let result: ByoSetResult;
    try {
      result = await setInstagramByoCredentials({
        companyId: current.companyId,
        requestId: current.requestId,
        metaAppId: current.metaAppId,
        appSecret: current.appSecret,
        suat: current.suat,
        expectedVersion: current.expectedVersion,
      });
    } finally {
      sendingRef.current = false;
    }
    if (!mountedRef.current || current.companyId !== companyRef.current) return;

    const sessionLost = result.kind === 'unauthorized' || result.kind === 'session_unavailable';
    if (
      result.kind === 'network'
      || result.kind === 'service_unavailable'
      || (retryingUnknown && sessionLost)
    ) {
      setPhase('retryable');
      onNotice(NOTICE_KEY.unknown);
      return;
    }
    if (sessionLost) {
      setPhase('edit');
      setAttempt(null);
      onNotice(NOTICE_KEY.unauthorized);
      return;
    }
    if (result.kind === 'conflict' || result.kind === 'request_reused') {
      clearSecrets();
      onNotice(NOTICE_KEY[result.kind]);
      onRefresh();
      return;
    }
    if (result.kind === 'ok') {
      const notice: Notice = result.body.stale
        ? 'stale'
        : result.body.result === 'idempotent'
          ? 'idempotent'
          : 'applied';
      clearSecrets();
      onNotice(NOTICE_KEY[notice]);
      onRefresh();
      return;
    }
    const notice = result.kind === 'temporary' ? 'rejected' : result.kind;
    setPhase('edit');
    setAttempt(null);
    onNotice(NOTICE_KEY[notice]);
  }

  const locked = phase === 'confirm' || phase === 'sending' || phase === 'retryable';
  const shownAppId = locked && attempt ? attempt.metaAppId : appId;
  const shownSecret = locked && attempt ? attempt.appSecret : appSecret;
  const shownSuat = locked && attempt ? attempt.suat : suat;

  return (
    <div className="space-y-4">
      {phase === 'sending' && (
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.setSending')}</p>
      )}
      <div className="grid grid-cols-1 gap-4">
        <label className="block" htmlFor="instagram-byo-app-id">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.fields.app-id')}
          </span>
          <input
            id="instagram-byo-app-id"
            type="text"
            value={shownAppId}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setAppId(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block" htmlFor="instagram-byo-app-secret">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.fields.app-secret')}
          </span>
          <input
            id="instagram-byo-app-secret"
            type="password"
            value={shownSecret}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setAppSecret(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block" htmlFor="instagram-byo-suat">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.fields.suat')}
          </span>
          <input
            id="instagram-byo-suat"
            type="password"
            value={shownSuat}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setSuat(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>
      {phase === 'edit' && (
        <button
          type="button"
          disabled={!appId || !appSecret || !suat}
          onClick={prepare}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-300"
        >
          {t('integrations.instagramByo.setSubmit')}
        </button>
      )}
      {phase === 'confirm' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.setConfirm')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase('edit');
              setAttempt(null);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.setCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.setRetry')}
          </button>
          <button type="button" onClick={clearSecrets} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.setDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

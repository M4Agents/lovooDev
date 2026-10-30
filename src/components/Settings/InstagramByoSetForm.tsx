import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  setInstagramByoCredentials,
  type ByoSetMode,
} from '../../services/instagramByoApi';
import {
  useByoCredentialAttempt,
  type ByoWriteNotice,
} from './useByoCredentialAttempt';

type Attempt = {
  companyId: string;
  requestId: string;
  metaAppId: string;
  appSecret: string;
  suat: string;
  expectedVersion?: number;
};

type Props = {
  companyId: string;
  mode: Exclude<ByoSetMode, { kind: 'blocked' }>;
  onRefresh: () => void;
  onNotice: (notice: string | null) => void;
};

const NOTICE_KEY: Record<ByoWriteNotice, string> = {
  applied: 'integrations.instagramByo.setApplied',
  idempotent: 'integrations.instagramByo.setIdempotent',
  stale: 'integrations.instagramByo.setStale',
  already_revoked: 'integrations.instagramByo.alreadyRevoked',
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

export function InstagramByoSetForm({ companyId, mode, onRefresh, onNotice }: Props) {
  const { t } = useTranslation('settings.app');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [suat, setSuat] = useState('');
  const flow = useByoCredentialAttempt<Attempt>({
    companyId,
    onNotice: (notice) => onNotice(notice ? NOTICE_KEY[notice] : null),
    onRefresh,
    onClearFields: () => {
      setAppId('');
      setAppSecret('');
      setSuat('');
    },
    execute: (current) => setInstagramByoCredentials({
      companyId: current.companyId,
      requestId: current.requestId,
      metaAppId: current.metaAppId,
      appSecret: current.appSecret,
      suat: current.suat,
      expectedVersion: current.expectedVersion,
    }),
  });
  const { phase, attempt } = flow;

  function prepare() {
    if (!appId || !appSecret || !suat) return;
    flow.confirm({
      companyId,
      metaAppId: appId,
      appSecret,
      suat,
      expectedVersion: mode.kind === 'revoked' ? mode.expectedVersion : undefined,
    });
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
            onClick={() => flow.send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.setConfirm')}
          </button>
          <button
            type="button"
            onClick={flow.cancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.setCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.setRetry')}
          </button>
          <button type="button" onClick={flow.discard} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.setDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { replaceInstagramByoApp } from '../../services/instagramByoWriteApi';
import {
  useByoCredentialAttempt,
  type ByoWriteNotice,
} from './useByoCredentialAttempt';

type Attempt = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
  metaAppId: string;
  appSecret: string;
  suat: string;
};

type Props = {
  companyId: string;
  expectedVersion: number;
  acceptNewAttempt?: boolean;
  onRefresh: () => void;
  onNotice: (notice: string | null) => void;
};

const NOTICE_KEY: Record<ByoWriteNotice, string> = {
  applied: 'integrations.instagramByo.replaceApplied',
  idempotent: 'integrations.instagramByo.replaceIdempotent',
  stale: 'integrations.instagramByo.replaceStale',
  already_revoked: 'integrations.instagramByo.alreadyRevoked',
  conflict: 'integrations.instagramByo.replaceConflict',
  request_reused: 'integrations.instagramByo.replaceRequestReused',
  rejected: 'integrations.instagramByo.replaceRejected',
  unauthorized: 'integrations.instagramByo.replaceUnauthorized',
  forbidden: 'integrations.instagramByo.replaceForbidden',
  unavailable: 'integrations.instagramByo.replaceWriteUnavailable',
  too_large: 'integrations.instagramByo.replaceTooLarge',
  unsupported_media: 'integrations.instagramByo.replaceUnsupported',
  service_unavailable: 'integrations.instagramByo.replaceServiceUnavailable',
  unknown: 'integrations.instagramByo.replaceUnknownOutcome',
};

export function InstagramByoReplaceForm({
  companyId,
  expectedVersion,
  acceptNewAttempt = true,
  onRefresh,
  onNotice,
}: Props) {
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
    execute: (current) => replaceInstagramByoApp({
      companyId: current.companyId,
      requestId: current.requestId,
      expectedVersion: current.expectedVersion,
      metaAppId: current.metaAppId,
      appSecret: current.appSecret,
      suat: current.suat,
    }),
  });
  const { phase, attempt } = flow;

  function prepare() {
    if (!acceptNewAttempt) return;
    if (!appId || !appSecret || !suat) return;
    flow.confirm({
      companyId,
      expectedVersion,
      metaAppId: appId,
      appSecret,
      suat,
    });
  }

  const locked = phase === 'confirm' || phase === 'sending' || phase === 'retryable';
  const shownAppId = locked && attempt ? attempt.metaAppId : appId;
  const shownSecret = locked && attempt ? attempt.appSecret : appSecret;
  const shownSuat = locked && attempt ? attempt.suat : suat;

  return (
    <div className="space-y-4">
      {phase === 'sending' && (
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.replaceSending')}</p>
      )}
      <div className="grid grid-cols-1 gap-4">
        <label className="block" htmlFor="instagram-byo-replace-app-id">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.replaceFields.app-id')}
          </span>
          <input
            id="instagram-byo-replace-app-id"
            type="text"
            value={shownAppId}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setAppId(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block" htmlFor="instagram-byo-replace-app-secret">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.replaceFields.app-secret')}
          </span>
          <input
            id="instagram-byo-replace-app-secret"
            type="password"
            value={shownSecret}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setAppSecret(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block" htmlFor="instagram-byo-replace-suat">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('integrations.instagramByo.replaceFields.suat')}
          </span>
          <input
            id="instagram-byo-replace-suat"
            type="password"
            value={shownSuat}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => setSuat(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>
      {phase === 'confirm' && attempt && (
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{t('integrations.instagramByo.replaceWarning')}</p>
          <p className="text-sm text-slate-600">
            {t('integrations.instagramByo.replaceVersion', { version: attempt.expectedVersion })}
          </p>
        </div>
      )}
      {phase === 'edit' && (
        <button
          type="button"
          disabled={!acceptNewAttempt || !appId || !appSecret || !suat}
          onClick={prepare}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-300"
        >
          {t('integrations.instagramByo.replaceSubmit')}
        </button>
      )}
      {phase === 'confirm' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => flow.send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.replaceConfirm')}
          </button>
          <button
            type="button"
            onClick={flow.cancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.replaceCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.replaceRetry')}
          </button>
          <button type="button" onClick={flow.discard} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.replaceDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

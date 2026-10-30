import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rotateInstagramByoSecret } from '../../services/instagramByoWriteApi';
import {
  useByoCredentialAttempt,
  type ByoWriteNotice,
} from './useByoCredentialAttempt';

type Attempt = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
  appSecret: string;
};

type Props = {
  companyId: string;
  expectedVersion: number;
  onRefresh: () => void;
  onNotice: (notice: string | null) => void;
};

const NOTICE_KEY: Record<ByoWriteNotice, string> = {
  applied: 'integrations.instagramByo.rotateSecretApplied',
  idempotent: 'integrations.instagramByo.rotateSecretIdempotent',
  stale: 'integrations.instagramByo.rotateSecretStale',
  already_revoked: 'integrations.instagramByo.alreadyRevoked',
  conflict: 'integrations.instagramByo.rotateSecretConflict',
  request_reused: 'integrations.instagramByo.rotateSecretRequestReused',
  rejected: 'integrations.instagramByo.rotateSecretRejected',
  unauthorized: 'integrations.instagramByo.rotateSecretUnauthorized',
  forbidden: 'integrations.instagramByo.rotateSecretForbidden',
  unavailable: 'integrations.instagramByo.rotateSecretWriteUnavailable',
  too_large: 'integrations.instagramByo.rotateSecretTooLarge',
  unsupported_media: 'integrations.instagramByo.rotateSecretUnsupported',
  service_unavailable: 'integrations.instagramByo.rotateSecretServiceUnavailable',
  unknown: 'integrations.instagramByo.rotateSecretUnknownOutcome',
};

export function InstagramByoRotateSecretForm({
  companyId,
  expectedVersion,
  onRefresh,
  onNotice,
}: Props) {
  const { t } = useTranslation('settings.app');
  const [appSecret, setAppSecret] = useState('');
  const flow = useByoCredentialAttempt<Attempt>({
    companyId,
    onNotice: (notice) => onNotice(notice ? NOTICE_KEY[notice] : null),
    onRefresh,
    onClearFields: () => setAppSecret(''),
    execute: (current) => rotateInstagramByoSecret({
      companyId: current.companyId,
      requestId: current.requestId,
      expectedVersion: current.expectedVersion,
      appSecret: current.appSecret,
    }),
  });
  const { phase, attempt } = flow;

  function prepare() {
    if (!appSecret) return;
    flow.confirm({
      companyId,
      expectedVersion,
      appSecret,
    });
  }

  const locked = phase === 'confirm' || phase === 'sending' || phase === 'retryable';
  const shownSecret = locked && attempt ? attempt.appSecret : appSecret;

  return (
    <div className="space-y-4">
      {phase === 'sending' && (
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.rotateSecretSending')}</p>
      )}
      <label className="block" htmlFor="instagram-byo-rotate-secret">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          {t('integrations.instagramByo.rotateSecretFields.app-secret')}
        </span>
        <input
          id="instagram-byo-rotate-secret"
          type="password"
          value={shownSecret}
          disabled={locked}
          autoComplete="off"
          onChange={(event) => setAppSecret(event.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      {phase === 'confirm' && attempt && (
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{t('integrations.instagramByo.rotateSecretWarning')}</p>
          <p className="text-sm text-slate-600">
            {t('integrations.instagramByo.rotateSecretVersion', { version: attempt.expectedVersion })}
          </p>
        </div>
      )}
      {phase === 'edit' && (
        <button
          type="button"
          disabled={!appSecret}
          onClick={prepare}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-300"
        >
          {t('integrations.instagramByo.rotateSecretSubmit')}
        </button>
      )}
      {phase === 'confirm' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => flow.send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.rotateSecretConfirm')}
          </button>
          <button
            type="button"
            onClick={flow.cancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.rotateSecretCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.rotateSecretRetry')}
          </button>
          <button type="button" onClick={flow.discard} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.rotateSecretDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

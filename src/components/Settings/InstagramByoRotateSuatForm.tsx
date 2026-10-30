import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rotateInstagramByoSuat } from '../../services/instagramByoWriteApi';
import {
  useByoCredentialAttempt,
  type ByoWriteNotice,
} from './useByoCredentialAttempt';

type Attempt = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
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
  applied: 'integrations.instagramByo.rotateSuatApplied',
  idempotent: 'integrations.instagramByo.rotateSuatIdempotent',
  stale: 'integrations.instagramByo.rotateSuatStale',
  already_revoked: 'integrations.instagramByo.alreadyRevoked',
  conflict: 'integrations.instagramByo.rotateSuatConflict',
  request_reused: 'integrations.instagramByo.rotateSuatRequestReused',
  rejected: 'integrations.instagramByo.rotateSuatRejected',
  unauthorized: 'integrations.instagramByo.rotateSuatUnauthorized',
  forbidden: 'integrations.instagramByo.rotateSuatForbidden',
  unavailable: 'integrations.instagramByo.rotateSuatWriteUnavailable',
  too_large: 'integrations.instagramByo.rotateSuatTooLarge',
  unsupported_media: 'integrations.instagramByo.rotateSuatUnsupported',
  service_unavailable: 'integrations.instagramByo.rotateSuatServiceUnavailable',
  unknown: 'integrations.instagramByo.rotateSuatUnknownOutcome',
};

export function InstagramByoRotateSuatForm({
  companyId,
  expectedVersion,
  acceptNewAttempt = true,
  onRefresh,
  onNotice,
}: Props) {
  const { t } = useTranslation('settings.app');
  const [suat, setSuat] = useState('');
  const flow = useByoCredentialAttempt<Attempt>({
    companyId,
    onNotice: (notice) => onNotice(notice ? NOTICE_KEY[notice] : null),
    onRefresh,
    onClearFields: () => setSuat(''),
    execute: (current) => rotateInstagramByoSuat({
      companyId: current.companyId,
      requestId: current.requestId,
      expectedVersion: current.expectedVersion,
      suat: current.suat,
    }),
  });
  const { phase, attempt } = flow;

  function prepare() {
    if (!acceptNewAttempt) return;
    if (!suat) return;
    flow.confirm({
      companyId,
      expectedVersion,
      suat,
    });
  }

  const locked = phase === 'confirm' || phase === 'sending' || phase === 'retryable';
  const shownSuat = locked && attempt ? attempt.suat : suat;

  return (
    <div className="space-y-4">
      {phase === 'sending' && (
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.rotateSuatSending')}</p>
      )}
      <label className="block" htmlFor="instagram-byo-rotate-suat">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          {t('integrations.instagramByo.rotateSuatFields.suat')}
        </span>
        <input
          id="instagram-byo-rotate-suat"
          type="password"
          value={shownSuat}
          disabled={locked}
          autoComplete="off"
          onChange={(event) => setSuat(event.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      {phase === 'confirm' && attempt && (
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{t('integrations.instagramByo.rotateSuatWarning')}</p>
          <p className="text-sm text-slate-600">
            {t('integrations.instagramByo.rotateSuatVersion', { version: attempt.expectedVersion })}
          </p>
        </div>
      )}
      {phase === 'edit' && (
        <button
          type="button"
          disabled={!acceptNewAttempt || !suat}
          onClick={prepare}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-300"
        >
          {t('integrations.instagramByo.rotateSuatSubmit')}
        </button>
      )}
      {phase === 'confirm' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => flow.send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.rotateSuatConfirm')}
          </button>
          <button
            type="button"
            onClick={flow.cancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.rotateSuatCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.rotateSuatRetry')}
          </button>
          <button type="button" onClick={flow.discard} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.rotateSuatDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

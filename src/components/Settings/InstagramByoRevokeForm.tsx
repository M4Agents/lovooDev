import { useTranslation } from 'react-i18next';
import { revokeInstagramByoCredentials } from '../../services/instagramByoWriteApi';
import {
  useByoCredentialAttempt,
  type ByoWriteNotice,
} from './useByoCredentialAttempt';

type Attempt = {
  companyId: string;
  requestId: string;
  expectedVersion: number;
};

type Props = {
  companyId: string;
  expectedVersion: number;
  onRefresh: () => void;
  onNotice: (notice: string | null) => void;
};

const NOTICE_KEY: Record<ByoWriteNotice, string> = {
  applied: 'integrations.instagramByo.revokeApplied',
  idempotent: 'integrations.instagramByo.revokeIdempotent',
  stale: 'integrations.instagramByo.revokeStale',
  already_revoked: 'integrations.instagramByo.revokeAlreadyRevoked',
  conflict: 'integrations.instagramByo.revokeConflict',
  request_reused: 'integrations.instagramByo.revokeRequestReused',
  rejected: 'integrations.instagramByo.revokeRejected',
  unauthorized: 'integrations.instagramByo.revokeUnauthorized',
  forbidden: 'integrations.instagramByo.revokeForbidden',
  unavailable: 'integrations.instagramByo.revokeWriteUnavailable',
  too_large: 'integrations.instagramByo.revokeTooLarge',
  unsupported_media: 'integrations.instagramByo.revokeUnsupported',
  service_unavailable: 'integrations.instagramByo.revokeServiceUnavailable',
  unknown: 'integrations.instagramByo.revokeUnknownOutcome',
};

export function InstagramByoRevokeForm({
  companyId,
  expectedVersion,
  onRefresh,
  onNotice,
}: Props) {
  const { t } = useTranslation('settings.app');
  const flow = useByoCredentialAttempt<Attempt>({
    companyId,
    onNotice: (notice) => onNotice(notice ? NOTICE_KEY[notice] : null),
    onRefresh,
    onClearFields: () => undefined,
    execute: (current) => revokeInstagramByoCredentials({
      companyId: current.companyId,
      requestId: current.requestId,
      expectedVersion: current.expectedVersion,
    }),
  });
  const { phase, attempt } = flow;

  return (
    <div className="space-y-4" data-testid="instagram-byo-revoke">
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.revokeLead')}</p>
      {phase === 'sending' && (
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.revokeSending')}</p>
      )}
      {phase === 'confirm' && attempt && (
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{t('integrations.instagramByo.revokeWarning')}</p>
          <p className="text-sm text-slate-600">
            {t('integrations.instagramByo.revokeVersion', { version: attempt.expectedVersion })}
          </p>
        </div>
      )}
      {phase === 'edit' && (
        <button
          type="button"
          onClick={() => flow.confirm({ companyId, expectedVersion })}
          className="rounded-lg border border-slate-900 px-4 py-2 text-sm text-slate-900"
        >
          {t('integrations.instagramByo.revokeSubmit')}
        </button>
      )}
      {phase === 'confirm' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => flow.send(attempt)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {t('integrations.instagramByo.revokeConfirm')}
          </button>
          <button
            type="button"
            onClick={flow.cancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            {t('integrations.instagramByo.revokeCancel')}
          </button>
        </div>
      )}
      {phase === 'retryable' && attempt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => flow.send(attempt)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            {t('integrations.instagramByo.revokeRetry')}
          </button>
          <button type="button" onClick={flow.discard} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            {t('integrations.instagramByo.revokeDiscard')}
          </button>
        </div>
      )}
    </div>
  );
}

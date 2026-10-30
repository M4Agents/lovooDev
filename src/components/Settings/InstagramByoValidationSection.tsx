import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ByoStatusAccount, ByoStatusCredentials } from '../../services/instagramByoApi';
import {
  associateInstagramByoAccount,
  validateInstagramByoWithMeta,
  type ByoDiscoveredAccount,
} from '../../services/instagramByoValidationApi';

type Props = {
  companyId: string | null;
  canWrite: boolean;
  ready: boolean;
  credentials: ByoStatusCredentials | null;
  accounts: ByoStatusAccount[];
  onRefresh: () => void;
};

const VALIDATABLE = new Set(['saved', 'pending', 'valid', 'failed']);

const ERROR_KEY: Record<string, string> = {
  token_invalid: 'integrations.instagramByo.validateTokenInvalid',
  token_wrong_app: 'integrations.instagramByo.validateWrongApp',
  token_type_unsupported: 'integrations.instagramByo.validateUnsupportedToken',
  insufficient_permissions: 'integrations.instagramByo.validateMissingPermissions',
  conflict: 'integrations.instagramByo.validateConflict',
  temporary: 'integrations.instagramByo.validateTemporary',
  denied: 'integrations.instagramByo.statusDenied',
  not_discovered: 'integrations.instagramByo.associateNotDiscovered',
};

function requestId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function label(account: { instagram_username: string | null; instagram_account_id: string }) {
  return account.instagram_username ?? account.instagram_account_id;
}

export function InstagramByoValidationSection({
  companyId,
  canWrite,
  ready,
  credentials,
  accounts,
  onRefresh,
}: Props) {
  const { t } = useTranslation('settings.app');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<ByoDiscoveredAccount[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const associated = accounts.filter((account) => account.status_reason == null);
  const canValidate = Boolean(
    canWrite
    && companyId
    && ready
    && credentials?.configured
    && credentials.credential_version
    && VALIDATABLE.has(credentials.validation_status),
  );

  useEffect(() => {
    setBusy(false);
    setNotice(null);
    setDiscovered(null);
    setSelected(null);
    setVersion(null);
  }, [companyId]);

  async function validate() {
    if (!canValidate || !companyId || !credentials?.credential_version || busy) return;
    setBusy(true);
    setNotice(null);
    setDiscovered(null);
    setSelected(null);
    const result = await validateInstagramByoWithMeta({
      companyId,
      requestId: requestId(),
      expectedVersion: credentials.credential_version,
    });
    setBusy(false);
    if (result.kind !== 'ok') {
      setNotice(ERROR_KEY[result.kind] ?? ERROR_KEY.temporary);
      return;
    }
    setVersion(result.credentialVersion);
    if (result.validationStatus !== 'valid') {
      setNotice(ERROR_KEY[result.errorCode ?? ''] ?? ERROR_KEY.temporary);
      onRefresh();
      return;
    }
    setDiscovered(result.accounts);
    onRefresh();
  }

  async function confirm() {
    if (!companyId || !selected || version == null || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await associateInstagramByoAccount({
      companyId,
      requestId: requestId(),
      expectedVersion: version,
      instagramAccountId: selected,
    });
    setBusy(false);
    if (result.kind !== 'ok') {
      setNotice(ERROR_KEY[result.kind] ?? ERROR_KEY.temporary);
      return;
    }
    setDiscovered(null);
    setSelected(null);
    onRefresh();
  }

  if (!credentials?.configured && associated.length === 0) return null;

  return (
    <div className="space-y-3">
      {associated.map((account) => (
        <div key={account.id} className="space-y-1 text-sm text-slate-600">
          <p>
            {t('integrations.instagramByo.associatedAccount')}: {label(account)}
          </p>
          <p>{t('integrations.instagramByo.operationalPending')}</p>
        </div>
      ))}
      {canValidate && (
        <button
          type="button"
          disabled={busy}
          onClick={validate}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
        >
          {t('integrations.instagramByo.validateWithMeta')}
        </button>
      )}
      {busy && <p className="text-sm text-slate-600">{t('integrations.instagramByo.validateSending')}</p>}
      {notice && <p className="text-sm text-slate-600">{t(notice)}</p>}
      {discovered && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-900">
            {t('integrations.instagramByo.discoveredAccounts')}
          </legend>
          {discovered.length === 0 && (
            <p className="text-sm text-slate-600">{t('integrations.instagramByo.validateNoAccounts')}</p>
          )}
          {discovered.map((account) => (
            <label key={account.instagram_account_id} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="instagram-byo-account"
                value={account.instagram_account_id}
                checked={selected === account.instagram_account_id}
                onChange={() => setSelected(account.instagram_account_id)}
              />
              {label(account)}
            </label>
          ))}
          {discovered.length > 0 && (
            <button
              type="button"
              disabled={busy || selected == null}
              onClick={confirm}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              {t('integrations.instagramByo.confirmAccount')}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}

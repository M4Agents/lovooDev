import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getInstagramModality,
  switchInstagramModality,
  type ModalityAccount,
  type ModalityName,
  type ModalityReadResult,
} from '../../services/instagramModalityApi';

type Props = {
  companyId: string;
  canSwitch?: boolean;
};

type Phase = 'idle' | 'sending';

function labelOf(account: ModalityAccount): string {
  return account.official_connection?.username
    || account.byo_account?.username
    || account.instagram_account_id;
}

function destinationFor(account: ModalityAccount | null): ModalityName {
  return account?.operational_mode === 'byo' ? 'official' : 'byo';
}

export function InstagramModalitySection({ companyId, canSwitch = false }: Props) {
  const { t } = useTranslation('settings.app');
  const [result, setResult] = useState<ModalityReadResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<ModalityName>('byo');
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const seenCompany = useRef(companyId);
  const preferredId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (seenCompany.current !== companyId) {
      seenCompany.current = companyId;
      preferredId.current = null;
      setNotice(null);
      setConfirmed(false);
      setSelectedId(null);
    }
    setResult(null);
    setPhase('idle');
    getInstagramModality(companyId, controller.signal).then((next) => {
      if (!active || next.kind === 'cancelled') return;
      setResult(next);
      if (next.kind !== 'ok') return;
      const kept = next.state.accounts.find((item) => item.instagram_account_id === preferredId.current) ?? null;
      const chosen = kept ?? next.state.accounts[0] ?? null;
      setSelectedId(chosen?.instagram_account_id ?? null);
      setTarget(destinationFor(chosen));
      if (!kept) setConfirmed(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [companyId, reloadKey]);

  const accounts = result?.kind === 'ok' ? result.state.accounts : [];
  const available = result?.kind === 'ok' && result.state.switch_available === true;
  const account = accounts.find((item) => item.instagram_account_id === selectedId) ?? null;
  const destination = account?.targets[target];
  const canSubmit = Boolean(
    canSwitch
    && available
    && account
    && account.official_connection
    && account.byo_account
    && destination?.eligible
    && confirmed
    && phase !== 'sending',
  );

  function selectAccount(accountId: string) {
    const next = accounts.find((item) => item.instagram_account_id === accountId) ?? null;
    preferredId.current = next?.instagram_account_id ?? null;
    setSelectedId(next?.instagram_account_id ?? null);
    setTarget(destinationFor(next));
    setConfirmed(false);
    setNotice(null);
  }

  async function submit() {
    if (!canSubmit || !account?.official_connection || !account.byo_account || pending.current) return;
    pending.current = true;
    setPhase('sending');
    setNotice(null);
    const response = await switchInstagramModality({
      companyId,
      instagramAccountId: account.instagram_account_id,
      targetMode: target,
      officialConnectionId: account.official_connection.id,
      byoAccountId: account.byo_account.id,
      confirmed: true,
    });
    pending.current = false;
    setPhase('idle');
    if (response.kind === 'ok') {
      preferredId.current = account.instagram_account_id;
      setConfirmed(false);
      setNotice(response.reason === 'already_applied'
        ? 'integrations.instagramModality.alreadyApplied'
        : 'integrations.instagramModality.switched');
      setReloadKey((current) => current + 1);
      return;
    }
    if (response.kind === 'blocked') {
      setNotice(`integrations.instagramModality.block.${response.reason}`);
      return;
    }
    if (response.kind === 'confirmation_required') {
      setNotice('integrations.instagramModality.confirmationRequired');
      return;
    }
    if (response.kind === 'denied') {
      setNotice('integrations.instagramModality.denied');
      return;
    }
    setNotice('integrations.instagramModality.temporary');
  }

  return (
    <section className="mt-8 space-y-4 border-t border-slate-200 pt-6" aria-labelledby="instagram-modality-title">
      <div>
        <h3 id="instagram-modality-title" className="text-base font-semibold text-slate-900">
          {t('integrations.instagramModality.title')}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{t('integrations.instagramModality.description')}</p>
      </div>

      {result === null && <p className="text-sm text-slate-500">{t('integrations.instagramModality.loading')}</p>}
      {result?.kind === 'denied' && <p className="text-sm text-slate-600">{t('integrations.instagramModality.denied')}</p>}
      {result?.kind === 'temporary' && <p className="text-sm text-slate-600">{t('integrations.instagramModality.temporary')}</p>}
      {result?.kind === 'ok' && accounts.length === 0 && (
        <p className="text-sm text-slate-600">{t('integrations.instagramModality.empty')}</p>
      )}

      {account && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {accounts.length > 1 && (
            <label className="block text-sm text-slate-700">
              {t('integrations.instagramModality.account')}
              <select
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={account.instagram_account_id}
                onChange={(event) => selectAccount(event.target.value)}
              >
                {accounts.map((item) => (
                  <option key={item.instagram_account_id} value={item.instagram_account_id}>
                    {labelOf(item)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {account.mode_basis === 'registered' && (
            <p className="text-sm text-slate-800">
              {t('integrations.instagramModality.current', {
                account: labelOf(account),
                mode: t(`integrations.instagramModality.mode.${account.operational_mode ?? 'unknown'}`),
              })}
            </p>
          )}
          {account.mode_basis === 'compatibility' && (
            <p className="text-sm text-slate-800">
              {t('integrations.instagramModality.currentCompatibility', {
                account: labelOf(account),
                mode: t(`integrations.instagramModality.mode.${account.operational_mode ?? 'unknown'}`),
              })}
            </p>
          )}
          {account.mode_basis === 'none' && (
            <p className="text-sm text-slate-800">
              {t('integrations.instagramModality.currentUnknown', { account: labelOf(account) })}
            </p>
          )}
          {account.mode_basis === 'compatibility' && (
            <p className="text-sm text-slate-600">
              {t(account.official_receive_supported
                ? 'integrations.instagramModality.compatibilityActive'
                : 'integrations.instagramModality.compatibilityInactive')}
            </p>
          )}
          {account.direct_ingest_enabled && (
            <p className="text-sm text-slate-600">{t('integrations.instagramModality.flagIsNotMode')}</p>
          )}
          {(target === 'byo' || !account.send_supported) && (
            <p className="text-sm text-amber-800">{t('integrations.instagramModality.byoSendUnavailable')}</p>
          )}
          {canSwitch && !available && (
            <p className="text-sm text-slate-700">{t('integrations.instagramModality.switchUnavailable')}</p>
          )}

          <fieldset className="space-y-2" disabled={!canSwitch || !available || phase === 'sending'}>
            <legend className="text-sm font-medium text-slate-800">
              {t('integrations.instagramModality.destination')}
            </legend>
            {(['official', 'byo'] as const).map((mode) => {
              const option = account.targets[mode];
              return (
                <label key={mode} className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="instagram-modality-target"
                    value={mode}
                    checked={target === mode}
                    onChange={() => {
                      setTarget(mode);
                      setConfirmed(false);
                    }}
                  />
                  <span>
                    {t(`integrations.instagramModality.mode.${mode}`)}
                    {option.block_reason && (
                      <span className="mt-0.5 block text-slate-500">
                        {t(`integrations.instagramModality.block.${option.block_reason}`)}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {canSwitch && available && destination?.eligible && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">{t('integrations.instagramModality.transferAll')}</p>
              <p className="text-sm text-slate-700">{t('integrations.instagramModality.preserveHistory')}</p>
              <p className="text-sm text-slate-700">{t('integrations.instagramModality.affectsTraffic')}</p>
              {target === 'official' && account.mode_basis === 'compatibility' && (
                <p className="text-sm text-slate-700">{t('integrations.instagramModality.registerOfficial')}</p>
              )}
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={phase === 'sending'}
                />
                {t('integrations.instagramModality.confirmLabel')}
              </label>
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={!canSubmit}
                onClick={submit}
              >
                {phase === 'sending'
                  ? t('integrations.instagramModality.sending')
                  : t('integrations.instagramModality.submit')}
              </button>
            </div>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-slate-700">{t(notice)}</p>}
    </section>
  );
}

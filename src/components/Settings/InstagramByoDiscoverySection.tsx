import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  diagnoseInstagramByoConnection,
  type ByoDiscoveryReport,
  type ByoDiscoveryResult,
} from '../../services/instagramByoApi';

type Props = {
  companyId: string;
  canWrite: boolean;
};

const ROWS: Array<{ key: keyof ByoDiscoveryReport; label: string }> = [
  { key: 'app_identity', label: 'integrations.instagramByo.discoveryAppIdentity' },
  { key: 'instagram_basic', label: 'integrations.instagramByo.discoveryBasic' },
  { key: 'instagram_manage_messages', label: 'integrations.instagramByo.discoveryMessages' },
  { key: 'instagram_manage_comments', label: 'integrations.instagramByo.discoveryComments' },
  { key: 'expected_account', label: 'integrations.instagramByo.discoveryAccount' },
  { key: 'unified_login_read', label: 'integrations.instagramByo.discoveryRead' },
];

function tone(value: string): 'confirmed' | 'absent' | 'indeterminate' {
  if (value === 'compatible' || value === 'present' || value === 'found') return 'confirmed';
  if (value === 'indeterminate') return 'indeterminate';
  return 'absent';
}

function toneKey(value: string): string {
  const state = tone(value);
  if (state === 'confirmed') return 'integrations.instagramByo.discoveryConfirmed';
  if (state === 'absent') return 'integrations.instagramByo.discoveryAbsent';
  return 'integrations.instagramByo.discoveryIndeterminate';
}

function toneClass(value: string): string {
  const state = tone(value);
  if (state === 'confirmed') return 'text-green-700';
  if (state === 'absent') return 'text-slate-800';
  return 'text-slate-500';
}

function noticeKey(result: ByoDiscoveryResult): string | null {
  if (result.kind === 'unauthorized' || result.kind === 'session_unavailable') {
    return 'integrations.instagramByo.discoverySession';
  }
  if (result.kind === 'forbidden') return 'integrations.instagramByo.discoveryForbidden';
  if (result.kind === 'not_found') return 'integrations.instagramByo.discoveryNotFound';
  if (result.kind === 'unavailable') return 'integrations.instagramByo.discoveryUnavailable';
  if (result.kind === 'network' || result.kind === 'temporary') return 'integrations.instagramByo.discoveryNetwork';
  if (result.report.error_code === 'meta_unavailable') return 'integrations.instagramByo.discoveryMetaUnavailable';
  return null;
}

function reportOf(result: ByoDiscoveryResult): ByoDiscoveryReport | null {
  if (result.kind === 'ok' || result.kind === 'not_found') return result.report;
  if (result.kind === 'unavailable') return result.report;
  return null;
}

export function InstagramByoDiscoverySection({ companyId, canWrite }: Props) {
  const { t } = useTranslation('settings.app');
  const [phase, setPhase] = useState<'idle' | 'sending'>('idle');
  const [result, setResult] = useState<ByoDiscoveryResult | null>(null);
  const companyRef = useRef(companyId);
  const busy = useRef(false);

  useEffect(() => {
    companyRef.current = companyId;
    busy.current = false;
    setPhase('idle');
    setResult(null);
  }, [companyId]);

  if (!canWrite) return null;

  async function run() {
    if (busy.current) return;
    const captured = companyId;
    busy.current = true;
    setPhase('sending');
    const next = await diagnoseInstagramByoConnection(captured);
    if (companyRef.current !== captured) return;
    busy.current = false;
    setResult(next);
    setPhase('idle');
  }

  const report = result ? reportOf(result) : null;
  const notice = result ? noticeKey(result) : null;

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4" aria-labelledby="instagram-byo-discovery-title">
      <h4 id="instagram-byo-discovery-title" className="text-sm font-semibold text-slate-900">
        {t('integrations.instagramByo.discoveryAction')}
      </h4>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.discoveryWebhook')}</p>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.discoveryDisclaimer')}</p>
      <button
        type="button"
        disabled={phase === 'sending'}
        onClick={run}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
      >
        {phase === 'sending'
          ? t('integrations.instagramByo.discoverySending')
          : t('integrations.instagramByo.discoveryAction')}
      </button>
      {notice && <p className="text-sm text-slate-600">{t(notice)}</p>}
      {report && (
        <dl className="space-y-1 text-sm">
          {ROWS.map((row) => (
            <div key={row.key}>
              <dt className="inline text-slate-600">{t(row.label)}: </dt>
              <dd className={`inline ${toneClass(String(report[row.key]))}`}>{t(toneKey(String(report[row.key])))}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

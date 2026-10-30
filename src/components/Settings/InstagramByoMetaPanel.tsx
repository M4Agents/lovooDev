import { useTranslation } from 'react-i18next';

const FIELD_IDS = ['app-id', 'app-secret', 'suat'] as const;

export function InstagramByoMetaPanel() {
  const { t } = useTranslation('settings.app');

  return (
    <section className="space-y-6" aria-labelledby="instagram-byo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="instagram-byo-title" className="text-lg font-semibold text-slate-900">
            {t('integrations.instagramByo.title')}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">{t('integrations.instagramByo.description')}</p>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
          {t('integrations.instagramByo.badgePreparing')}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
        <p className="text-sm font-medium text-slate-900">{t('integrations.instagramByo.stateTitle')}</p>
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.stateCredentials')}</p>
        <p className="text-sm text-slate-600">{t('integrations.instagramByo.stateUnavailable')}</p>
      </div>

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

      <p className="text-sm text-slate-600">{t('integrations.instagramByo.encryptionNotice')}</p>
      <p className="text-sm text-slate-600">{t('integrations.instagramByo.officialIndependent')}</p>
    </section>
  );
}

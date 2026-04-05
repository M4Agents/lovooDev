import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsSystem from '../locales/pt-BR/settings.system.json'
import layout from '../locales/pt-BR/layout.json'
import layoutEn from '../locales/en/layout.json'
import layoutEs from '../locales/es/layout.json'
import auth from '../locales/pt-BR/auth.json'
import deletedInstances from '../locales/pt-BR/deletedInstances.json'
import analytics from '../locales/pt-BR/analytics.json'
import dashboard from '../locales/pt-BR/dashboard.json'
import notifications from '../locales/pt-BR/notifications.json'
import plans from '../locales/pt-BR/plans.json'
import mediaLibrary from '../locales/pt-BR/mediaLibrary.json'
import companies from '../locales/pt-BR/companies.json'
import reports from '../locales/pt-BR/reports.json'
import periodFilter from '../locales/pt-BR/periodFilter.json'
import settingsApp from '../locales/pt-BR/settings.app.json'
import funnel from '../locales/pt-BR/funnel.json'
import chat from '../locales/pt-BR/chat.json'
import { LOCALE_STORAGE_KEY, parseStoredLocale, syncDocumentLang } from './supportedLocales'

/** Idioma inicial: localStorage válido ou pt-BR (evita flicker se a chave já existir). */
function getInitialLanguage(): string {
  if (typeof window === 'undefined') return 'pt-BR'
  try {
    const parsed = parseStoredLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
    return parsed ?? 'pt-BR'
  } catch {
    return 'pt-BR'
  }
}

const sharedNamespaces = {
  'settings.system': settingsSystem,
  auth,
  deletedInstances,
  analytics,
  dashboard,
  notifications,
  plans,
  mediaLibrary,
  companies,
  reports,
  periodFilter,
  'settings.app': settingsApp,
  funnel,
  chat,
}

void i18n.use(initReactI18next).init(
  {
    lng: getInitialLanguage(),
    fallbackLng: 'pt-BR',
    resources: {
      'pt-BR': {
        ...sharedNamespaces,
        layout,
      },
      en: {
        ...sharedNamespaces,
        layout: layoutEn,
      },
      es: {
        ...sharedNamespaces,
        layout: layoutEs,
      },
    },
    ns: [
      'settings.system',
      'settings.app',
      'layout',
      'auth',
      'deletedInstances',
      'analytics',
      'dashboard',
      'notifications',
      'plans',
      'mediaLibrary',
      'companies',
      'reports',
      'periodFilter',
      'funnel',
      'chat',
    ],
    defaultNS: 'settings.system',
    interpolation: {
      escapeValue: true,
    },
  },
  () => {
    syncDocumentLang(i18n.language)
  }
)

export default i18n

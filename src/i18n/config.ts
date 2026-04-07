/**
 * i18n entry: locales pt-BR, en, es. Initial lng from localStorage (LOCALE_STORAGE_KEY) or pt-BR.
 * fallbackLng pt-BR. document.lang synced via syncDocumentLang. Language switch: LanguageSwitcher + localStorage only.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsSystemPt from '../locales/pt-BR/settings.system.json'
import settingsSystemEn from '../locales/en/settings.system.json'
import settingsSystemEs from '../locales/es/settings.system.json'
import layoutPt from '../locales/pt-BR/layout.json'
import layoutEn from '../locales/en/layout.json'
import layoutEs from '../locales/es/layout.json'
import authPt from '../locales/pt-BR/auth.json'
import authEn from '../locales/en/auth.json'
import authEs from '../locales/es/auth.json'
import deletedInstancesPt from '../locales/pt-BR/deletedInstances.json'
import deletedInstancesEn from '../locales/en/deletedInstances.json'
import deletedInstancesEs from '../locales/es/deletedInstances.json'
import analyticsPt from '../locales/pt-BR/analytics.json'
import analyticsEn from '../locales/en/analytics.json'
import analyticsEs from '../locales/es/analytics.json'
import dashboardPt from '../locales/pt-BR/dashboard.json'
import dashboardEn from '../locales/en/dashboard.json'
import dashboardEs from '../locales/es/dashboard.json'
import notificationsPt from '../locales/pt-BR/notifications.json'
import notificationsEn from '../locales/en/notifications.json'
import notificationsEs from '../locales/es/notifications.json'
import plansPt from '../locales/pt-BR/plans.json'
import plansEn from '../locales/en/plans.json'
import plansEs from '../locales/es/plans.json'
import mediaLibraryPt from '../locales/pt-BR/mediaLibrary.json'
import mediaLibraryEn from '../locales/en/mediaLibrary.json'
import mediaLibraryEs from '../locales/es/mediaLibrary.json'
import companiesPt from '../locales/pt-BR/companies.json'
import companiesEn from '../locales/en/companies.json'
import companiesEs from '../locales/es/companies.json'
import reportsPt from '../locales/pt-BR/reports.json'
import reportsEn from '../locales/en/reports.json'
import reportsEs from '../locales/es/reports.json'
import periodFilterPt from '../locales/pt-BR/periodFilter.json'
import periodFilterEn from '../locales/en/periodFilter.json'
import periodFilterEs from '../locales/es/periodFilter.json'
import settingsAppPt from '../locales/pt-BR/settings.app.json'
import settingsAppEn from '../locales/en/settings.app.json'
import settingsAppEs from '../locales/es/settings.app.json'
import funnelPt from '../locales/pt-BR/funnel.json'
import funnelEn from '../locales/en/funnel.json'
import funnelEs from '../locales/es/funnel.json'
import chatPt from '../locales/pt-BR/chat.json'
import chatEn from '../locales/en/chat.json'
import chatEs from '../locales/es/chat.json'
import agentsPt from '../locales/pt-BR/agents.json'
import agentsEn from '../locales/en/agents.json'
import agentsEs from '../locales/es/agents.json'
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

void i18n.use(initReactI18next).init(
  {
    lng: getInitialLanguage(),
    fallbackLng: 'pt-BR',
    resources: {
      'pt-BR': {
        'settings.system': settingsSystemPt,
        layout: layoutPt,
        auth: authPt,
        deletedInstances: deletedInstancesPt,
        analytics: analyticsPt,
        dashboard: dashboardPt,
        notifications: notificationsPt,
        plans: plansPt,
        mediaLibrary: mediaLibraryPt,
        companies: companiesPt,
        reports: reportsPt,
        periodFilter: periodFilterPt,
        'settings.app': settingsAppPt,
        funnel: funnelPt,
        chat: chatPt,
        agents: agentsPt,
      },
      en: {
        'settings.system': settingsSystemEn,
        layout: layoutEn,
        auth: authEn,
        deletedInstances: deletedInstancesEn,
        analytics: analyticsEn,
        dashboard: dashboardEn,
        notifications: notificationsEn,
        plans: plansEn,
        mediaLibrary: mediaLibraryEn,
        companies: companiesEn,
        reports: reportsEn,
        periodFilter: periodFilterEn,
        'settings.app': settingsAppEn,
        funnel: funnelEn,
        chat: chatEn,
        agents: agentsEn,
      },
      es: {
        'settings.system': settingsSystemEs,
        layout: layoutEs,
        auth: authEs,
        deletedInstances: deletedInstancesEs,
        analytics: analyticsEs,
        dashboard: dashboardEs,
        notifications: notificationsEs,
        plans: plansEs,
        mediaLibrary: mediaLibraryEs,
        companies: companiesEs,
        reports: reportsEs,
        periodFilter: periodFilterEs,
        'settings.app': settingsAppEs,
        funnel: funnelEs,
        chat: chatEs,
        agents: agentsEs,
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
      'agents',
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

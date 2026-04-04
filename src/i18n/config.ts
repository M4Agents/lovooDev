import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsSystem from '../locales/pt-BR/settings.system.json'
import layout from '../locales/pt-BR/layout.json'
import auth from '../locales/pt-BR/auth.json'
import deletedInstances from '../locales/pt-BR/deletedInstances.json'
import analytics from '../locales/pt-BR/analytics.json'
import dashboard from '../locales/pt-BR/dashboard.json'
import notifications from '../locales/pt-BR/notifications.json'
import plans from '../locales/pt-BR/plans.json'
import mediaLibrary from '../locales/pt-BR/mediaLibrary.json'
import companies from '../locales/pt-BR/companies.json'

void i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  resources: {
    'pt-BR': {
      'settings.system': settingsSystem,
      layout,
      auth,
      deletedInstances,
      analytics,
      dashboard,
      notifications,
      plans,
      mediaLibrary,
      companies,
    },
  },
  ns: ['settings.system', 'layout', 'auth', 'deletedInstances', 'analytics', 'dashboard', 'notifications', 'plans', 'mediaLibrary', 'companies'],
  defaultNS: 'settings.system',
  interpolation: {
    escapeValue: true,
  },
})

export default i18n

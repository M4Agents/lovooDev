import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsSystem from '../locales/pt-BR/settings.system.json'
import layout from '../locales/pt-BR/layout.json'
import auth from '../locales/pt-BR/auth.json'

void i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  resources: {
    'pt-BR': {
      'settings.system': settingsSystem,
      layout,
      auth,
    },
  },
  ns: ['settings.system', 'layout', 'auth'],
  defaultNS: 'settings.system',
  interpolation: {
    escapeValue: true,
  },
})

export default i18n

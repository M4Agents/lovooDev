import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import settingsSystem from '../locales/pt-BR/settings.system.json'

void i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  resources: {
    'pt-BR': {
      'settings.system': settingsSystem,
    },
  },
  ns: ['settings.system'],
  defaultNS: 'settings.system',
  interpolation: {
    escapeValue: true,
  },
})

export default i18n

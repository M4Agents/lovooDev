import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import i18n from '../i18n/config'
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  syncDocumentLang,
  type AppLocale,
} from '../i18n/supportedLocales'

type LanguageSwitcherProps = {
  collapsed: boolean
}

function normalizeToAppLocale(lng: string): AppLocale {
  if (lng === 'pt-BR' || lng.startsWith('pt')) return 'pt-BR'
  if (lng === 'es' || lng.startsWith('es')) return 'es'
  if (lng === 'en' || lng.startsWith('en')) return 'en'
  return 'pt-BR'
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ collapsed }) => {
  const { t } = useTranslation('layout')
  const [menuOpen, setMenuOpen] = useState(false)
  const current = normalizeToAppLocale(i18n.language)

  useEffect(() => {
    const onChange = (next: string) => syncDocumentLang(next)
    syncDocumentLang(i18n.language)
    i18n.on('languageChanged', onChange)
    return () => {
      i18n.off('languageChanged', onChange)
    }
  }, [])

  const selectLanguage = async (code: AppLocale) => {
    await i18n.changeLanguage(code)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code)
    } catch {
      /* ignore quota / private mode */
    }
    syncDocumentLang(code)
    setMenuOpen(false)
  }

  const optionClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-xs transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-slate-200 hover:bg-slate-700/80'
    }`

  const renderOptions = () =>
    SUPPORTED_LOCALES.map((loc) => {
      const active = current === loc.code
      const label = t('language.optionTitle', { name: loc.nativeName, code: loc.code })
      return (
        <button
          key={loc.code}
          type="button"
          onClick={() => void selectLanguage(loc.code)}
          className={optionClass(active)}
          aria-pressed={active}
          aria-label={label}
          title={label}
        >
          <span aria-hidden className="shrink-0 text-base leading-none">
            {loc.flag}
          </span>
          <span className="flex-1 min-w-0 font-medium truncate">{loc.nativeName}</span>
          <span
            className={`shrink-0 font-mono tabular-nums ${active ? 'text-blue-100' : 'text-slate-400'}`}
          >
            {loc.code}
          </span>
        </button>
      )
    })

  if (collapsed) {
    return (
      <div className="relative flex justify-center w-full">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={`p-2 rounded-xl transition-colors ${
            menuOpen ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t('language.collapsedToggleAriaLabel')}
          title={t('language.collapsedToggleAriaLabel')}
        >
          <Globe className="w-5 h-5" aria-hidden />
        </button>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-[60] bg-black/40 lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden
            />
            <div
              role="menu"
              aria-label={t('language.collapsedMenuAriaLabel')}
              className="fixed bottom-20 left-4 right-4 z-[70] lg:absolute lg:left-0 lg:right-auto lg:bottom-full lg:mb-2 lg:w-56 bg-slate-800 border border-slate-600 rounded-xl p-2 shadow-xl"
            >
              {renderOptions()}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      className="space-y-2 pt-2 border-t border-slate-700/50"
      role="group"
      aria-label={t('language.selectorAriaLabel')}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('language.sectionLabel')}
      </p>
      <div className="flex flex-col gap-1">{renderOptions()}</div>
    </div>
  )
}

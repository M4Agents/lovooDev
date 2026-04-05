import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import i18n from '../i18n/config'
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  getLocaleMeta,
  syncDocumentLang,
  type AppLocale,
} from '../i18n/supportedLocales'

export type LanguageSwitcherVariant = 'expanded' | 'collapsed'

type LanguageSwitcherProps = {
  variant: LanguageSwitcherVariant
}

function normalizeToAppLocale(lng: string): AppLocale {
  if (lng === 'pt-BR' || lng.startsWith('pt')) return 'pt-BR'
  if (lng === 'es' || lng.startsWith('es')) return 'es'
  if (lng === 'en' || lng.startsWith('en')) return 'en'
  return 'pt-BR'
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant }) => {
  const { t } = useTranslation('layout')
  const [menuOpen, setMenuOpen] = useState(false)
  const current = normalizeToAppLocale(i18n.language)
  const currentMeta = getLocaleMeta(current) ?? SUPPORTED_LOCALES[0]

  useEffect(() => {
    const onChange = (next: string) => syncDocumentLang(next)
    syncDocumentLang(i18n.language)
    i18n.on('languageChanged', onChange)
    return () => {
      i18n.off('languageChanged', onChange)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

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

  const triggerAriaLabel = t('language.optionTitle', {
    name: currentMeta.nativeName,
    code: currentMeta.code,
  })

  const menuPanel = menuOpen ? (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 lg:hidden"
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />
      <div
        role="menu"
        aria-label={t('language.collapsedMenuAriaLabel')}
        className={
          variant === 'collapsed'
            ? 'fixed bottom-20 left-4 right-4 z-[70] lg:absolute lg:left-0 lg:right-auto lg:bottom-full lg:mb-2 lg:w-56 bg-slate-800 border border-slate-600 rounded-xl p-2 shadow-xl'
            : 'fixed bottom-20 left-4 right-4 z-[70] lg:absolute lg:top-full lg:bottom-auto lg:left-auto lg:right-0 lg:mt-1 lg:w-56 bg-slate-800 border border-slate-600 rounded-xl p-2 shadow-xl'
        }
      >
        {renderOptions()}
      </div>
    </>
  ) : null

  if (variant === 'collapsed') {
    return (
      <div className="relative flex justify-center w-full">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={`p-2 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
            menuOpen ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t('language.collapsedToggleAriaLabel')}
          title={t('language.collapsedToggleAriaLabel')}
        >
          <Globe className="w-5 h-5" aria-hidden />
        </button>
        {menuPanel}
      </div>
    )
  }

  /* expanded: globo + código ao lado do plano */
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors min-h-[32px] ${
          menuOpen
            ? 'border-blue-500 bg-slate-700 text-white'
            : 'border-slate-600/90 bg-slate-800/90 text-slate-200 hover:border-slate-500 hover:bg-slate-700/90'
        }`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={triggerAriaLabel}
        title={triggerAriaLabel}
      >
        <Globe className="w-3.5 h-3.5 shrink-0 text-slate-300" aria-hidden />
        <span className="font-mono tabular-nums text-[10px] sm:text-xs text-slate-200">{currentMeta.code}</span>
      </button>
      {menuPanel}
    </div>
  )
}

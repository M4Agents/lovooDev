/** localStorage key for UI language (client-only; no backend persistence in this phase). */
export const LOCALE_STORAGE_KEY = 'lovoo_crm_ui_locale'

export type AppLocale = 'pt-BR' | 'en' | 'es'

export type SupportedLocale = {
  code: AppLocale
  /** Nome do idioma no próprio idioma (sempre visível na UI). */
  nativeName: string
  /** Apoio visual; não substitui nome nem código. */
  flag: string
  /** Valor para document.documentElement.lang (BCP 47). */
  htmlLang: string
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  { code: 'pt-BR', nativeName: 'Português (Brasil)', flag: '🇧🇷', htmlLang: 'pt-BR' },
  { code: 'en', nativeName: 'English', flag: '🇺🇸', htmlLang: 'en' },
  { code: 'es', nativeName: 'Español', flag: '🇪🇸', htmlLang: 'es' },
]

const codes = new Set(SUPPORTED_LOCALES.map((l) => l.code))

export function parseStoredLocale(raw: string | null): AppLocale | null {
  if (!raw || !codes.has(raw as AppLocale)) return null
  return raw as AppLocale
}

export function getLocaleMeta(code: string): SupportedLocale | undefined {
  return SUPPORTED_LOCALES.find((l) => l.code === code)
}

/** Sincroniza <html lang> com o idioma ativo (acessibilidade). */
export function syncDocumentLang(i18nLanguage: string): void {
  if (typeof document === 'undefined') return
  const meta = getLocaleMeta(i18nLanguage) ?? getLocaleMeta('pt-BR')
  document.documentElement.lang = meta?.htmlLang ?? 'pt-BR'
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // VITE_SUPABASE_SERVICE_ROLE_KEY e SUPABASE_SERVICE_ROLE_KEY foram removidos
  // intencionalmente. service_role jamais deve estar disponível no browser.
  // Usar APENAS em api/ (Vercel Functions / Node.js) via process.env.
  /** Opcional: UUID da empresa Pai (deve ser igual a PARENT_COMPANY_ID no servidor). */
  readonly VITE_PARENT_COMPANY_ID?: string
  readonly VITE_FEATURE_TAG_GROUPS?: string
  /** Só a string "true" exibe Abrir chat na lista de Leads. Definir apenas no LovooDev. */
  readonly VITE_FEATURE_LEADS_OPEN_CHAT?: string
  /**
   * Diagnóstico de gravação de áudio no chat Meta.
   * Somente a string exata "true" habilita, e apenas em hostname DEV allowlist.
   * Ausente/outro valor = desligado. Nunca ligar em produção.
   */
  readonly VITE_META_AUDIO_RECORDER_DIAGNOSTIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

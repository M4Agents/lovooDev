/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // VITE_SUPABASE_SERVICE_ROLE_KEY e SUPABASE_SERVICE_ROLE_KEY foram removidos
  // intencionalmente. service_role jamais deve estar disponível no browser.
  // Usar APENAS em api/ (Vercel Functions / Node.js) via process.env.
  /** Opcional: UUID da empresa Pai (deve ser igual a PARENT_COMPANY_ID no servidor). */
  readonly VITE_PARENT_COMPANY_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

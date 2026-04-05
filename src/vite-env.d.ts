/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SUPABASE_SERVICE_ROLE_KEY: string
  readonly SUPABASE_SERVICE_ROLE_KEY: string // Variável do Vercel sem prefixo VITE_
  /** Opcional: UUID da empresa Pai (deve ser igual a PARENT_COMPANY_ID no servidor). */
  readonly VITE_PARENT_COMPANY_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

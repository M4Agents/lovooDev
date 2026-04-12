// =====================================================
// SUPABASE ADMIN CLIENT (ESM)
// Usa service_role — apenas no backend (api/).
// Nunca expor no frontend.
// =====================================================

import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!url || !key) {
    throw new Error(
      '[supabaseAdmin] Variáveis ausentes: VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

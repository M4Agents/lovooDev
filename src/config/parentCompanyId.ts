// =====================================================
// UUID da empresa Pai — usado no frontend (Vite).
// Deve coincidir com lib/openai/config.ts (servidor) e com RLS no Supabase.
// Vercel: defina VITE_PARENT_COMPANY_ID igual a PARENT_COMPANY_ID.
// =====================================================

const DEFAULT_PARENT_COMPANY_ID = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'

export const PARENT_COMPANY_ID =
  (import.meta.env.VITE_PARENT_COMPANY_ID as string | undefined)?.trim() ||
  DEFAULT_PARENT_COMPANY_ID

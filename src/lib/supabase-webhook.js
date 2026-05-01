import { createClient } from '@supabase/supabase-js';

// Cliente Supabase para uso em webhooks Node.js (process.env, sem import.meta.env)

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase-Webhook] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configuradas.');
}

// Criar cliente Supabase para webhook
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para verificar se está configurado
export const isSupabaseConfigured = () => {
  return Boolean(supabaseUrl && supabaseAnonKey);
};

import { createClient } from '@supabase/supabase-js';

// 🔧 VERSÃO WEBHOOK: Cliente Supabase sem dependência de import.meta.env
// Esta versão é específica para uso em webhooks Node.js onde import.meta.env não existe

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

// Debug: Log configurações - FORÇADO PARA M4_DIGITAL
console.log('🔧 [Supabase-Webhook] M4_Digital URL:', supabaseUrl);
console.log('🔧 [Supabase-Webhook] M4_Digital Key (first 20 chars):', supabaseAnonKey.substring(0, 20) + '...');

// Criar cliente Supabase para webhook
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para verificar se está configurado
export const isSupabaseConfigured = () => {
  // Sempre retorna true pois estamos forçando configuração M4_Digital
  return true;
};

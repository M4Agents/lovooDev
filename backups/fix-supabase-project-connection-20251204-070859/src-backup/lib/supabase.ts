import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY2NDg1MDMsImV4cCI6MjAzMjIyNDUwM30.f1qVXhFaOCIaOZQlhEGQNBMOGvQIyJHGKGCzJUqCKYNJFI';

// Debug: Log configurações
console.log('[Supabase] URL:', supabaseUrl);
console.log('[Supabase] Key (first 20 chars):', supabaseAnonKey.substring(0, 20) + '...');

// Criar cliente com valores padrão se as variáveis não estiverem configuradas
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Função para verificar se o Supabase está configurado
export const isSupabaseConfigured = () => {
  return import.meta.env.VITE_SUPABASE_URL && 
         import.meta.env.VITE_SUPABASE_ANON_KEY &&
         import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder.supabase.co';
};

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  api_key: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  plan: 'basic' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'cancelled';
  user_id: string;
  parent_company_id: string | null;
  company_type: 'parent' | 'client';
  is_super_admin: boolean;
  created_at: string;
  updated_at: string;
  
  // Dados Principais
  nome_fantasia?: string;
  razao_social?: string;
  cnpj?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  tipo_empresa?: string;
  porte_empresa?: string;
  ramo_atividade?: string;
  data_fundacao?: string;
  site_principal?: string;
  descricao_empresa?: string;
  
  // Endereço
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  pais?: string;
  endereco_correspondencia?: any;
  
  // Contatos
  telefone_principal?: string;
  telefone_secundario?: string;
  whatsapp?: string;
  email_principal?: string;
  email_comercial?: string;
  email_financeiro?: string;
  email_suporte?: string;
  responsavel_principal?: { nome: string; cargo: string };
  contato_financeiro?: { nome: string; email: string; telefone: string };
  
  // Domínios e URLs
  dominios_secundarios?: string[];
  urls_landing_pages?: string[];
  redes_sociais?: { facebook?: string; instagram?: string; linkedin?: string; twitter?: string; youtube?: string };
  url_google_business?: string;
};

export type LandingPage = {
  id: string;
  company_id: string;
  name: string;
  url: string;
  tracking_code: string;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string;
};

export type Visitor = {
  id: string;
  landing_page_id: string;
  session_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  screen_resolution: string | null;
  referrer: string | null;
  created_at: string;
};

export type BehaviorEvent = {
  id: string;
  visitor_id: string;
  event_type: 'click' | 'scroll' | 'hover' | 'form_interaction' | 'page_view' | 'section_view';
  event_data: Record<string, any>;
  coordinates: { x: number; y: number } | null;
  element_selector: string | null;
  section: string | null;
  timestamp: string;
};

export type Conversion = {
  id: string;
  visitor_id: string;
  landing_page_id: string;
  form_data: Record<string, any>;
  behavior_summary: Record<string, any>;
  engagement_score: number;
  time_to_convert: number;
  webhook_sent: boolean;
  webhook_response: Record<string, any> | null;
  converted_at: string;
};

export type WebhookLog = {
  id: string;
  company_id: string;
  conversion_id: string | null;
  webhook_url: string;
  payload: Record<string, any>;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  sent_at: string;
};

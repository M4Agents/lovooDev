import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configuradas.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured = () => {
  return Boolean(supabaseUrl && supabaseAnonKey);
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
  timezone: string;
  /** ISO 4217 — padrão para novos registros; default no banco BRL */
  default_currency?: string;
  /** Feature: composição de oportunidade por itens (pro/enterprise + flag) */
  opportunity_items_enabled?: boolean;
  /** ISO 3166-1 alpha-2 — opcional; contexto; não define moeda */
  country_code?: string | null;
  /** Escopo de dispensa de alertas do dashboard: 'company' = compartilhada, 'user' = individual */
  alert_dismissal_scope?: 'company' | 'user';
  /** Quando true, usuários sem view_all_leads só veem leads atribuídos a eles (enforcement via RLS) */
  restrict_leads_to_owner?: boolean;
  /** Quando true, sellers visualizam apenas conversas de chat onde assigned_to = próprio uid ou assigned_to IS NULL */
  chat_visibility_by_assigned_to?: boolean;
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
  horario_atendimento?: string;
  
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
  ponto_referencia?: string;
  
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

/** visitors.id — PK da linha de visita (visit_id) */
export type VisitId = string;
/** visitors.visitor_id — UUID persistente no browser (persistent_visitor_id) */
export type PersistentVisitorId = string;
/** visitors.session_id — sessão da aba/browser */
export type TrackingSessionId = string;

export type LeadCustomValue = {
  field_id: string;
  value: string;
  lead_custom_fields: {
    field_name: string;
    field_label: string;
    field_type: string;
  };
};

/**
 * Row de `visitors`.
 * - `id` = visit_id (PK da visita)
 * - `visitor_id` = persistent_visitor_id (coluna real; não renomear)
 * - `session_id` = TrackingSessionId
 */
export type Visitor = {
  /** visit_id — PK da visita */
  id: VisitId;
  landing_page_id: string;
  session_id: TrackingSessionId;
  /** persistent_visitor_id — coluna real `visitors.visitor_id` */
  visitor_id: PersistentVisitorId | null;
  ip_address: string | null;
  user_agent: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  screen_resolution: string | null;
  referrer: string | null;
  timezone: string | null;
  language: string | null;
  created_at: string;
};

export type BehaviorEvent = {
  id: string;
  /** FK para `visitors.id` (visit_id), não persistent_visitor_id */
  visitor_id: VisitId;
  event_type: 'click' | 'scroll' | 'hover' | 'form_interaction' | 'page_view' | 'section_view';
  event_data: Record<string, any>;
  coordinates: { x: number; y: number } | null;
  element_selector: string | null;
  section: string | null;
  timestamp: string;
};

export type Conversion = {
  id: string;
  /** FK para `visitors.id` (visit_id), não persistent_visitor_id */
  visitor_id: VisitId;
  landing_page_id: string;
  form_data: Record<string, any>;
  behavior_summary: Record<string, any>;
  engagement_score: number;
  time_to_convert: number;
  webhook_sent: boolean;
  webhook_response: Record<string, any> | null;
  converted_at: string;
};

/**
 * Lead canônico (CRM).
 * `visitor_id` (TEXT) armazena persistent_visitor_id — sem FK para `visitors.id`.
 * Demais opcionais usam `?: string` (compatível com interfaces locais e hooks).
 */
export type Lead = {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  status: string;
  interest?: string;
  responsible_user_id?: string;
  /** persistent_visitor_id (TEXT, sem FK) — compatibilidade temporária */
  visitor_id?: string | null;
  record_type?: string;
  created_at?: string;
  updated_at?: string;
  last_contact_at?: string;
  is_over_plan?: boolean;

  instagram?: string;
  linkedin?: string;
  tiktok?: string;

  cargo?: string;
  poder_investimento?: string;

  data_nascimento?: string;
  cep?: string;
  estado?: string;
  cidade?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;

  campanha?: string;
  conjunto_anuncio?: string;
  anuncio?: string;
  /** First-touch UTM source (coluna leads.utm_source) */
  utm_source?: string | null;
  utm_medium?: string | null;

  company_name?: string;
  company_cnpj?: string;
  company_razao_social?: string;
  company_nome_fantasia?: string;
  company_cep?: string;
  company_cidade?: string;
  company_estado?: string;
  company_endereco?: string;
  company_telefone?: string;
  company_email?: string;
  company_site?: string;

  lead_custom_values?: LeadCustomValue[];
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

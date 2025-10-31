import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  created_at: string;
  updated_at: string;
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

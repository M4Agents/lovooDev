import { supabase } from '../lib/supabase';

export interface WelcomePopupCampaign {
  id: string | null;
  company_id: string;
  nuvemshop_store_id: string;
  enabled: false;
  page_rule: 'home';
  title: string | null;
  description: string | null;
  image_url: string | null;
  button_label: string | null;
  background_color: string | null;
  text_color: string | null;
  button_color: string | null;
  consent_text: string | null;
  consent_version: string | null;
  coupon_code: string | null;
  delay_seconds: number | null;
  resurface_days: number | null;
  updated_at: string | null;
}

export interface WelcomePopupDraft {
  enabled: false;
  title: string;
  description: string;
  image_url: string;
  button_label: string;
  background_color: string;
  text_color: string;
  button_color: string;
  consent_text: string;
  consent_version: string;
  coupon_code: string;
  delay_seconds: string;
  resurface_days: string;
}

async function authToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function welcomePopupError(json: { error?: string; field?: string }, fallback: string): Error {
  const error = new Error(json.error ?? fallback) as Error & { field?: string };
  if (json.field) error.field = json.field;
  return error;
}

export async function getWelcomePopup(
  companyId: string,
  storeId: string,
): Promise<WelcomePopupCampaign> {
  const token = await authToken();
  if (!token) throw new Error('Sessão expirada.');
  const params = new URLSearchParams({ company_id: companyId, store_id: storeId });
  const res = await fetch(`/api/nuvemshop/welcome-popup?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw welcomePopupError(json, 'Erro ao carregar o pop-up.');
  return json.campaign as WelcomePopupCampaign;
}

export async function saveWelcomePopup(
  companyId: string,
  storeId: string,
  payload: WelcomePopupDraft,
): Promise<WelcomePopupCampaign> {
  const token = await authToken();
  if (!token) throw new Error('Sessão expirada.');
  const res = await fetch('/api/nuvemshop/welcome-popup', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_id: companyId,
      store_id: storeId,
      ...payload,
      enabled: false,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw welcomePopupError(json, 'Erro ao salvar o rascunho.');
  return json.campaign as WelcomePopupCampaign;
}

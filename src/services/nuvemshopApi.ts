// =============================================================================
// nuvemshopApi — serviço de chamadas ao backend Nuvemshop
//
// Toda comunicação com a API Nuvemshop passa pelo backend.
// Nenhuma chamada direta à API da Nuvemshop é feita aqui.
//
// Endpoints consumidos:
//   GET  /api/nuvemshop/connect/status?company_id=
//   POST /api/nuvemshop/connect/initiate  { company_id }
//   POST /api/nuvemshop/connect/disconnect { company_id }
//   GET  /api/nuvemshop/tabs/lead?lead_id=&company_id=
//   GET  /api/nuvemshop/tabs/opportunity?opportunity_id=&company_id=
//   GET  /api/nuvemshop/tabs/checkout-url?lead_id=&company_id=
// =============================================================================

import { supabase } from '../lib/supabase';

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type NuvemshopHealthStatus = 'healthy' | 'warning' | 'critical' | 'disconnected';

export interface NuvemshopConnectionStatus {
  connected:       boolean;
  status:          string | null;
  metadata_status: string | null;
  store_name:      string | null;
  store_domain:    string | null;
  currency:        string | null;
  country:         string | null;
  plan_name:       string | null;
  connected_at:    string | null;
  disconnected_at: string | null;
  last_sync_at:    string | null;
  last_webhook_at: string | null;
  last_success_at: string | null;
  last_error_at:   string | null;
  health_status:   NuvemshopHealthStatus;
  actions: {
    can_connect:    boolean;
    can_disconnect: boolean;
    can_sync:       boolean;
    can_replay:     boolean;
  };
}

// ── Funções ───────────────────────────────────────────────────────────────────

/**
 * Retorna o status público e seguro da integração Nuvemshop da empresa.
 */
export async function getNuvemshopStatus(companyId: string): Promise<NuvemshopConnectionStatus> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const res = await fetch(
    `/api/nuvemshop/connect/status?company_id=${encodeURIComponent(companyId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao buscar status da integração Nuvemshop.');

  return json as NuvemshopConnectionStatus;
}

/**
 * Inicia o fluxo OAuth Nuvemshop.
 * Em caso de sucesso, redireciona o navegador para a URL de autorização.
 */
export async function initiateNuvemshopConnect(companyId: string): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const res = await fetch('/api/nuvemshop/connect/initiate', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ company_id: companyId }),
  });

  const json = await res.json();

  if (!res.ok) throw new Error(json.error ?? 'Não foi possível iniciar a conexão com Nuvemshop.');
  if (!json.authUrl) throw new Error('URL de autorização não recebida.');

  // Redirecionar para o OAuth Nuvemshop
  window.location.href = json.authUrl;
}

/**
 * Desconecta a integração Nuvemshop da empresa.
 */
export async function disconnectNuvemshop(companyId: string): Promise<void> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const res = await fetch('/api/nuvemshop/connect/disconnect', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ company_id: companyId }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao desconectar a integração Nuvemshop.');
}

// ── Tipos das abas ─────────────────────────────────────────────────────────

export type NuvemshopIntegrationStatus = 'active' | 'disconnected' | 'none';

export interface NuvemshopLeadTabData {
  has_nuvemshop:         boolean;
  integration_status:    NuvemshopIntegrationStatus;
  store_name:            string | null;
  nuvemshop_customer_id: string | null;
  nuvemshop_store_id:    string | null;
  nuvemshop_checkout_id: string | null;
  cart_total:            number | null;
  cart_items:            NuvemshopCartItem[];
  nuvemshop_sync_status: string | null;
  synced_at:             string | null;
}

export interface NuvemshopCartItem {
  product_id: number | null;
  variant_id: number | null;
  name:       string | null;
  sku:        string | null;
  quantity:   number;
  price:      number;
  currency:   string | null;
}

export interface NuvemshopTimelineEvent {
  id:              string;
  event_type:      string;
  label:           string;
  tracking_number: string | null;
  carrier:         string | null;
  raw_status:      string | null;
  occurred_at:     string;
  created_at:      string;
}

export interface NuvemshopOpportunityTabData {
  has_nuvemshop:                boolean;
  integration_status:           NuvemshopIntegrationStatus;
  store_name:                   string | null;
  nuvemshop_order_id:           string | null;
  nuvemshop_store_id:           string | null;
  nuvemshop_raw_status:         string | null;
  nuvemshop_sync_status:        string | null;
  nuvemshop_fulfillment_status: string | null;
  nuvemshop_tracking_number:    string | null;
  nuvemshop_tracking_url:       string | null;
  nuvemshop_shipping_carrier:   string | null;
  payment_status:               string | null;
  payment_method:               string | null;
  installments:                 number | null;
  brand:                        string | null;
  captured_amount:              number | null;
  timeline:                     NuvemshopTimelineEvent[];
}

// ── Funções das abas ───────────────────────────────────────────────────────

/**
 * Busca os dados Nuvemshop de um Lead para exibição na aba.
 * Nunca inclui checkout_url — use getNuvemshopCheckoutUrl para isso.
 */
export async function getNuvemshopLeadTab(
  leadId: string,
  companyId: string,
): Promise<NuvemshopLeadTabData> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const params = new URLSearchParams({ lead_id: leadId, company_id: companyId });
  const res = await fetch(`/api/nuvemshop/tabs/lead?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao buscar dados Nuvemshop do lead.');

  return json as NuvemshopLeadTabData;
}

/**
 * Busca os dados Nuvemshop de uma Oportunidade para exibição na aba.
 */
export async function getNuvemshopOpportunityTab(
  opportunityId: string,
  companyId: string,
): Promise<NuvemshopOpportunityTabData> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const params = new URLSearchParams({ opportunity_id: opportunityId, company_id: companyId });
  const res = await fetch(`/api/nuvemshop/tabs/opportunity?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao buscar dados Nuvemshop da oportunidade.');

  return json as NuvemshopOpportunityTabData;
}

/**
 * Busca o checkout_url de um Lead.
 * Endpoint restrito: apenas roles com permissão de gestão podem acessar.
 * Deve ser chamado somente quando o usuário clicar explicitamente em "Ver link".
 */
export async function getNuvemshopCheckoutUrl(
  leadId: string,
  companyId: string,
): Promise<{ checkout_url: string | null }> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const params = new URLSearchParams({ lead_id: leadId, company_id: companyId });
  const res = await fetch(`/api/nuvemshop/tabs/checkout-url?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Sem permissão para acessar este link.');

  return json as { checkout_url: string | null };
}

// ── Tipos do Dashboard Operacional ────────────────────────────────────────────

export interface NuvemshopMetricsConnection {
  store_name:      string | null;
  store_domain:    string | null;
  plan_name:       string | null;
  status:          string;
  script_status:   string | null;
  script_active:   boolean;
  connected_at:    string | null;
  disconnected_at: string | null;
  last_sync_at:    string | null;
}

export interface NuvemshopMetricsHealth {
  status:              NuvemshopHealthStatus;
  last_webhook_at:     string | null;
  last_success_at:     string | null;
  last_error_at:       string | null;
  last_error_message:  string | null;
  metadata_status:     string | null;
}

export interface NuvemshopMetricsEvents {
  pending:           number;
  processing:        number;
  processed:         number;
  failed:            number;
  dead:              number;
  skipped:           number;
  replayed:          number;
  avg_processing_ms: number | null;
}

export interface NuvemshopMetricsResources {
  leads:      number;
  orders:     number;
  products:   number;
  categories: number;
  checkouts:  number;
}

export interface NuvemshopCheckpointInfo {
  sync_type:        string;
  status:           string;
  total_processed:  number;
  total_errors:     number;
  last_activity_at: string | null;
}

export interface NuvemshopMetricsActions {
  can_connect:          boolean;
  can_disconnect:       boolean;
  can_replay:           boolean;
  can_force_resync:     boolean;
  can_reset_checkpoint: boolean;
  can_validate:         boolean;
}

export interface NuvemshopMetrics {
  connected:   boolean;
  connection:  NuvemshopMetricsConnection | null;
  health:      NuvemshopMetricsHealth;
  events:      NuvemshopMetricsEvents | null;
  resources:   NuvemshopMetricsResources | null;
  checkpoints: NuvemshopCheckpointInfo[];
  actions:     NuvemshopMetricsActions;
}

// ── Funções do Dashboard ──────────────────────────────────────────────────────

export async function getNuvemshopMetrics(companyId: string): Promise<NuvemshopMetrics> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada. Recarregue a página.');

  const params = new URLSearchParams({ company_id: companyId });
  const res = await fetch(`/api/nuvemshop/connect/metrics?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar métricas.');
  return json as NuvemshopMetrics;
}

async function adminPost(path: string, body: object): Promise<unknown> {
  const token = await getAuthToken();
  if (!token) throw new Error('Sessão expirada.');

  const res = await fetch(path, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro na operação administrativa.');
  return json;
}

export async function replayNuvemshopEvent(companyId: string, eventId: string) {
  return adminPost('/api/nuvemshop/admin/replay-event', { company_id: companyId, event_id: eventId });
}

export async function forceNuvemshopResync(companyId: string) {
  return adminPost('/api/nuvemshop/admin/force-resync', { company_id: companyId });
}

export async function resetNuvemshopCheckpoint(companyId: string, syncType: string) {
  return adminPost('/api/nuvemshop/admin/reset-checkpoint', { company_id: companyId, sync_type: syncType });
}

export async function validateNuvemshopConnection(companyId: string) {
  return adminPost('/api/nuvemshop/admin/validate-connection', { company_id: companyId });
}

export async function validateNuvemshopScript(companyId: string) {
  return adminPost('/api/nuvemshop/admin/validate-script', { company_id: companyId });
}

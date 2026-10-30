import { supabase } from '../lib/supabase';

const SETUP_PATH = '/api/instagram/byo-poc/webhook-setup';

export type ByoWebhookSetupResult =
  | {
    kind: 'ok';
    webhookRouteId: string;
    webhookVerifyToken: string;
  }
  | { kind: 'denied' | 'conflict' | 'rejected' | 'temporary' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function configureInstagramByoWebhook(input: {
  companyId: string;
  action: 'generate' | 'rotate';
}): Promise<ByoWebhookSetupResult> {
  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? '';
  } catch {
    return { kind: 'temporary' };
  }
  if (!token) return { kind: 'denied' };

  let response: Response;
  try {
    response = await fetch(SETUP_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_id: input.companyId, action: input.action }),
    });
  } catch {
    return { kind: 'temporary' };
  }

  if (response.status === 401 || response.status === 403) return { kind: 'denied' };
  if (response.status === 409) return { kind: 'conflict' };
  if (response.status === 400) return { kind: 'rejected' };
  if (response.status !== 200) return { kind: 'temporary' };

  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.ok !== true || payload.company_id !== input.companyId) {
      return { kind: 'temporary' };
    }
    if (typeof payload.webhook_route_id !== 'string' || typeof payload.webhook_verify_token !== 'string') {
      return { kind: 'temporary' };
    }
    return {
      kind: 'ok',
      webhookRouteId: payload.webhook_route_id,
      webhookVerifyToken: payload.webhook_verify_token,
    };
  } catch {
    return { kind: 'temporary' };
  }
}

import { supabase } from '../lib/supabase';

const PUBLIC_FIELDS = [
  'temp_instance_id',
  'qrcode',
  'paircode',
  'status',
  'message',
  'connection_method',
  'expires_at',
  'instance_name',
  'company_id',
] as const;

export interface QrSessionData {
  temp_instance_id: string;
  qrcode: string;
  paircode?: string | null;
  status?: string;
  message?: string;
  connection_method?: string;
  expires_at: string;
  instance_name: string;
  company_id: string;
}

export function toPublicQrSession(payload: unknown): QrSessionData | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of PUBLIC_FIELDS) {
    if (field in source) data[field] = source[field];
  }
  if (typeof data.temp_instance_id !== 'string' || typeof data.qrcode !== 'string') return null;
  if (typeof data.expires_at !== 'string') return null;
  if (typeof data.instance_name !== 'string' || typeof data.company_id !== 'string') return null;
  return data as unknown as QrSessionData;
}

export interface QrRecovery {
  temp_instance_id: string;
  instance_name?: string;
  company_id?: string;
  status?: string;
}

export function toQrRecovery(payload: unknown): QrRecovery | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const source = payload as Record<string, unknown>;
  if (typeof source.temp_instance_id !== 'string') return undefined;
  return {
    temp_instance_id: source.temp_instance_id,
    instance_name: typeof source.instance_name === 'string' ? source.instance_name : undefined,
    company_id: typeof source.company_id === 'string' ? source.company_id : undefined,
    status: typeof source.status === 'string' ? source.status : undefined,
  };
}

export async function requestWhatsAppQrSession(
  companyId: string,
  instanceName: string,
  tempInstanceId?: string,
): Promise<{
  success: boolean;
  data?: QrSessionData;
  error?: string;
  planInfo?: unknown;
  recovery?: QrRecovery;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { success: false, error: 'Sessão expirada. Faça login novamente.' };

  const response = await fetch('/api/uazapi/qr-session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      company_id: companyId,
      instance_name: instanceName,
      ...(tempInstanceId ? { temp_instance_id: tempInstanceId } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const data = toPublicQrSession(record?.data);
  if (!response.ok || record?.success !== true || !data) {
    return {
      success: false,
      error: typeof record?.error === 'string' ? record.error : 'Não foi possível gerar o QR Code',
      planInfo: record?.planInfo,
      recovery: toQrRecovery(record?.data),
    };
  }
  return { success: true, data };
}

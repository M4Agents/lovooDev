// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import { requestWhatsAppQrSession, toPublicQrSession } from '../uazapiQrSessionApi';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const COMPANY = '11111111-1111-4111-8111-111111111111';
const ADMIN = 'fixture-admin-not-real';
const INSTANCE = 'fixture-instance-not-real';

function session(token = 'session-token') {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

describe('contrato do QR no frontend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remove token administrativo e token da instância antes de entregar ao hook', () => {
    const data = toPublicQrSession({
      temp_instance_id: 'temp-1',
      qrcode: 'qr-fixture',
      expires_at: '2026-11-04T12:02:00.000Z',
      instance_name: 'Comercial',
      company_id: COMPANY,
      uazapi_token: INSTANCE,
      token: INSTANCE,
      admintoken: ADMIN,
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(ADMIN);
    expect(serialized).not.toContain(INSTANCE);
    expect(data?.qrcode).toBe('qr-fixture');
  });

  it('envia só empresa e nome, com o JWT do usuário', async () => {
    session();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          temp_instance_id: 'temp-1',
          qrcode: 'qr-fixture',
          expires_at: '2026-11-04T12:02:00.000Z',
          instance_name: 'Comercial',
          company_id: COMPANY,
          uazapi_token: INSTANCE,
        },
      }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestWhatsAppQrSession(COMPANY, 'Comercial');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ company_id: COMPANY, instance_name: 'Comercial' });
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer session-token' });
    expect(JSON.stringify(result)).not.toContain(INSTANCE);
    expect(result.data?.qrcode).toBe('qr-fixture');
  });

  it('guarda só o identificador temporário quando a geração falha', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        success: false,
        error: 'Não foi possível gerar o QR Code. Tente novamente.',
        data: {
          temp_instance_id: 'temp-1',
          instance_name: 'Comercial',
          company_id: COMPANY,
          status: 'created_no_qr',
          uazapi_token: INSTANCE,
          admintoken: ADMIN,
        },
      }),
    }) as Response));

    const result = await requestWhatsAppQrSession(COMPANY, 'Comercial', 'temp-1');
    expect(result.success).toBe(false);
    expect(result.recovery).toEqual({
      temp_instance_id: 'temp-1',
      instance_name: 'Comercial',
      company_id: COMPANY,
      status: 'created_no_qr',
    });
    expect(JSON.stringify(result)).not.toContain(ADMIN);
    expect(JSON.stringify(result)).not.toContain(INSTANCE);
  });

  it('preserva a mensagem e o identificador no HTTP 409 desconhecido', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: 'O resultado da criação anterior ainda não foi confirmado. A mesma operação foi preservada.',
        data: {
          temp_instance_id: 'temp-1',
          instance_name: 'Comercial',
          company_id: COMPANY,
          status: 'unknown',
          uazapi_token: INSTANCE,
          admintoken: ADMIN,
        },
      }),
    }) as Response));

    const result = await requestWhatsAppQrSession(COMPANY, 'Comercial', 'temp-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('O resultado da criação anterior ainda não foi confirmado. A mesma operação foi preservada.');
    expect(result.recovery).toEqual({
      temp_instance_id: 'temp-1',
      instance_name: 'Comercial',
      company_id: COMPANY,
      status: 'unknown',
    });
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(ADMIN);
    expect(JSON.stringify(result)).not.toContain(INSTANCE);
  });

  it('não coloca a credencial administrativa no código ativo do QR', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const files = [
      'api/uazapi/qr-session.js',
      'api/lib/uazapi/qrSession.js',
      'api/lib/uazapi/qrClaim.js',
      'api/lib/uazapi/qrHttp.js',
      'api/lib/uazapi/adminCredential.js',
      'src/services/uazapiQrSessionApi.ts',
      'src/pages/api/uazapi/connect-qrcode.ts',
      'supabase/functions/whatsapp-life-create-instance/index.ts',
      'supabase/functions/whatsapp-life-create-instance/handleCreateInstance.js',
      'supabase/functions/whatsapp-life-create-instance/authorizeCreateInstance.js',
      'supabase/migrations/20261104140000_retire_uazapi_admin_from_qr_sql.sql',
      'supabase/migrations/20261104142000_claim_whatsapp_temp_open.sql',
      'supabase/migrations/20261104143000_whatsapp_temp_instances_one_open_name.sql',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/ADMIN_TOKEN\s*=\s*['"][A-Za-z0-9]{20,}['"]/);
      expect(source).not.toMatch(/admintoken['"]?\s*,\s*['"][A-Za-z0-9]{20,}['"]/);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectByoSystemUser } from '../byoMetaClient.js';
import { recordByoTokenInvalid } from '../byoValidationDiagnostic.js';

const APP = '1234567890';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const COMPANY = 'cccccccc-0000-4000-8000-000000000003';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function validToken() {
  return {
    data: {
      is_valid: true,
      app_id: APP,
      type: 'SYSTEM_USER',
      user_id: '99887766',
      scopes: ['instagram_basic', 'pages_show_list'],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('diagnóstico seguro de token_invalid', () => {
  it('separa is_valid falso, user_id e erro oauth sem registrar segredo', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const cases = [
      {
        fetchImpl: async () => jsonResponse(200, {
          data: {
            is_valid: false,
            error: { code: 190, error_subcode: 463, message: SUAT },
          },
        }),
        stage: 'debug_token',
        reason: 'is_valid_false',
        code: 190,
        subcode: 463,
      },
      {
        fetchImpl: async () => jsonResponse(200, {
          data: { ...validToken().data, user_id: SUAT },
        }),
        stage: 'user_id_validation',
        reason: 'user_id_invalid',
        code: null,
        subcode: null,
      },
      {
        fetchImpl: async (url) => {
          if (String(url).includes('/debug_token')) return jsonResponse(200, validToken());
          return jsonResponse(400, {
            error: { code: 102, error_subcode: 12, message: SECRET },
          });
        },
        stage: 'assigned_pages',
        reason: 'meta_oauth_error',
        code: 102,
        subcode: 12,
      },
    ];

    for (const item of cases) {
      spy.mockClear();
      const result = await inspectByoSystemUser({
        appId: APP,
        appSecret: SECRET,
        suat: SUAT,
        fetchImpl: item.fetchImpl,
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'token_invalid',
        definitive: true,
        diagnostic: {
          stage: item.stage,
          reason: item.reason,
          meta_error_code: item.code,
          meta_error_subcode: item.subcode,
        },
      });
      expect(JSON.stringify(result)).not.toContain(SUAT);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      recordByoTokenInvalid({
        requestId: REQUEST,
        companyId: COMPANY,
        diagnostic: { ...result.diagnostic, message: SUAT, url: `https://graph.facebook.com/?access_token=${SUAT}` },
      });
      const logged = spy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain(`"stage":"${item.stage}"`);
      expect(logged).toContain(`"reason":"${item.reason}"`);
      expect(logged).toContain(`"request_id":"${REQUEST}"`);
      expect(logged).not.toContain(SUAT);
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain('graph.facebook.com');
      expect(logged).not.toContain('access_token');
    }
  });
});

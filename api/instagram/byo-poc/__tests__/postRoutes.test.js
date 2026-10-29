import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/instagram/byoCredentialHttp.js', () => ({
  handleByoCredentialPost: vi.fn(),
}));

vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error('supabase-nao-deve-ser-chamado');
  }),
}));

import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js';
import { handleByoCredentialPost } from '../../../lib/instagram/byoCredentialHttp.js';
import credentials from '../credentials.js';
import revoke from '../revoke.js';

const SECRET = 'fixture-app-secret-not-real';

function sourceOf(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function request() {
  return {
    fixture: SECRET,
    get body() {
      throw new Error('body-lido');
    },
  };
}

describe('rotas POST BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { fileName: 'credentials.js', handler: credentials, mode: 'credentials' },
    { fileName: 'revoke.js', handler: revoke, mode: 'revoke' },
  ])('$fileName encaminha req e res no modo $mode', async ({ fileName, handler, mode }) => {
    const returned = Promise.resolve({ ok: true, result: 'applied' });
    handleByoCredentialPost.mockReturnValue(returned);
    const req = request();
    const res = {};

    expect(handler(req, res)).toBe(returned);
    expect(handleByoCredentialPost).toHaveBeenCalledTimes(1);
    const [forwardedReq, forwardedRes, forwardedMode] = handleByoCredentialPost.mock.calls[0];
    expect(forwardedReq).toBe(req);
    expect(forwardedRes).toBe(res);
    expect(forwardedMode).toBe(mode);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(JSON.stringify(await returned)).not.toContain(SECRET);
    expect(JSON.stringify(res)).not.toContain(SECRET);

    const source = sourceOf(fileName);
    expect(source).toContain(`handleByoCredentialPost(req, res, '${mode}')`);
    expect(source).not.toContain('getSupabaseAdmin');
    expect(source).not.toContain('encryptByoSecret');
    expect(source).not.toContain('fingerprintByoCredentialRequest');
    expect(source).not.toContain('authorizeByoCredentialWrite');
    expect(source).not.toContain('evaluateByoPocAccess');
    expect(source).not.toContain('bodyParser');
    expect(source).not.toContain(SECRET);
  });
});

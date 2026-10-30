import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BYO_POC_ROLES, evaluateByoPocAccess } from '../byoPocGate.js';

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';

const RETIRED_ENV = [
  'INSTAGRAM_BYO_POC_ENABLED',
  'INSTAGRAM_BYO_ALLOWED_COMPANY_ID',
  'INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID',
];

describe('evaluateByoPocAccess', () => {
  it('aceita empresas diferentes sem as variáveis antigas', () => {
    for (const key of RETIRED_ENV) delete process.env[key];
    expect(evaluateByoPocAccess({ requestedCompanyId: COMPANY_A })).toEqual({
      ok: true,
      companyId: COMPANY_A,
    });
    expect(evaluateByoPocAccess({ requestedCompanyId: COMPANY_B.toUpperCase() })).toEqual({
      ok: true,
      companyId: COMPANY_B,
    });
  });

  it('rejeita company_id ausente ou malformado', () => {
    expect(evaluateByoPocAccess({})).toEqual({
      ok: false,
      status: 400,
      error: 'company_id_invalid',
    });
    expect(evaluateByoPocAccess({ requestedCompanyId: 'nao-uuid' }).status).toBe(400);
    expect(evaluateByoPocAccess({ requestedCompanyId: '' }).status).toBe(400);
  });

  it('não consulta as variáveis retiradas nas rotas BYO', () => {
    const files = [
      new URL('../byoPocGate.js', import.meta.url),
      new URL('../byoCredentialHttp.js', import.meta.url),
      new URL('../../../instagram/byo-poc/status.js', import.meta.url),
      new URL('../../../instagram/byo-poc/credentials.js', import.meta.url),
      new URL('../../../instagram/byo-poc/revoke.js', import.meta.url),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const key of RETIRED_ENV) expect(source).not.toContain(key);
    }
  });
});

describe('BYO_POC_ROLES', () => {
  it('inclui manager na leitura e deixa seller de fora', () => {
    expect(BYO_POC_ROLES).toContain('manager');
    expect(BYO_POC_ROLES).not.toContain('seller');
  });
});

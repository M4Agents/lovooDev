import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BYO_POC_ROLES, evaluateByoPocAccess } from '../byoPocGate.js';

const ALLOWED_COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER_COMPANY = 'dddddddd-0000-4000-8000-000000000004';
const ALLOWED_PROJECT = 'prj_test_byo_poc';

const ENV_KEYS = [
  'INSTAGRAM_BYO_POC_ENABLED',
  'INSTAGRAM_BYO_ALLOWED_COMPANY_ID',
  'INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID',
  'VERCEL_PROJECT_ID',
];

let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.INSTAGRAM_BYO_POC_ENABLED;
  delete process.env.INSTAGRAM_BYO_ALLOWED_COMPANY_ID;
  delete process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID;
  delete process.env.VERCEL_PROJECT_ID;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function arm(companyId = ALLOWED_COMPANY, projectId = ALLOWED_PROJECT) {
  process.env.INSTAGRAM_BYO_POC_ENABLED = 'true';
  process.env.INSTAGRAM_BYO_ALLOWED_COMPANY_ID = companyId;
  process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID = projectId;
  process.env.VERCEL_PROJECT_ID = projectId;
}

describe('evaluateByoPocAccess', () => {
  it('nega quando a flag está ausente', () => {
    const result = evaluateByoPocAccess({ requestedCompanyId: ALLOWED_COMPANY });
    expect(result).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('nega quando a flag não é exatamente true', () => {
    process.env.INSTAGRAM_BYO_POC_ENABLED = '1';
    const result = evaluateByoPocAccess({ requestedCompanyId: ALLOWED_COMPANY });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('nega projeto Vercel diferente do autorizado', () => {
    arm();
    process.env.VERCEL_PROJECT_ID = 'prj_other';
    const result = evaluateByoPocAccess({ requestedCompanyId: ALLOWED_COMPANY });
    expect(result).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });

  it('nega quando o projeto autorizado não está configurado', () => {
    arm();
    delete process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID;
    delete process.env.VERCEL_PROJECT_ID;
    const result = evaluateByoPocAccess({ requestedCompanyId: ALLOWED_COMPANY });
    expect(result.status).toBe(403);
  });

  it('nega empresa diferente da allowlist', () => {
    arm();
    const result = evaluateByoPocAccess({ requestedCompanyId: OTHER_COMPANY });
    expect(result).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });

  it('aceita a empresa autorizada sem usar UUID fixo no código', () => {
    arm();
    const result = evaluateByoPocAccess({ requestedCompanyId: ALLOWED_COMPANY.toUpperCase() });
    expect(result).toEqual({ ok: true, companyId: ALLOWED_COMPANY });
  });
});

describe('BYO_POC_ROLES', () => {
  it('inclui manager na leitura e deixa seller de fora', () => {
    expect(BYO_POC_ROLES).toContain('manager');
    expect(BYO_POC_ROLES).not.toContain('seller');
  });
});

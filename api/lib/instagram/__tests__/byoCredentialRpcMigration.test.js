import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const FILE = '20261029190000_instagram_byo_credential_rpc.sql';
const PREVIOUS_REMOTE = '20261029172738';
const CREDENTIALS_FILE = '20261029170000_instagram_byo_company_credentials.sql';
const ACCOUNTS_FILE = '20261029140000_instagram_byo_poc_accounts.sql';

const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

function executable(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
}

const body = executable(sql);
const functionStart = body.indexOf('AS $ig_byo_apply$');
const functionEnd = body.lastIndexOf('$ig_byo_apply$');
const fn = body.slice(functionStart, functionEnd);

const OFFICIAL = [
  'instagram_connections',
  'instagram_company_settings',
  'instagram_conversations',
  'instagram_messages',
  'instagram_comments',
  'instagram_webhook_events',
  'instagram_audit_logs',
];

describe('migração local da RPC Instagram BYO', () => {
  it('é um arquivo novo, posterior à credencial já aplicada', () => {
    const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
    expect(names.filter((name) => name.startsWith('20261029190000'))).toEqual([FILE]);
    expect(FILE.slice(0, 14) > PREVIOUS_REMOTE).toBe(true);
    expect(names).toContain(CREDENTIALS_FILE);
    expect(names).toContain(ACCOUNTS_FILE);
  });

  it('declara a função como SECURITY INVOKER e não cria DEFINER nem policy', () => {
    expect(body).toContain('SECURITY INVOKER');
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(body).not.toMatch(/CREATE\s+POLICY/i);
    expect(body).toContain('SET search_path = public');
    expect(body).not.toMatch(/\b(hmac|hkdf|digest)\s*\(/i);
  });

  it('revoga EXECUTE de PUBLIC, anon e authenticated e concede só a service_role', () => {
    const compact = body.replace(/\s+/g, ' ');
    const signature = 'uuid, uuid, text, integer, uuid, text, text, text, text, text';
    const qualified = `public.instagram_byo_apply_credentials( ${signature} )`;
    expect(compact).toContain(`REVOKE ALL ON FUNCTION ${qualified} FROM PUBLIC;`);
    expect(compact).toContain(`REVOKE ALL ON FUNCTION ${qualified} FROM anon;`);
    expect(compact).toContain(`REVOKE ALL ON FUNCTION ${qualified} FROM authenticated;`);
    expect(compact).toContain(`GRANT EXECUTE ON FUNCTION ${qualified} TO service_role;`);
    expect(compact).toContain('REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM PUBLIC;');
    expect(compact).toContain('REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM anon;');
    expect(compact).toContain('REVOKE ALL ON FUNCTION public.instagram_byo_scopes_allowed(text[]) FROM authenticated;');
    expect(compact).toContain('GRANT EXECUTE ON FUNCTION public.instagram_byo_scopes_allowed(text[]) TO service_role;');
    expect(compact.match(/GRANT /g)).toHaveLength(2);
    expect(compact).not.toContain('TO anon');
    expect(compact).not.toContain('TO authenticated');
    expect(compact).not.toContain('TO PUBLIC');
  });

  it('bloqueia a empresa antes de ler evento, credencial ou conta', () => {
    const companyLock = fn.indexOf('FROM public.companies AS company');
    const companyForUpdate = fn.indexOf('FOR UPDATE', companyLock);
    const firstByo = fn.indexOf('instagram_byo_');
    expect(companyLock).toBeGreaterThan(0);
    expect(companyForUpdate).toBeGreaterThan(companyLock);
    expect(companyForUpdate).toBeLessThan(firstByo);
    expect(fn).toContain('v_deleted_at IS NOT NULL');
    expect(fn).toContain("'not_found'");
  });

  it('filtra company_id e exige a versão esperada nas alterações', () => {
    const statements = fn.split(';').filter((part) => /instagram_byo_/.test(part));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toContain('p_company_id');
    }
    expect(fn).toContain('credential.credential_version = p_expected_version');
    expect(fn).toContain('credential.credential_version + 1');
    expect(fn).toContain('v_new_version := 1');
  });

  it('devolve repetição legítima congelada e recusa reutilização sem gravar', () => {
    const idempotent = fn.indexOf("'idempotent'");
    const reused = fn.indexOf("'request_reused'");
    const accountUpdate = fn.indexOf('UPDATE public.instagram_byo_poc_accounts');
    const eventInsert = fn.indexOf('INSERT INTO public.instagram_byo_credential_events');
    expect(idempotent).toBeGreaterThan(0);
    expect(reused).toBeGreaterThan(0);
    expect(idempotent).toBeLessThan(accountUpdate);
    expect(reused).toBeLessThan(accountUpdate);
    expect(fn).toContain('v_stored_status');
    expect(fn).toContain('v_stored_version');
    expect(fn).toContain('v_stored_configured');
    expect(fn).toContain('v_live_version IS DISTINCT FROM v_stored_version');
    expect(eventInsert).toBeGreaterThan(accountUpdate);
  });

  it('desativa as contas BYO da empresa e não habilita a PoC', () => {
    const accountUpdate = fn.slice(fn.indexOf('UPDATE public.instagram_byo_poc_accounts'));
    expect(accountUpdate).toContain("status = 'poc_disabled'");
    expect(accountUpdate).toContain('access_token_enc = NULL');
    expect(accountUpdate).toContain("scopes = '{}'::text[]");
    expect(accountUpdate).toContain("'credentials_revoked'");
    expect(accountUpdate).toContain("'credentials_replaced'");
    expect(accountUpdate).toContain('account.company_id = p_company_id');
    expect(body).not.toContain('poc_enabled');
    for (const name of OFFICIAL) {
      expect(body).not.toContain(name);
    }
  });

  it('preserva o segredo que a rotação não substitui', () => {
    const secret = fn.slice(
      fn.indexOf("ELSIF p_operation = 'rotate_secret'"),
      fn.indexOf("ELSIF p_operation = 'rotate_suat'"),
    );
    const suat = fn.slice(
      fn.indexOf("ELSIF p_operation = 'rotate_suat'"),
      fn.indexOf("ELSIF p_operation = 'revoke'"),
    );
    expect(secret).toContain('app_secret_enc = p_app_secret_enc');
    expect(secret).not.toContain('suat_enc =');
    expect(secret).not.toContain('meta_app_id =');
    expect(suat).toContain('suat_enc = p_suat_enc');
    expect(suat).not.toContain('app_secret_enc =');
    expect(suat).not.toContain('meta_app_id =');
  });

  it('restringe status_reason, scopes e o formato do fingerprint', () => {
    expect(body).toContain("status_reason IN ('credentials_replaced', 'credentials_revoked')");
    expect(body).toContain('status_reason IS NULL');
    expect(body).toContain('CHECK (public.instagram_byo_scopes_allowed(scopes))');
    expect(body).not.toContain('scopes::text');
    expect(body).toContain("request_fingerprint ~ '^(h1|s1):[0-9a-f]{64}$'");
    expect(body).toContain('UNIQUE (company_id, request_id)');
    expect(body).toContain('instagram_byo_credential_events is not empty');
  });

  it('valida cada elemento de scopes, sem depender da forma textual do array', () => {
    const helperStart = body.indexOf('FUNCTION public.instagram_byo_scopes_allowed');
    const helperEnd = body.indexOf('$ig_byo_scopes$;', helperStart);
    const helper = body.slice(helperStart, helperEnd);
    expect(helper).toContain('IMMUTABLE');
    expect(helper).toContain('SECURITY INVOKER');
    expect(helper).toContain('SET search_path = pg_catalog');
    expect(helper).toContain('p_scopes IS NOT NULL');
    expect(helper).toContain('NOT EXISTS');
    expect(helper).toContain('unnest(p_scopes)');
    expect(helper).toContain('scope_item IS NULL');

    const pattern = helper.match(/scope_item !~ '(\^\[a-z0-9_]\{1,64\}\$)'/);
    expect(pattern).not.toBeNull();
    const element = new RegExp(pattern[1]);
    const valid = ['a', 'instagram_business_basic', 'a1_b', 'a'.repeat(64)];
    const invalid = [
      '',
      'a'.repeat(65),
      'Instagram',
      'a-b',
      'a.b',
      'a b',
      'a,b',
      '"a"',
      '{a}',
      'a\\b',
      "a'b",
      'a/b',
      'a:b',
    ];
    for (const item of valid) expect(element.test(item)).toBe(true);
    for (const item of invalid) expect(element.test(item)).toBe(false);
  });

  it('separa conflito de indisponibilidade e não confirma escrita no erro', () => {
    const handler = fn.slice(fn.indexOf('EXCEPTION'));
    expect(handler).toContain('WHEN unique_violation THEN');
    expect(handler).toContain("'request_reused'");
    expect(handler).toContain("'conflict'");
    expect(handler).toContain('WHEN check_violation OR foreign_key_violation THEN');
    expect(handler).toContain("'rejected'");
    expect(handler).toContain(
      'WHEN insufficient_privilege OR deadlock_detected OR serialization_failure OR query_canceled THEN',
    );
    const whenConditions = [...handler.matchAll(/WHEN\s+([\s\S]*?)\s+THEN/g)].map((match) => match[1]);
    expect(whenConditions.length).toBeGreaterThan(0);
    for (const condition of whenConditions) expect(condition).not.toContain(',');
    expect(handler).toContain('WHEN OTHERS THEN');
    expect(handler).toContain("'unavailable'");
    expect(handler).not.toContain("'applied'");
    expect(handler).not.toContain("'idempotent'");
    expect(handler).not.toContain("'already_revoked'");
    expect(handler).not.toContain('SQLERRM');
    expect(fn.indexOf('UPDATE public.instagram_byo_poc_accounts')).toBeLessThan(
      fn.indexOf('INSERT INTO public.instagram_byo_credential_events'),
    );
  });

  it('não devolve fingerprint, ciphertext nem mensagem SQL', () => {
    const returns = [...fn.matchAll(/RETURN jsonb_build_object\(([\s\S]*?)\);/g)].map((match) => match[1]);
    expect(returns.length).toBeGreaterThan(0);
    for (const payload of returns) {
      expect(payload).not.toContain('request_fingerprint');
      expect(payload).not.toContain('app_secret');
      expect(payload).not.toContain('suat');
      expect(payload).not.toContain('SQLERRM');
      expect(payload).not.toContain('access_token');
    }
    expect(fn).not.toContain('SQLERRM');
    expect(fn).not.toContain('RAISE');
  });
});

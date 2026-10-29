import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const FILE = '20261029170000_instagram_byo_company_credentials.sql';
const REMOTE_APPLIED = '20261029155651';
const PREVIOUS_LOCAL = '20261029140000_instagram_byo_poc_accounts.sql';

const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

function executable(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
}

const body = executable(sql);

describe('migração das credenciais Instagram BYO', () => {
  it('usa timestamp posterior à versão remota e não colide com arquivos locais', () => {
    const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
    const versions = names
      .map((name) => name.slice(0, 14))
      .filter((version) => /^[0-9]{14}$/.test(version));
    expect(names.filter((name) => name.startsWith('20261029170000'))).toEqual([FILE]);
    expect(FILE.slice(0, 14) > REMOTE_APPLIED).toBe(true);
    expect(names).toContain(PREVIOUS_LOCAL);
    expect(versions.filter((version) => version > REMOTE_APPLIED).sort()).toEqual([
      '20261029170000',
      '20261029190000',
    ]);
  });

  it('cria somente as duas tabelas novas', () => {
    const tables = [...body.matchAll(/CREATE TABLE\s+public\.(\w+)/g)].map((match) => match[1]);
    expect(tables).toEqual([
      'instagram_byo_company_credentials',
      'instagram_byo_credential_events',
    ]);
  });

  it('não altera objetos oficiais nem a tabela de contas já aplicada', () => {
    const forbidden = [
      'instagram_connections',
      'instagram_messages',
      'instagram_comments',
      'instagram_conversations',
      'instagram_byo_poc_accounts',
      'byoTokenCrypto',
    ];
    for (const name of forbidden) {
      expect(body).not.toContain(name);
    }
    expect(body).not.toMatch(/^\s*(INSERT|DELETE|TRUNCATE|DROP)\b/im);
    expect(body).not.toMatch(/^\s*UPDATE\b/im);
    expect(body).not.toMatch(/\bALTER\s+(FUNCTION|POLICY|TYPE)\b/i);
  });

  it('restringe as duas tabelas a service_role, com RLS e sem policy', () => {
    expect(body.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(body).not.toMatch(/CREATE POLICY/i);
    expect(body).not.toMatch(/FORCE ROW LEVEL SECURITY/i);

    const revokes = body.split('\n').filter((line) => line.startsWith('REVOKE '));
    expect(revokes).toEqual([
      'REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM PUBLIC;',
      'REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM anon;',
      'REVOKE ALL ON TABLE public.instagram_byo_company_credentials FROM authenticated;',
      'REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM PUBLIC;',
      'REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM anon;',
      'REVOKE ALL ON TABLE public.instagram_byo_credential_events FROM authenticated;',
    ]);

    const grants = body.split('\n').filter((line) => line.startsWith('GRANT '));
    expect(grants).toEqual([
      'GRANT ALL ON TABLE public.instagram_byo_company_credentials TO service_role;',
      'GRANT ALL ON TABLE public.instagram_byo_credential_events TO service_role;',
    ]);
  });

  it('amarra status, cifra byo1 e auditoria sem campo de segredo', () => {
    expect(body).toContain('PRIMARY KEY');
    expect(body).toContain('REFERENCES public.companies(id) ON DELETE CASCADE');
    expect(body).toContain('REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(body).toContain("encryption_version = 1 AND key_label = 'byo1'");
    expect(body).toContain("'saved', 'pending', 'valid', 'failed', 'revoked'");
    expect(body).toContain('validation_status = \'valid\' AND validated_at IS NOT NULL');
    expect(body).toContain('validation_status = \'revoked\'');
    expect(body).toContain('app_secret_enc IS NULL');
    expect(body).toContain('suat_enc IS NULL');
    expect(body).toContain('credential_version >= 1');
    expect(body).toContain("'^byo1:[A-Za-z0-9+/]+={0,2}$'");
    expect(body).toContain('EXECUTE FUNCTION public.update_updated_at_column()');
    expect(body).toContain('jsonb_exists(metadata,');
    expect(body).not.toContain('metadata ?');
    expect(body).toContain('idx_ig_byo_credential_events_company_created');
    expect(body).toContain('(company_id, created_at DESC)');
    for (const action of [
      'credentials_set',
      'app_id_replaced',
      'secret_rotated',
      'suat_rotated',
      'validation_failed',
      'validated',
      'enabled',
      'disabled',
      'revoked',
    ]) {
      expect(body).toContain(`'${action}'`);
    }
    for (const key of [
      'validation_error_code',
      'previous_status',
      'next_status',
      'app_id_changed',
      'secret_replaced',
      'suat_replaced',
    ]) {
      expect(body).toContain(`'${key}'`);
    }
    expect(body).not.toMatch(/\b(app_secret|suat|access_token|ciphertext)\s+TEXT/i);
    expect(body).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
    expect(sql).not.toMatch(/INSTAGRAM_BYO_TOKEN_ENC_KEY_V1\s*=/);
  });

  it('depende só de companies, auth.users e do trigger já existente', () => {
    const publicRefs = [...body.matchAll(/REFERENCES public\.(\w+)/g)].map((match) => match[1]);
    expect(new Set(publicRefs)).toEqual(new Set(['companies']));
    expect(body).toContain('REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(body).not.toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(body).toContain('EXECUTE FUNCTION public.update_updated_at_column()');
    expect(body).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(body).not.toContain('20261029140000');
    expect(body).not.toContain("DEFAULT 'valid'");
    expect(body).toContain("DEFAULT 'saved'");
  });

  it('deixa a conferência de privilégios só em comentário', () => {
    expect(sql).toContain('has_table_privilege');
    expect(body).not.toContain('has_table_privilege');
    expect(body).not.toContain('information_schema');
    expect(body).not.toContain('pg_policies');
  });
});

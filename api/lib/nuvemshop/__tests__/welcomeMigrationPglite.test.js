import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(import.meta.dirname, '../../../../supabase/migrations/20261114130000_nuvemshop_welcome_test_submissions.sql'),
  'utf8',
);

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';

const LEAD_FUNCTIONS = [
  'lead_member_company_ids',
  'lead_parent_admin_company_ids',
  'lead_unrestricted_company_ids',
  'lead_view_all_company_ids',
];

const STUB = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.companies (id uuid PRIMARY KEY);
CREATE TABLE public.leads (id integer PRIMARY KEY);
CREATE TABLE public.nuvemshop_welcome_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  nuvemshop_store_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  title text,
  coupon_code text,
  CONSTRAINT chk_nv_welcome_unpublished CHECK (enabled = false)
);
CREATE FUNCTION public.auth_user_is_company_member(company uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.auth_user_is_parent_admin(company uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.auth_user_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
${LEAD_FUNCTIONS.map((name) => `
CREATE FUNCTION private.${name}()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT NULL::uuid WHERE false $$;
REVOKE ALL ON FUNCTION private.${name}() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.${name}() TO anon, authenticated;
`).join('')}
ALTER TABLE public.nuvemshop_welcome_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nuvemshop_welcome_campaigns TO authenticated;
GRANT ALL ON TABLE public.nuvemshop_welcome_campaigns TO service_role;
CREATE POLICY nvwelcome_select_member
  ON public.nuvemshop_welcome_campaigns
  FOR SELECT TO authenticated
  USING (public.auth_user_is_company_member(company_id));
INSERT INTO public.companies (id) VALUES ('${COMPANY}');
INSERT INTO public.nuvemshop_welcome_campaigns (id, company_id, nuvemshop_store_id, enabled, title, coupon_code)
VALUES ('${CAMPAIGN}', '${COMPANY}', '7680914', false, 'Rascunho Valleron', 'CUPOM10');
`;

async function asRole(db, role, run) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
  }
}

describe('migration do ensaio em PostgreSQL descartável', () => {
  /** @type {import('@electric-sql/pglite').PGlite} */
  let db;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STUB);
    await db.exec(MIGRATION);
  }, 30000);

  afterAll(async () => {
    await db?.close();
  });

  it('preserva o rascunho e aplica os defaults', async () => {
    const { rows } = await db.query(`
      SELECT title, coupon_code, enabled, promo_consent_text, allowed_origins, test_contacts
      FROM public.nuvemshop_welcome_campaigns
      WHERE id = $1
    `, [CAMPAIGN]);
    expect(rows[0]).toMatchObject({
      title: 'Rascunho Valleron',
      coupon_code: 'CUPOM10',
      enabled: false,
      promo_consent_text: null,
      allowed_origins: [],
      test_contacts: [],
    });
  });

  it('permite ao service_role gravar origem válida e rejeita o restante', async () => {
    await asRole(db, 'service_role', () => db.query(`
      UPDATE public.nuvemshop_welcome_campaigns
      SET allowed_origins = ARRAY['https://valleron.store']::text[]
      WHERE id = $1
    `, [CAMPAIGN]));

    const kept = await db.query(`
      SELECT title, coupon_code, enabled, allowed_origins
      FROM public.nuvemshop_welcome_campaigns WHERE id = $1
    `, [CAMPAIGN]);
    expect(kept.rows[0]).toMatchObject({
      title: 'Rascunho Valleron',
      coupon_code: 'CUPOM10',
      enabled: false,
      allowed_origins: ['https://valleron.store'],
    });

    const enabledError = await asRole(db, 'service_role', () => db.query(`
      UPDATE public.nuvemshop_welcome_campaigns SET enabled = true WHERE id = $1
    `, [CAMPAIGN])).catch((error) => error);
    expect(String(enabledError)).toMatch(/chk_nv_welcome_unpublished/);
    expect(String(enabledError)).not.toMatch(/permission denied/i);

    const origins = Array.from({ length: 8 }, (_, index) => `https://loja${index}.example`);
    await asRole(db, 'service_role', () => db.query(`
      UPDATE public.nuvemshop_welcome_campaigns
      SET allowed_origins = $2::text[]
      WHERE id = $1
    `, [CAMPAIGN, origins]));

    const tooMany = await asRole(db, 'service_role', () => db.query(`
      UPDATE public.nuvemshop_welcome_campaigns
      SET allowed_origins = $2::text[]
      WHERE id = $1
    `, [CAMPAIGN, [...origins, 'https://extra.example']])).catch((error) => error);
    expect(String(tooMany)).toMatch(/chk_nv_welcome_origins/);
    expect(String(tooMany)).not.toMatch(/permission denied/i);

    for (const origin of [
      'http://valleron.store',
      'https://valleron.store/caminho',
      'https://user:senha@valleron.store',
      'https://valleron.store?cupom=1',
      'https://valleron.store#topo',
      'https://*.valleron.store',
    ]) {
      const invalid = await asRole(db, 'service_role', () => db.query(`
        UPDATE public.nuvemshop_welcome_campaigns
        SET allowed_origins = ARRAY[$2]::text[]
        WHERE id = $1
      `, [CAMPAIGN, origin])).catch((error) => error);
      expect(String(invalid)).toMatch(/chk_nv_welcome_origins/);
      expect(String(invalid)).not.toMatch(/permission denied/i);
    }
  });

  it('não abre as funções antigas e impede escrita de anon e authenticated', async () => {
    const access = await db.query(`
      SELECT
        has_schema_privilege('service_role', 'private', 'USAGE') AS service_usage,
        has_schema_privilege('service_role', 'private', 'CREATE') AS service_create,
        has_function_privilege('service_role', 'private.nuvemshop_welcome_origins_valid(text[])', 'EXECUTE') AS service_execute,
        has_function_privilege('anon', 'private.nuvemshop_welcome_origins_valid(text[])', 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', 'private.nuvemshop_welcome_origins_valid(text[])', 'EXECUTE') AS auth_execute,
        has_function_privilege('service_role', 'private.lead_member_company_ids()', 'EXECUTE') AS old_service,
        has_function_privilege('anon', 'private.lead_member_company_ids()', 'EXECUTE') AS old_anon
    `);
    expect(access.rows[0]).toMatchObject({
      service_usage: true,
      service_create: false,
      service_execute: true,
      anon_execute: false,
      auth_execute: false,
      old_service: false,
      old_anon: true,
    });

    const callable = await asRole(db, 'service_role', () => db.query(
      `SELECT private.nuvemshop_welcome_origins_valid('{}'::text[]) AS empty`,
    ));
    expect(callable.rows[0].empty).toBe(true);

    for (const name of LEAD_FUNCTIONS) {
      const denied = await asRole(db, 'service_role', () => db.query(
        `SELECT private.${name}()`,
      )).catch((error) => error);
      expect(String(denied)).toMatch(/permission denied/i);
    }

    for (const role of ['anon', 'authenticated']) {
      const write = await asRole(db, role, () => db.query(`
        UPDATE public.nuvemshop_welcome_campaigns SET title = 'alterado' WHERE id = $1
      `, [CAMPAIGN])).catch((error) => error);
      expect(String(write)).toMatch(/permission denied/i);
      const call = await asRole(db, role, () => db.query(
        `SELECT private.nuvemshop_welcome_origins_valid('{}'::text[])`,
      )).catch((error) => error);
      expect(String(call)).toMatch(/permission denied/i);
    }
  });

  it('define NULL, vazio e elemento nulo na função', async () => {
    const { rows } = await db.query(`
      SELECT
        private.nuvemshop_welcome_origins_valid(NULL) AS absent,
        private.nuvemshop_welcome_origins_valid('{}'::text[]) AS empty,
        private.nuvemshop_welcome_origins_valid(ARRAY['https://valleron.store', NULL]::text[]) AS hole
    `);
    expect(rows[0]).toMatchObject({ absent: false, empty: true, hole: false });
  });

  it('cria índice, RLS e grants, sem trigger de escrita', async () => {
    const index = await db.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'nuvemshop_welcome_test_submissions'
        AND indexname = 'idx_nv_welcome_test_company_store'
    `);
    expect(index.rows).toHaveLength(1);

    const triggers = await db.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.nuvemshop_welcome_test_submissions'::regclass
        AND NOT tgisinternal
    `);
    expect(triggers.rows).toHaveLength(0);

    const security = await db.query(`
      SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.nuvemshop_welcome_test_submissions'::regclass
    `);
    expect(security.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(`
      SELECT polname, polcmd FROM pg_policy
      WHERE polrelid = 'public.nuvemshop_welcome_test_submissions'::regclass
    `);
    expect(policies.rows.map((row) => row.polcmd)).toEqual(['r']);

    const grants = await db.query(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_name = 'nuvemshop_welcome_test_submissions'
    `);
    const granted = grants.rows.map((row) => `${row.grantee}:${row.privilege_type}`);
    expect(granted).toContain('authenticated:SELECT');
    expect(granted.some((item) => item.startsWith('anon:'))).toBe(false);
    expect(granted).toContain('service_role:INSERT');

    const volatility = await db.query(`
      SELECT provolatile, proconfig
      FROM pg_proc
      WHERE proname = 'nuvemshop_welcome_origins_valid'
    `);
    expect(volatility.rows[0].provolatile).toBe('i');
    expect(volatility.rows[0].proconfig.join(' ')).toMatch(/search_path=pg_catalog/);

    const still = await db.query(`
      SELECT conname FROM pg_constraint WHERE conname = 'chk_nv_welcome_unpublished'
    `);
    expect(still.rows).toHaveLength(1);
  });
});

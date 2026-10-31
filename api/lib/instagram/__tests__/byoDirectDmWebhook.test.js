import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20261030240000_instagram_byo_direct_dm_webhook.sql';

function executable(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

const sql = readFileSync(resolve(MIGRATION), 'utf8');
const body = executable(sql);
const fnStart = body.indexOf('FUNCTION public.process_instagram_byo_dm_webhook');
const fn = body.slice(fnStart);
const rpc = readFileSync(resolve('supabase/migrations/20261029190000_instagram_byo_credential_rpc.sql'), 'utf8');

function at(source, marker) {
  const index = source.indexOf(marker);
  expect(index).toBeGreaterThan(-1);
  return index;
}

describe('flag de ingestão Direct BYO', () => {
  it('nasce desligado e o CHECK recusa estado inelegível', () => {
    expect(body).toContain('ADD COLUMN direct_ingest_enabled BOOLEAN NOT NULL DEFAULT false');
    expect(body).toContain('direct_ingest_enabled = false');
    expect(body).toContain("status = 'poc_disabled' AND status_reason IS NULL");
    expect(body).not.toMatch(/UPDATE\s+public\.instagram_byo_poc_accounts/i);
    expect(body).not.toContain('direct_ingest_enabled = true');
    expect(body).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
  });

  it('zera o flag na revogação e na substituição antes do CHECK', () => {
    expect(body).toContain('BEFORE UPDATE ON public.instagram_byo_poc_accounts');
    expect(body).toContain('NEW.status_reason IS NOT NULL');
    expect(body).toContain("NEW.status IS DISTINCT FROM 'poc_disabled'");
    expect(body).toContain('NEW.direct_ingest_enabled := false');
    expect(body).toContain('SECURITY INVOKER');
    const accountUpdate = rpc.slice(rpc.indexOf('UPDATE public.instagram_byo_poc_accounts'));
    expect(accountUpdate).toContain("'credentials_revoked'");
    expect(accountUpdate).toContain("'credentials_replaced'");
    expect(accountUpdate).not.toContain('direct_ingest_enabled');
  });
});

describe('RPC de persistência Direct BYO', () => {
  it('restringe EXECUTE e segue o padrão service_role', () => {
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('SET search_path = public');
    expect(fn).toContain("auth.role() IN ('anon', 'authenticated')");
    expect(fn).toContain("ERRCODE = 'insufficient_privilege'");
    const compact = body.replace(/\s+/g, ' ');
    const signature = 'uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, text';
    expect(compact).toContain(`REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook( ${signature} ) FROM PUBLIC;`);
    expect(compact).toContain(`REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook( ${signature} ) FROM anon;`);
    expect(compact).toContain(`REVOKE ALL ON FUNCTION public.process_instagram_byo_dm_webhook( ${signature} ) FROM authenticated;`);
    expect(compact).toContain(`GRANT EXECUTE ON FUNCTION public.process_instagram_byo_dm_webhook( ${signature} ) TO service_role;`);
    expect(compact).not.toContain('TO anon');
    expect(compact).not.toContain('TO authenticated');
    expect(compact).not.toContain('TO PUBLIC');
  });

  it('consulta a prioridade oficial antes do flag e não usa LIMIT 1', () => {
    const account = at(fn, 'instagram_byo_poc_accounts AS account');
    const ambiguous = at(fn, 'ambiguous_byo_account');
    const official = at(fn, 'official_priority');
    const flag = at(fn, 'direct_ingest_enabled IS NOT TRUE');
    const credential = at(fn, 'invalid_credential');
    const webhook = at(fn, 'webhook_disabled');
    const company = at(fn, 'company_inactive');
    const duplicate = at(fn, 'duplicate_message');
    const owner = at(fn, 'conversation_owner_conflict');
    const insertMessage = at(fn, 'INSERT INTO public.instagram_messages');
    expect(account).toBeLessThan(ambiguous);
    expect(ambiguous).toBeLessThan(official);
    expect(official).toBeLessThan(flag);
    expect(flag).toBeLessThan(credential);
    expect(credential).toBeLessThan(webhook);
    expect(webhook).toBeLessThan(company);
    expect(company).toBeLessThan(duplicate);
    expect(duplicate).toBeLessThan(owner);
    expect(owner).toBeLessThan(insertMessage);
    const connectionQuery = fn.slice(fn.indexOf('instagram_connections'), official);
    expect(connectionQuery).toContain("connection.status = 'active'");
    expect(connectionQuery).toContain('connection.instagram_user_id');
    expect(connectionQuery).toContain('connection.ig_webhook_id');
    expect(connectionQuery).not.toContain('LIMIT');
    expect(fn).toContain('pg_advisory_xact_lock');
    expect(at(fn, 'pg_advisory_xact_lock')).toBeLessThan(ambiguous);
  });

  it('grava na caixa existente, sem não lidas em duplicata', () => {
    expect(fn).toContain('INSERT INTO public.instagram_conversations');
    expect(fn).toContain('NULL, p_byo_account_id');
    expect(fn).toContain("'ai_off'");
    expect(fn).toContain('ON CONFLICT (company_id, ig_thread_id) DO NOTHING');
    expect(fn).toContain('ON CONFLICT (ig_message_id) DO NOTHING');
    expect(fn).toContain("WHEN p_direction = 'inbound' THEN conversation.unread_count + 1");
    expect(at(fn, 'duplicate_message')).toBeLessThan(at(fn, 'unread_count + 1'));
    expect(fn).toContain('conversation.company_id = p_company_id');
    expect(fn).toContain('conversation.connection_id IS NULL');
    const returns = [...fn.matchAll(/jsonb_build_object\(([\s\S]*?)\)/g)].map((match) => match[1]);
    expect(returns.length).toBeGreaterThan(0);
    for (const payload of returns) {
      expect(payload).not.toContain('app_secret');
      expect(payload).not.toContain('suat');
      expect(payload).not.toContain('webhook_verify_token');
      expect(payload).not.toContain('access_token');
    }
  });

  it('não liga o webhook nem a integração oficial', () => {
    const handler = readFileSync(resolve('api/lib/instagram/byoWebhookHttp.js'), 'utf8');
    const officialWebhook = readFileSync(resolve('api/instagram/webhook.js'), 'utf8');
    const officialDm = readFileSync(resolve('supabase/migrations/20260526110000_rpc_fix_ig_webhook_id_lookup.sql'), 'utf8');
    expect(handler).toContain("rpc('process_instagram_byo_dm_webhook'");
    expect(handler).not.toContain('direct_ingest_enabled');
    expect(officialWebhook).not.toContain('direct_ingest_enabled');
    expect(officialWebhook).not.toContain('process_instagram_byo_dm_webhook');
    expect(officialDm).not.toContain('direct_ingest_enabled');
    expect(officialDm).not.toContain('361362');
    expect(body).not.toContain('process_instagram_dm_webhook');
    expect(body).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(body).not.toContain('CREATE POLICY');
    expect(body).not.toContain('CREATE TABLE');
  });
});

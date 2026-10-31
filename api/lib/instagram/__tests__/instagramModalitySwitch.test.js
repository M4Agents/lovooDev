import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20261030250000_instagram_modality_switch.sql';

function executable(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

const source = readFileSync(resolve(MIGRATION), 'utf8');
const body = executable(source);

function between(start, end) {
  const from = body.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = end ? body.indexOf(end, from + start.length) : body.length;
  expect(to).toBeGreaterThan(from);
  return body.slice(from, to);
}

const preamble = between(
  'ALTER TABLE public.instagram_connections',
  'CREATE OR REPLACE FUNCTION public.process_instagram_dm_webhook',
);
const official = between(
  'CREATE OR REPLACE FUNCTION public.process_instagram_dm_webhook',
  'CREATE OR REPLACE FUNCTION public.process_instagram_byo_dm_webhook',
);
const byo = between(
  'CREATE OR REPLACE FUNCTION public.process_instagram_byo_dm_webhook',
  'CREATE OR REPLACE FUNCTION public.switch_instagram_account_modality',
);
const transfer = between(
  'CREATE OR REPLACE FUNCTION public.switch_instagram_account_modality',
  '',
);

function at(fn, marker) {
  const index = fn.indexOf(marker);
  expect(index, marker).toBeGreaterThan(-1);
  return index;
}

function parameterTypes(parameterList) {
  return parameterList
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const withoutDefault = part.replace(/\s+DEFAULT[\s\S]*$/i, '').trim();
      const tokens = withoutDefault.split(/\s+/);
      return tokens[tokens.length - 1].toLowerCase();
    });
}

function declaredSignatures(sql) {
  const signatures = new Map();
  const pattern = /CREATE OR REPLACE FUNCTION (public\.\w+)\(([\s\S]*?)\)\s*RETURNS/g;
  for (const match of sql.matchAll(pattern)) {
    signatures.set(match[1], parameterTypes(match[2]));
  }
  return signatures;
}

function privilegeSignatures(sql) {
  const pattern = /(?:REVOKE(?: ALL| EXECUTE)?|GRANT EXECUTE) ON FUNCTION (public\.\w+)\(([\s\S]*?)\)/g;
  return [...sql.matchAll(pattern)].map((match) => ({
    name: match[1],
    types: parameterTypes(match[2]),
  }));
}

describe('registro de modalidade', () => {
  it('é único por empresa e conta e não aceita dois donos', () => {
    expect(preamble).toContain('UNIQUE (company_id, instagram_account_id)');
    expect(preamble).toContain("CHECK (mode IN ('official', 'byo'))");
    expect(preamble).toContain("mode = 'official'");
    expect(preamble).toContain('official_connection_id IS NOT NULL');
    expect(preamble).toContain('byo_account_id IS NULL');
    expect(preamble).toContain("mode = 'byo'");
    expect(preamble).toContain('byo_account_id IS NOT NULL');
    expect(preamble).toContain('official_connection_id IS NULL');
    expect(preamble).toContain('FOREIGN KEY (official_connection_id, company_id)');
    expect(preamble).toContain('FOREIGN KEY (byo_account_id, company_id)');
    expect(preamble).toContain('ON DELETE RESTRICT');
  });

  it('não abre escrita direta ao frontend nem ao service_role', () => {
    expect(preamble).toContain('ENABLE ROW LEVEL SECURITY');
    expect(preamble).not.toContain('CREATE POLICY');
    expect(preamble).toContain('REVOKE ALL ON TABLE public.instagram_account_operations FROM authenticated');
    expect(preamble).toContain('REVOKE ALL ON TABLE public.instagram_account_operations FROM anon');
    expect(preamble).toContain('REVOKE ALL ON TABLE public.instagram_account_operations FROM service_role');
    expect(preamble).not.toContain('direct_ingest_enabled');
    expect(preamble).not.toContain('UPDATE public.instagram_conversations');
    expect(preamble).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
  });
});

describe('RPC de transferência', () => {
  it('só o backend executa e a matriz é um papel administrativo direto', () => {
    expect(transfer).toContain("auth.role() IN ('anon', 'authenticated')");
    expect(transfer).toContain('REVOKE ALL ON FUNCTION public.switch_instagram_account_modality');
    expect(transfer).toContain('FROM authenticated');
    expect(transfer).toContain('GRANT EXECUTE ON FUNCTION public.switch_instagram_account_modality');
    expect(transfer).toContain('TO service_role');
    expect(transfer).toContain("membership.role IN ('super_admin', 'system_admin', 'admin')");
    expect(transfer).toContain('membership.company_id = p_company_id');
    expect(transfer).toContain('v_role_count IS DISTINCT FROM 1');
    expect(transfer).toContain('v_admin_count IS DISTINCT FROM 1');
    expect(transfer).toContain("'forbidden'");
    expect(transfer).not.toContain('partner');
    expect(transfer).not.toContain('seller');
  });

  it('exige a mesma empresa e correspondência inequívoca dos identificadores', () => {
    expect(transfer).toContain('connection.company_id = p_company_id');
    expect(transfer).toContain('account.company_id = p_company_id');
    expect(transfer).toContain('conversation.company_id = p_company_id');
    expect(transfer).toContain('v_connection.instagram_user_id IS DISTINCT FROM p_instagram_account_id');
    expect(transfer).toContain('v_connection.ig_webhook_id IS DISTINCT FROM p_instagram_account_id');
    expect(transfer).toContain('v_connection_matches > 1');
    expect(transfer).toContain('v_account_span > 1');
    expect(transfer).toContain("'identity_mismatch'");
    expect(transfer).toContain("'ambiguous_instagram_account'");
    expect(at(transfer, 'identity_mismatch')).toBeLessThan(at(transfer, 'WITH moved AS'));
  });

  it('transfere o dono nos dois sentidos sem reescrever a mensagem', () => {
    expect(transfer).toContain('connection_id = NULL');
    expect(transfer).toContain('byo_account_id = p_byo_account_id');
    expect(transfer).toContain('byo_account_id = NULL');
    expect(transfer).toContain('connection_id = p_official_connection_id');
    expect(transfer).not.toContain('instagram_messages');
    expect(transfer).not.toContain('UPDATE public.instagram_connections');
    expect(transfer).not.toContain('access_token');
    expect(transfer).not.toContain('revoked');
    const moved = transfer.slice(at(transfer, 'WITH moved AS'));
    expect(moved).not.toContain('unread_count');
    expect(moved).not.toContain('assigned_to');
    expect(moved).not.toContain('ai_state');
  });

  it('é idempotente, transacional e auditada sem segredo', () => {
    expect(at(transfer, 'already_applied')).toBeLessThan(at(transfer, 'WITH moved AS'));
    expect(transfer).toContain("'moved_count', 0");
    expect(transfer).not.toContain('COMMIT');
    expect(at(transfer, 'GET DIAGNOSTICS v_flag_rows = ROW_COUNT')).toBeLessThan(
      at(transfer, 'instagram_audit_logs'),
    );
    expect(at(transfer, "RAISE EXCEPTION 'troca de modalidade abortada'")).toBeGreaterThan(
      at(transfer, 'WITH moved AS'),
    );
    const audit = transfer.slice(at(transfer, 'instagram_audit_logs'));
    expect(audit).toContain("'switch_instagram_modality'");
    expect(audit).toContain("'from_mode', v_current_mode");
    expect(audit).toContain("'to_mode', p_target_mode");
    expect(audit).toContain("'moved_count', v_moved");
    expect(audit).not.toContain('app_secret');
    expect(audit).not.toContain('suat');
    expect(audit).not.toContain('access_token');
    expect(audit).not.toContain('webhook_verify_token');
  });

  it('liga a ingestão só dentro da troca e recusa destino não pronto', () => {
    expect(transfer).toContain("direct_ingest_enabled = (p_target_mode = 'byo')");
    expect(transfer).toContain("v_account.status IS DISTINCT FROM 'poc_disabled'");
    expect(transfer).toContain('v_account.status_reason IS NOT NULL');
    expect(transfer).toContain("v_connection.status IS DISTINCT FROM 'active'");
    expect(transfer).toContain("'destination_not_ready'");
    expect(transfer).toContain('credential.validation_status = \'valid\'');
    expect(transfer).toContain('credential.webhook_enabled IS TRUE');
    expect(at(transfer, 'destination_not_ready')).toBeLessThan(at(transfer, 'WITH moved AS'));
  });

  it('serializa a troca no mesmo advisory lock do recebimento', () => {
    expect(transfer).toContain('pg_advisory_xact_lock');
    expect(transfer).toContain('hashtextextended(p_instagram_account_id, 361362)');
    expect(at(transfer, 'FOR UPDATE')).toBeLessThan(at(transfer, 'pg_advisory_xact_lock'));
    expect(at(transfer, 'pg_advisory_xact_lock')).toBeLessThan(at(transfer, 'WITH moved AS'));
    expect(at(transfer, 'pg_advisory_xact_lock')).toBeLessThan(at(transfer, 'instagram_account_operations'));
  });
});

describe('recebimento oficial e BYO', () => {
  it('preserva o contrato oficial quando não há modalidade', () => {
    expect(official).toContain("status = 'active'");
    expect(official).toContain('instagram_user_id = p_instagram_user_id');
    expect(official).toContain('ig_webhook_id = p_instagram_user_id');
    expect(official).toContain("'connection_not_found'");
    expect(official).toContain("'company_id', v_connection.company_id");
    expect(official).toContain("'connection_id', v_connection.id");
    expect(official).toContain("'conversation_id', v_conversation_id");
    expect(official).toContain("'lead_id', v_lead_id");
    expect(official).toContain("'skipped', false");
    expect(official).toContain('IF v_mode_count = 1 THEN');
    expect(official).not.toContain('v_mode_count = 0');
    expect(official).toContain('GRANT EXECUTE ON FUNCTION public.process_instagram_dm_webhook');
    expect(official).toContain('TO service_role');
  });

  it('não grava pela modalidade inativa e não altera conversa da outra', () => {
    expect(at(official, 'pg_advisory_xact_lock')).toBeLessThan(at(official, 'mode_byo'));
    expect(at(official, 'mode_byo')).toBeLessThan(at(official, 'INSERT INTO public.instagram_messages'));
    expect(official).toContain('v_existing_byo IS NOT NULL');
    expect(official).toContain('conversation_owner_conflict');
    expect(official).toContain('conversation.byo_account_id IS NULL');
    expect(at(byo, 'pg_advisory_xact_lock')).toBeLessThan(at(byo, 'mode_official'));
    expect(at(byo, 'mode_official')).toBeLessThan(at(byo, 'official_priority'));
    expect(at(byo, 'official_priority')).toBeLessThan(at(byo, 'mode_required'));
    expect(at(byo, 'mode_required')).toBeLessThan(at(byo, 'direct_ingest_enabled IS NOT TRUE'));
    expect(at(byo, 'mode_required')).toBeLessThan(at(byo, 'INSERT INTO public.instagram_messages'));
    expect(byo).toContain('v_connection_id IS NOT NULL');
    expect(byo).toContain('conversation.connection_id IS NULL');
  });

  it('incrementa não lidas oficiais só depois da mensagem inserida', () => {
    expect(official).toContain('ON CONFLICT (company_id, ig_thread_id) DO NOTHING');
    expect(official).not.toContain('ON CONFLICT (company_id, ig_thread_id) DO UPDATE');
    expect(official).toContain('ON CONFLICT (ig_message_id) DO NOTHING');
    const inserted = at(official, 'RETURNING id INTO v_message_id');
    const missing = at(official, 'IF v_message_id IS NULL');
    const unread = at(official, 'conversation.unread_count + 1');
    expect(inserted).toBeLessThan(missing);
    expect(missing).toBeLessThan(unread);
    expect(official.slice(missing, unread)).toContain('duplicate_message');
    expect(official.split('unread_count + 1')).toHaveLength(2);
  });

  it('usa o mesmo sal das duas RPCs e recusa conjunto de chaves instável', () => {
    expect(official).toContain('hashtextextended(v_lock_key, 361362)');
    expect(byo).toContain('hashtextextended(v_account.instagram_account_id, 361362)');
    expect(official).toContain('v_fresh_keys IS DISTINCT FROM v_lock_keys');
    expect(at(official, 'v_fresh_keys IS DISTINCT FROM v_lock_keys')).toBeLessThan(
      at(official, 'INSERT INTO public.instagram_messages'),
    );
    expect(at(official, 'ambiguous_instagram_account')).toBeLessThan(
      at(official, 'INSERT INTO public.instagram_conversations'),
    );
  });

  it('repete a assinatura do CREATE em cada REVOKE e GRANT', () => {
    const declared = declaredSignatures(source);
    const privileges = privilegeSignatures(source);
    expect([...declared.keys()]).toEqual([
      'public.process_instagram_dm_webhook',
      'public.process_instagram_byo_dm_webhook',
      'public.switch_instagram_account_modality',
    ]);
    expect(privileges).toHaveLength(10);
    for (const privilege of privileges) {
      expect(privilege.types).toEqual(declared.get(privilege.name));
    }
    expect(declared.get('public.process_instagram_byo_dm_webhook')).toEqual([
      'uuid', 'uuid',
      'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'timestamptz',
      'text', 'text', 'text', 'text', 'text',
    ]);
  });
});

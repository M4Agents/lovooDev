import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261123210100_resolve_meta_conversation_lead.sql'),
  'utf8',
)

function slice(start, end) {
  const from = migration.indexOf(start)
  const to = migration.indexOf(end)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return migration.slice(from, to)
}

const acquireFn = slice(
  'CREATE OR REPLACE FUNCTION public.acquire_meta_lead_phone_locks',
  'COMMENT ON FUNCTION public.acquire_meta_lead_phone_locks',
)
const createFn = slice(
  'CREATE OR REPLACE FUNCTION private.create_and_link_meta_conversation_lead',
  'COMMENT ON FUNCTION private.create_and_link_meta_conversation_lead',
)
const applyFn = slice(
  'CREATE OR REPLACE FUNCTION private.apply_meta_prepared_conversation_lead',
  'COMMENT ON FUNCTION private.apply_meta_prepared_conversation_lead',
)
const resolveFn = slice(
  'CREATE OR REPLACE FUNCTION public.resolve_meta_conversation_lead',
  'COMMENT ON FUNCTION public.resolve_meta_conversation_lead',
)
const textFn = slice(
  'CREATE OR REPLACE FUNCTION public.process_meta_inbound_message(',
  'COMMENT ON FUNCTION public.process_meta_inbound_message(',
)
const mediaFn = slice(
  'CREATE OR REPLACE FUNCTION public.process_meta_inbound_media_message(',
  'COMMENT ON FUNCTION public.process_meta_inbound_media_message(',
)

describe('contrato resolve_meta_conversation_lead', () => {
  it('restringe EXECUTE e não expõe as funções internas', () => {
    expect(migration).toContain("IF auth.role() IN ('anon', 'authenticated')")
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path TO public, pg_catalog')
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) TO service_role;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) FROM authenticated;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) FROM anon;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) TO service_role;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) FROM authenticated;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM service_role;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM authenticated;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM service_role;',
    )
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION private.create_and_link_meta_conversation_lead')
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION private.apply_meta_prepared_conversation_lead')
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION [\s\S]* TO authenticated/)
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION [\s\S]* TO anon/)
  })

  it('prepara sem inserir e sem bloquear a conversa', () => {
    expect(acquireFn).toContain(
      "pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(\n      'lead_create_wa:' || p_company_id::text || ':' || v_phone,\n      0\n    )\n  )",
    )
    expect(acquireFn.indexOf('pg_advisory_xact_lock')).toBeLessThan(acquireFn.indexOf('FOR NO KEY UPDATE'))
    expect(acquireFn).toContain('ORDER BY l.id')
    expect(acquireFn).toContain("prepared_decision := 'invalid_phone'")
    expect(acquireFn).toContain("prepared_decision := 'ambiguous'")
    expect(acquireFn).toContain("prepared_decision := 'link_existing'")
    expect(acquireFn).toContain("prepared_decision := 'needs_create'")
    expect(acquireFn).toContain('pg_catalog.char_length(v_digits) < 12')
    expect(acquireFn).toContain("v_phone !~ '^55[0-9]{2}9[0-9]{8}$'")
    expect(acquireFn).toContain('l.phone_normalized = v_phone')
    expect(acquireFn).toContain('public.canonicalize_br_mobile_phone(l.phone) = v_phone')
    expect(acquireFn).not.toContain('INSERT INTO public.leads')
    expect(acquireFn).not.toContain('meta_conversations')
    expect(acquireFn).not.toContain('DELETE')
    expect(migration.match(/FOR NO KEY UPDATE/g)).toHaveLength(1)
  })

  it('cria e vincula numa subtransação com SQLSTATE distinto', () => {
    expect(createFn.indexOf('INSERT INTO public.leads')).toBeLessThan(
      createFn.indexOf('INSERT INTO public.meta_conversations'),
    )
    expect(createFn.indexOf('INSERT INTO public.meta_conversations')).toBeLessThan(
      createFn.indexOf("ERRCODE = 'MC001'"),
    )
    expect(createFn).toContain('BEGIN')
    expect(createFn).toContain('EXCEPTION')
    expect(createFn).toContain("WHEN SQLSTATE 'MC001' THEN")
    expect(createFn).toContain("WHEN SQLSTATE 'MC002' THEN")
    expect(createFn).toContain("WHEN SQLSTATE 'MC003' THEN")
    expect(createFn).toContain('WHEN deadlock_detected OR serialization_failure THEN')
    expect(createFn).toContain('RAISE;')
    expect(createFn).toContain('AND mc.lead_id IS NULL')
    expect(createFn).toContain('pl.max_leads')
    expect(createFn).toContain('pl.is_active = true')
    expect(createFn).toContain('v_current_leads >= v_max_leads')
    expect(createFn).toContain('v_is_over_plan')
    expect(createFn).toContain("outcome := 'created_and_linked'")
    expect(createFn).toContain("outcome := 'already_linked'")
    expect(createFn).toContain("outcome := 'lead_not_created'")
    expect(createFn).toContain('conversation_id := NULL')
    expect(createFn).not.toContain('FOR NO KEY UPDATE')
    expect(createFn).not.toContain('FOR UPDATE')
    expect(createFn).not.toContain('DELETE')
    expect(createFn).not.toContain('SQLERRM')
    expect(createFn).not.toContain('WHEN OTHERS')
    expect(createFn).not.toContain('WHEN raise_exception')
    expect(migration).not.toMatch(/\bSAVEPOINT\b/)
    expect(migration).not.toMatch(/\bROLLBACK\b/)
    expect(migration).not.toMatch(/\bCOMMIT\b/)
    expect(migration).not.toContain('DELETE FROM public.leads')
    expect(migration).not.toContain('WHEN OTHERS')
    expect(migration).not.toContain('SQLERRM')
  })

  it('vincula só o candidato preparado e preserva o lead manual', () => {
    expect(applyFn).toContain('FOR UPDATE')
    expect(applyFn).toContain('c.company_id = p_company_id')
    expect(applyFn).toContain('c.instance_id = p_instance_id')
    expect(applyFn).toContain('c.wa_id = p_wa_id')
    expect(applyFn).toContain('AND mc.lead_id IS NULL')
    expect(applyFn).toContain("RETURN 'already_linked'")
    expect(applyFn).toContain("RETURN 'linked_existing'")
    expect(applyFn).toContain("p_decision IS DISTINCT FROM 'link_existing'")
    expect(applyFn).not.toContain('DELETE')
    expect(applyFn).not.toContain('FOR NO KEY UPDATE')
    expect(applyFn).not.toContain('INSERT INTO public.leads')
    expect(applyFn).not.toContain('acquire_meta_lead_phone_locks')
    expect(resolveFn.indexOf('acquire_meta_lead_phone_locks')).toBeLessThan(
      resolveFn.indexOf('create_and_link_meta_conversation_lead'),
    )
    expect(resolveFn.indexOf('acquire_meta_lead_phone_locks')).toBeLessThan(
      resolveFn.indexOf('apply_meta_prepared_conversation_lead'),
    )
    expect(resolveFn).toContain('v_conv.company_id IS DISTINCT FROM p_company_id')
    expect(resolveFn).toContain('v_conv.instance_id IS DISTINCT FROM p_instance_id')
    expect(resolveFn).toContain('v_conv.wa_id IS DISTINCT FROM p_wa_id')
    expect(resolveFn).not.toContain('FOR UPDATE')
    expect(resolveFn).not.toContain('DELETE')
  })

  it('repete o UPSERT depois do descarte e preserva as assinaturas', () => {
    for (const fn of [textFn, mediaFn]) {
      const acquireAt = fn.indexOf('public.acquire_meta_lead_phone_locks(')
      const createAt = fn.indexOf('private.create_and_link_meta_conversation_lead(')
      const discardAt = fn.indexOf("IS DISTINCT FROM 'created_and_linked'")
      const messageAt = fn.indexOf('INSERT INTO public.meta_messages')
      const earlyResolveAt = fn.indexOf('public.resolve_meta_conversation_lead(')
      expect(earlyResolveAt).toBeGreaterThanOrEqual(0)
      expect(earlyResolveAt).toBeLessThan(acquireAt)
      expect(acquireAt).toBeLessThan(createAt)
      expect(createAt).toBeLessThan(discardAt)
      expect(discardAt).toBeLessThan(messageAt)
      const discardBlock = fn.slice(discardAt, messageAt)
      expect(discardBlock).toContain('INSERT INTO public.meta_conversations')
      expect(discardBlock).toContain('persisted.company_id = p_company_id')
      expect(discardBlock).toContain('persisted.instance_id = p_instance_id')
      expect(discardBlock).toContain('persisted.wa_id = p_wa_id')
      expect(discardBlock).not.toContain('lead_id =')
      const afterMessage = fn.slice(messageAt)
      expect(afterMessage).not.toContain('resolve_meta_conversation_lead')
      expect(afterMessage).not.toContain('acquire_meta_lead_phone_locks')
      expect(afterMessage).not.toContain('create_and_link_meta_conversation_lead')
      expect(afterMessage).not.toContain('apply_meta_prepared_conversation_lead')
      expect(fn).toContain('ON CONFLICT (instance_id, meta_message_id) DO NOTHING')
    }
    expect(textFn).toContain('p_body               TEXT')
    expect(mediaFn).toContain('p_media_asset_id     UUID')
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.resolve_meta_conversation_lead(\n  p_company_id      uuid,\n  p_instance_id     uuid,\n  p_conversation_id uuid,\n  p_wa_id           text,\n  p_contact_name    text\n)',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.process_meta_inbound_message(\n  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ\n) TO service_role;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.process_meta_inbound_media_message(\n  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT\n) TO service_role;',
    )
    expect(migration).not.toContain('private.link_meta_conversation_lead')
    expect(migration).not.toContain('public.link_meta_conversation_lead')
    expect(migration).not.toContain('create_lead_from_whatsapp_safe')
  })
})

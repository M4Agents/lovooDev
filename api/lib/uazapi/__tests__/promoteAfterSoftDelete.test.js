import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const migrationPath = 'supabase/migrations/20261104230000_promote_whatsapp_after_soft_delete.sql';
const claimPath = 'supabase/migrations/20261104220000_ignore_legacy_whatsapp_temp_open.sql';

function source(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function archivedName(id, name) {
  return `d:${id}:${String(name).slice(0, 61)}`;
}

function createDb(rows = []) {
  return {
    permanents: rows.map((row) => ({ ...row })),
    temps: [],
    conversations: [],
    messages: [],
    chains: new Map(),
  };
}

function reassign(db, created) {
  if (!created.phone) return;
  for (const old of db.permanents) {
    if (old.id === created.id || old.companyId !== created.companyId) continue;
    if (!old.deletedAt || old.phone !== created.phone) continue;
    for (const conversation of db.conversations) {
      const pointsHere = conversation.instanceId === old.id || conversation.lastInstanceId === old.id;
      if (!pointsHere || conversation.companyId !== created.companyId) continue;
      const duplicate = db.conversations.some((other) => (
        other !== conversation
        && other.companyId === created.companyId
        && other.instanceId === created.id
        && other.contact === conversation.contact
      ));
      if (duplicate) continue;
      conversation.instanceId = created.id;
      conversation.lastInstanceId = created.id;
      conversation.lastInstanceName = created.instanceName;
    }
  }
}

function promoteUnlocked(db, input) {
  const snapshot = structuredClone({
    permanents: db.permanents,
    temps: db.temps,
    conversations: db.conversations,
    messages: db.messages,
  });
  const restore = () => {
    db.permanents = snapshot.permanents;
    db.temps = snapshot.temps;
    db.conversations = snapshot.conversations;
    db.messages = snapshot.messages;
  };
  try {
    const existing = db.permanents.find((row) => (
      row.companyId === input.companyId && row.instanceName === input.instanceName
    ));
    if (existing && !existing.deletedAt) {
      const same = existing.providerInstanceId === input.providerInstanceId
        && existing.providerToken === input.providerToken
        && existing.status === 'connected';
      if (!same) return { ok: false, code: 'active_conflict' };
      db.temps.push({ id: input.tempId, status: 'connected' });
      return { ok: true, code: 'idempotent' };
    }

    const archived = existing?.deletedAt ? { ...existing } : null;
    if (archived) {
      existing.instanceName = archivedName(existing.id, input.instanceName);
      if (input.failAfterRename) throw new Error('promocao_nao_confirmada');
    }

    const created = {
      id: input.newId,
      companyId: input.companyId,
      instanceName: input.instanceName,
      providerInstanceId: input.providerInstanceId,
      providerToken: input.providerToken,
      status: 'connected',
      deletedAt: null,
      phone: input.phone ?? null,
      assignedUserId: input.sellerId ?? null,
    };
    db.permanents.push(created);
    reassign(db, created);

    const confirmed = db.permanents.filter((row) => (
      row.companyId === input.companyId
      && row.instanceName === input.instanceName
      && !row.deletedAt
      && row.status === 'connected'
      && row.providerInstanceId === input.providerInstanceId
      && row.providerToken === input.providerToken
    ));
    const archiveOk = !archived || db.permanents.some((row) => (
      row.id === archived.id
      && row.companyId === archived.companyId
      && row.deletedAt === archived.deletedAt
      && row.instanceName === archivedName(archived.id, input.instanceName)
      && row.providerInstanceId === archived.providerInstanceId
      && row.providerToken === archived.providerToken
    ));
    if (confirmed.length !== 1 || !archiveOk) throw new Error('promocao_nao_confirmada');
    db.temps.push({ id: input.tempId, status: 'connected' });
    return { ok: true, code: 'created', id: created.id };
  } catch (error) {
    restore();
    return { ok: false, code: error.message };
  }
}

async function withNameLock(db, companyId, instanceName, run) {
  const key = `${companyId}\u001f${instanceName}`;
  const previous = db.chains.get(key) ?? Promise.resolve();
  let release;
  const current = previous.then(() => new Promise((resolve) => {
    release = resolve;
  }));
  db.chains.set(key, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

const OLD_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('promoção após exclusão lógica', () => {
  const sql = source(migrationPath);

  it('preserva a constraint, o lock da reserva e o rollback da subtransação', () => {
    const claim = source(claimPath);
    const handlerStart = sql.lastIndexOf('EXCEPTION WHEN OTHERS THEN');
    const handler = sql.slice(handlerStart, sql.lastIndexOf('$function$'));
    const promotion = sql.slice(sql.indexOf('IF v_connected AND v_logged_in THEN'), handlerStart);

    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path TO public');
    expect(sql).toContain('IF auth.uid() IS NULL THEN');
    expect(sql).toContain("v_direct_role IN ('admin', 'manager', 'seller')");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.check_instance_connection_status(text) FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.check_instance_connection_status(text) FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.check_instance_connection_status(text) TO authenticated');
    expect(sql).not.toMatch(/DROP CONSTRAINT|CREATE UNIQUE INDEX|CREATE TRIGGER|ALTER TABLE|UPDATE public\.chat_messages/i);
    expect(sql).not.toContain('ON CONFLICT');
    expect(sql).not.toContain('reassign_conversations_on_instance_reconnect');
    expect(claim).toContain("hashtextextended(p_company_id::text || E'\\x1f' || p_instance_name, 0)");
    expect(sql).toContain("hashtextextended(v_instance_data.company_id::text || E'\\x1f' || v_instance_data.instance_name, 0)");
    expect(promotion.indexOf('pg_advisory_xact_lock')).toBeLessThan(promotion.indexOf('-- renomeacao-da-excluida'));
    expect(promotion.indexOf('-- renomeacao-da-excluida')).toBeLessThan(promotion.indexOf('INSERT INTO public.whatsapp_life_instances'));
    expect(promotion.indexOf('INSERT INTO public.whatsapp_life_instances')).toBeLessThan(promotion.indexOf('-- confirmacao-da-permanente'));
    expect(promotion.indexOf('-- confirmacao-da-permanente')).toBeLessThan(promotion.indexOf("RAISE EXCEPTION 'promocao_nao_confirmada'"));
    expect(promotion.indexOf("RAISE EXCEPTION 'promocao_nao_confirmada'")).toBeLessThan(promotion.indexOf('-- temporaria-conectada'));
    expect(promotion).toContain("'Já existe uma instância ativa com este nome'");
    expect(promotion).toContain('v_existing.provider_instance_id IS NOT DISTINCT FROM v_instance_data.uazapi_name');
    expect(promotion).toContain('v_existing.provider_token IS NOT DISTINCT FROM v_instance_data.uazapi_token');
    expect(promotion).toContain("SET instance_name = v_archived_name");
    expect(promotion).toContain('AND deleted_at IS NOT NULL');
    expect(promotion).not.toContain('SET deleted_at');
    expect(promotion).not.toContain('SET provider_token');
    expect(handler).not.toMatch(/UPDATE|INSERT/i);
    expect(sql.slice(sql.indexOf('-- temporaria-conectada'), handlerStart)).not.toContain('uazapi_token');
    expect(sql).not.toMatch(/'error', '[^']*token/);
  });

  it('renomeia somente a excluída e confirma a permanente nova', () => {
    const db = createDb([{
      id: OLD_ID,
      companyId: COMPANY,
      instanceName: 'Comercial',
      deletedAt: '2026-01-01T00:00:00.000Z',
      providerInstanceId: 'remote-old',
      providerToken: 'cred-old',
      status: 'disconnected',
      phone: null,
    }]);
    const result = promoteUnlocked(db, {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      tempId: 'temp-1',
      newId: '22222222-2222-4222-8222-222222222222',
      sellerId: 'seller-1',
      phone: null,
    });
    const archived = db.permanents.find((row) => row.id === OLD_ID);
    const created = db.permanents.find((row) => row.id === result.id);
    expect(result).toMatchObject({ ok: true, code: 'created' });
    expect(archived).toMatchObject({
      instanceName: archivedName(OLD_ID, 'Comercial'),
      deletedAt: '2026-01-01T00:00:00.000Z',
      providerInstanceId: 'remote-old',
      providerToken: 'cred-old',
      companyId: COMPANY,
    });
    expect(created).toMatchObject({
      instanceName: 'Comercial',
      deletedAt: null,
      status: 'connected',
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      assignedUserId: 'seller-1',
    });
    expect(db.temps).toEqual([{ id: 'temp-1', status: 'connected' }]);
  });

  it('não sobrescreve permanente ativa com outra credencial', () => {
    const db = createDb([{
      id: OLD_ID,
      companyId: COMPANY,
      instanceName: 'Comercial',
      deletedAt: null,
      providerInstanceId: 'remote-live',
      providerToken: 'cred-live',
      status: 'connected',
    }]);
    const result = promoteUnlocked(db, {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-other',
      providerToken: 'cred-other',
      tempId: 'temp-2',
      newId: '33333333-3333-4333-8333-333333333333',
    });
    expect(result).toEqual({ ok: false, code: 'active_conflict' });
    expect(db.permanents).toHaveLength(1);
    expect(db.permanents[0].providerToken).toBe('cred-live');
    expect(db.temps).toHaveLength(0);
  });

  it('trata polling repetido como idempotente e serializa duas chamadas', async () => {
    const db = createDb();
    const input = {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      newId: '44444444-4444-4444-8444-444444444444',
    };
    const first = withNameLock(db, COMPANY, 'Comercial', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return promoteUnlocked(db, { ...input, tempId: 'temp-a' });
    });
    const second = withNameLock(db, COMPANY, 'Comercial', async () => (
      promoteUnlocked(db, { ...input, tempId: 'temp-b', newId: '55555555-5555-4555-8555-555555555555' })
    ));
    const settled = await Promise.all([first, second]);
    expect(settled.map((item) => item.code).sort()).toEqual(['created', 'idempotent']);
    expect(db.permanents.filter((row) => !row.deletedAt)).toHaveLength(1);
  });

  it('impede duas conexões distintas de gravar o mesmo nome', async () => {
    const db = createDb();
    const [winner, loser] = await Promise.all([
      withNameLock(db, COMPANY, 'Comercial', async () => promoteUnlocked(db, {
        companyId: COMPANY,
        instanceName: 'Comercial',
        providerInstanceId: 'remote-a',
        providerToken: 'cred-a',
        tempId: 'temp-a',
        newId: '66666666-6666-4666-8666-666666666666',
      })),
      withNameLock(db, COMPANY, 'Comercial', async () => promoteUnlocked(db, {
        companyId: COMPANY,
        instanceName: 'Comercial',
        providerInstanceId: 'remote-b',
        providerToken: 'cred-b',
        tempId: 'temp-b',
        newId: '77777777-7777-4777-8777-777777777777',
      })),
    ]);
    expect([winner.code, loser.code].sort()).toEqual(['active_conflict', 'created']);
    expect(db.permanents).toHaveLength(1);
    expect(db.permanents[0].providerInstanceId).toBe('remote-a');
  });

  it('isola empresas e preserva espaços e o tamanho máximo', () => {
    const longName = ` ${'N'.repeat(99)}`;
    expect(longName).toHaveLength(100);
    expect(archivedName(OLD_ID, longName)).toHaveLength(100);
    expect(archivedName(OLD_ID, '  Comercial  ')).toBe(`d:${OLD_ID}:  Comercial  `);

    const db = createDb([{
      id: OLD_ID,
      companyId: COMPANY,
      instanceName: longName,
      deletedAt: '2026-01-01T00:00:00.000Z',
      providerInstanceId: 'remote-old',
      providerToken: 'cred-old',
      status: 'disconnected',
    }]);
    const own = promoteUnlocked(db, {
      companyId: COMPANY,
      instanceName: longName,
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      tempId: 'temp-long',
      newId: '88888888-8888-4888-8888-888888888888',
    });
    const other = promoteUnlocked(db, {
      companyId: OTHER,
      instanceName: longName,
      providerInstanceId: 'remote-other-company',
      providerToken: 'cred-other-company',
      tempId: 'temp-other',
      newId: '99999999-9999-4999-8999-999999999999',
    });
    expect(own.ok).toBe(true);
    expect(other.ok).toBe(true);
    expect(db.permanents.filter((row) => row.companyId === OTHER && row.instanceName === longName)).toHaveLength(1);
    expect(db.permanents.find((row) => row.id === OLD_ID).instanceName).toBe(archivedName(OLD_ID, longName));
  });

  it('move conversas só com telefone exato e não altera mensagens', () => {
    const db = createDb([
      {
        id: OLD_ID,
        companyId: COMPANY,
        instanceName: 'Comercial',
        deletedAt: '2026-01-01T00:00:00.000Z',
        providerInstanceId: 'remote-old',
        providerToken: 'cred-old',
        status: 'disconnected',
        phone: '5511999990000',
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        companyId: OTHER,
        instanceName: 'Outra',
        deletedAt: '2026-01-01T00:00:00.000Z',
        providerInstanceId: 'remote-foreign',
        providerToken: 'cred-foreign',
        status: 'disconnected',
        phone: '5511999990000',
      },
    ]);
    db.conversations.push(
      { id: 'conv-1', companyId: COMPANY, instanceId: OLD_ID, lastInstanceId: OLD_ID, contact: 'c1' },
      { id: 'conv-2', companyId: OTHER, instanceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', lastInstanceId: null, contact: 'c2' },
    );
    db.messages.push({ id: 'msg-1', instanceId: OLD_ID, conversationId: 'conv-1' });

    const emptyPhone = createDb(structuredClone(db.permanents));
    emptyPhone.conversations = structuredClone(db.conversations);
    emptyPhone.messages = structuredClone(db.messages);
    promoteUnlocked(emptyPhone, {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-empty',
      providerToken: 'cred-empty',
      tempId: 'temp-empty',
      newId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      phone: '',
    });
    expect(emptyPhone.conversations[0].instanceId).toBe(OLD_ID);
    expect(emptyPhone.messages[0].instanceId).toBe(OLD_ID);

    promoteUnlocked(db, {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      tempId: 'temp-phone',
      newId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      phone: '5511999990000',
    });
    expect(db.conversations.find((row) => row.id === 'conv-1').instanceId).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    expect(db.conversations.find((row) => row.id === 'conv-2').instanceId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(db.messages[0].instanceId).toBe(OLD_ID);
  });

  it('desfaz a renomeação quando a confirmação falha', () => {
    const db = createDb([{
      id: OLD_ID,
      companyId: COMPANY,
      instanceName: 'Comercial',
      deletedAt: '2026-01-01T00:00:00.000Z',
      providerInstanceId: 'remote-old',
      providerToken: 'cred-old',
      status: 'disconnected',
    }]);
    const result = promoteUnlocked(db, {
      companyId: COMPANY,
      instanceName: 'Comercial',
      providerInstanceId: 'remote-new',
      providerToken: 'cred-new',
      tempId: 'temp-fail',
      newId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      failAfterRename: true,
    });
    expect(result).toEqual({ ok: false, code: 'promocao_nao_confirmada' });
    expect(db.permanents).toEqual([{
      id: OLD_ID,
      companyId: COMPANY,
      instanceName: 'Comercial',
      deletedAt: '2026-01-01T00:00:00.000Z',
      providerInstanceId: 'remote-old',
      providerToken: 'cred-old',
      status: 'disconnected',
    }]);
    expect(db.temps).toHaveLength(0);
  });
});

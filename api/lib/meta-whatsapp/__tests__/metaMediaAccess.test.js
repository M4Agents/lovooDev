import { describe, expect, it, vi } from 'vitest';
import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js';
import { resolveMetaConversationVisibility } from '../metaConversationAccess.js';
import {
  assertMetaMediaConversation,
  classifyCompanyMediaSource,
  filterAssignedCompanyMedia,
  isMetaConversationStorageKey,
} from '../metaMediaAccess.js';
import { META_VIEW_ROLES, validateMetaCaller } from '../validateMetaCaller.js';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONV_ID = '33333333-3333-4333-8333-333333333333';
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_ID = '66666666-6666-4666-8666-666666666666';

const scope = {
  ok: true,
  visibility: 'assigned',
  userId: USER_ID,
  companyId: COMPANY_ID,
  role: 'seller',
  accessPath: 'direct',
};

function chain(result) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe('classificação e chave', () => {
  it('separa Meta inválida de biblioteca e de lmu', () => {
    expect(classifyCompanyMediaSource(null).kind).toBe('shared');
    expect(classifyCompanyMediaSource('lmu:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').kind).toBe('shared');
    expect(classifyCompanyMediaSource('catalogo').kind).toBe('shared');
    expect(classifyCompanyMediaSource('meta-inbound:').valid).toBe(false);
    expect(classifyCompanyMediaSource('meta-outbound:nao-uuid').valid).toBe(false);
    expect(classifyCompanyMediaSource('meta-inbound:wamid.OK').valid).toBe(true);
  });

  it('reconhece representações alternativas da chave Meta', () => {
    const inbound = `clientes/${COMPANY_ID}/meta-inbound/${ASSET_ID}/a.ogg`;
    const outbound = `clientes/${COMPANY_ID}/meta-outbound/${OP_ID}/audio.m4a`;
    expect(isMetaConversationStorageKey(inbound)).toBe(true);
    expect(isMetaConversationStorageKey(outbound)).toBe(true);
    expect(isMetaConversationStorageKey(encodeURIComponent(inbound))).toBe(true);
    expect(isMetaConversationStorageKey(encodeURIComponent(encodeURIComponent(outbound)))).toBe(true);
    expect(isMetaConversationStorageKey(inbound.replaceAll('/', '\\'))).toBe(true);
    expect(isMetaConversationStorageKey(`clientes/${COMPANY_ID}/whatsapp/../../meta-inbound/a.ogg`)).toBe(true);
    expect(isMetaConversationStorageKey(`clientes/${COMPANY_ID}/META-OUTBOUND/${OP_ID}/audio.m4a`)).toBe(true);
    expect(isMetaConversationStorageKey(`clientes/${COMPANY_ID}/whatsapp/2026/09/audio.ogg`)).toBe(false);
  });
});

describe('filtro de outbound', () => {
  it('exige operação única, chave igual e conversa ativa do ator', async () => {
    const key = `clientes/${COMPANY_ID}/meta-outbound/${OP_ID}/audio.m4a`;
    const row = {
      id: ASSET_ID,
      company_id: COMPANY_ID,
      source_ref: `meta-outbound:${OP_ID}`,
      s3_key: key,
    };
    const svc = {
      from: vi.fn((table) => {
        if (table === 'meta_outbound_audio_operations') {
          return chain({
            data: [{
              id: '99999999-9999-4999-8999-999999999999',
              company_id: COMPANY_ID,
              operation_id: OP_ID,
              conversation_id: CONV_ID,
              instance_id: INSTANCE_ID,
              s3_key: key,
            }],
            error: null,
          });
        }
        if (table === 'meta_messages') return chain({ data: [], error: null });
        return chain({
          data: [{
            id: CONV_ID,
            company_id: COMPANY_ID,
            instance_id: INSTANCE_ID,
            assigned_to: USER_ID,
            status: 'active',
          }],
          error: null,
        });
      }),
    };
    const allowed = await filterAssignedCompanyMedia(svc, scope, [row]);
    expect(allowed.rows).toHaveLength(1);

    const mismatch = await filterAssignedCompanyMedia(svc, scope, [{ ...row, s3_key: `${key}.other` }]);
    expect(mismatch.rows).toEqual([]);
  });
});

describe('conversa única', () => {
  it('nega conversa arquivada depois da autorização do núcleo', async () => {
    const svc = {
      from: vi.fn((table) => {
        if (table === 'meta_conversations') {
          const query = chain({
            data: { id: CONV_ID, company_id: COMPANY_ID, status: 'archived' },
            error: null,
          });
          query.maybeSingle = async () => ({
            data: table === 'meta_conversations'
              ? { id: CONV_ID, company_id: COMPANY_ID, instance_id: INSTANCE_ID, assigned_to: USER_ID }
              : null,
            error: null,
          });
          let reads = 0;
          query.maybeSingle = async () => {
            reads += 1;
            if (reads === 1) {
              return {
                data: {
                  id: CONV_ID,
                  company_id: COMPANY_ID,
                  instance_id: INSTANCE_ID,
                  assigned_to: USER_ID,
                },
                error: null,
              };
            }
            return {
              data: { id: CONV_ID, company_id: COMPANY_ID, status: 'archived' },
              error: null,
            };
          };
          return query;
        }
        return chain({ data: null, error: null });
      }),
    };
    const result = await assertMetaMediaConversation(svc, scope, CONV_ID, INSTANCE_ID);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});

const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const WAMID = 'wamid.OWN';

function guardChain(result) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function mediaSvc({ role = 'seller', chat = true, meta = false, assignedTo = USER_ID, messages }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: vi.fn((table) => {
      if (table === 'company_users') return guardChain({ data: { role }, error: null });
      if (table === 'companies') {
        return guardChain({
          data: { meta_whatsapp_enabled: meta, chat_visibility_by_assigned_to: chat },
          error: null,
        });
      }
      if (table === 'meta_messages') return guardChain({ data: messages ?? [], error: null });
      if (table === 'meta_outbound_audio_operations') return guardChain({ data: [], error: null });
      return guardChain({
        data: [{
          id: CONV_ID,
          company_id: COMPANY_ID,
          instance_id: INSTANCE_ID,
          assigned_to: assignedTo,
          status: 'active',
        }],
        error: null,
      });
    }),
  };
}

function inboundRow() {
  return {
    id: ASSET_ID,
    company_id: COMPANY_ID,
    source_ref: `meta-inbound:${WAMID}`,
    s3_key: `clientes/${COMPANY_ID}/meta-inbound/${ASSET_ID}/a.jpg`,
  };
}

function ownMessage() {
  return [{
    company_id: COMPANY_ID,
    conversation_id: CONV_ID,
    instance_id: INSTANCE_ID,
    meta_message_id: WAMID,
    media_asset_id: ASSET_ID,
  }];
}

async function restrictedScope(svc) {
  const context = await validateCompanyCaller(
    { headers: { authorization: 'Bearer valid-token' }, body: { role: 'super_admin' } },
    svc,
    COMPANY_ID,
    { roles: META_VIEW_ROLES },
  );
  const resolved = await resolveMetaConversationVisibility(svc, context);
  return { context, resolved };
}

describe('mídia com contexto real e Meta desabilitado', () => {
  it('U: seller restrito acessa a mídia da própria conversa', async () => {
    const svc = mediaSvc({ messages: ownMessage(), assignedTo: USER_ID });
    const { context, resolved } = await restrictedScope(svc);
    const filtered = await filterAssignedCompanyMedia(svc, resolved, [inboundRow()]);
    expect(context.role).toBe('seller');
    expect(resolved.visibility).toBe('assigned');
    expect(filtered.rows).toEqual([inboundRow()]);
  });

  it('V: seller restrito não acessa mídia de terceiro nem conversa sem atribuição', async () => {
    for (const assignedTo of [OTHER_USER, null]) {
      const svc = mediaSvc({ messages: ownMessage(), assignedTo });
      const { resolved } = await restrictedScope(svc);
      const filtered = await filterAssignedCompanyMedia(svc, resolved, [inboundRow()]);
      expect(filtered).toEqual({ ok: true, rows: [] });
    }
  });

  it('W/X: biblioteca compartilhada permanece e o guard Meta continua negando', async () => {
    const shared = [
      { id: 'shared-null', company_id: COMPANY_ID, source_ref: null },
      { id: 'shared-lmu', company_id: COMPANY_ID, source_ref: `lmu:${ASSET_ID}` },
    ];
    const restricted = mediaSvc({
      messages: ownMessage(),
      assignedTo: OTHER_USER,
      meta: false,
      chat: true,
    });
    const { resolved } = await restrictedScope(restricted);
    const filtered = await filterAssignedCompanyMedia(
      restricted,
      resolved,
      [...shared, inboundRow()],
    );
    expect(filtered.rows).toEqual(shared);

    const broadSvc = mediaSvc({ role: 'admin', chat: false, meta: false });
    const broadContext = await validateCompanyCaller(
      { headers: { authorization: 'Bearer valid-token' } },
      broadSvc,
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    const broadScope = await resolveMetaConversationVisibility(broadSvc, broadContext);
    const broad = await filterAssignedCompanyMedia(broadSvc, broadScope, [...shared, inboundRow()]);
    expect(broadScope.visibility).toBe('all');
    expect(broad.rows).toEqual([...shared, inboundRow()]);

    const meta = await validateMetaCaller(
      { headers: { authorization: 'Bearer valid-token' } },
      mediaSvc({ role: 'admin', meta: false, chat: false }),
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    expect(meta).toEqual({
      ok: false,
      status: 403,
      error: 'Meta WhatsApp não habilitado para esta empresa',
    });
  });
});

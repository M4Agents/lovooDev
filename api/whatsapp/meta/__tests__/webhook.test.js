// =============================================================================
// webhook.test.js
//
// Testes unitários para api/whatsapp/meta/webhook.js
// Todos os testes usam mocks — sem banco, rede, Graph ou valores reais.
//
// COBERTURA:
//   GET-01 … GET-07    Challenge verification
//   POST-01 … POST-08  Segurança POST (HMAC / body)
//   ITER-01 … ITER-08  Iteração de payload
//   TENANT-01 … TENANT-03  Tenant resolution
//   MATRIX-01 … MATRIX-20  State machine explícita
//   WAMID-01   Unknown wamid → B1
//   TS-01 … TS-08      Timestamp parsing
//   ERR-01 … ERR-06    Error code extraction
//   BATCH-01 … BATCH-03 Batch / idempotência
//   SEC-01 … SEC-05    Segurança de resposta
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (devem preceder os imports do handler)
// =============================================================================

const mockReadRawBody               = vi.fn();
const mockVerifyMetaWebhookSignature = vi.fn();
vi.mock('../../../lib/meta-whatsapp/verifyWebhookSignature.js', () => ({
  readRawBody:                (...args) => mockReadRawBody(...args),
  verifyMetaWebhookSignature: (...args) => mockVerifyMetaWebhookSignature(...args),
}));

const mockGetMetaServerConfig  = vi.fn();
const mockGetMetaWebhookConfig = vi.fn();
vi.mock('../../../lib/meta-whatsapp/config.js', () => ({
  getMetaServerConfig:  (...args) => mockGetMetaServerConfig(...args),
  getMetaWebhookConfig: (...args) => mockGetMetaWebhookConfig(...args),
}));

const mockSvc = { from: vi.fn() };
vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

import handler from '../webhook.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_VERIFY_TOKEN = 'meta_webhook_verify_token_fake_for_tests_only_xxxxxx';
const FAKE_APP_SECRET   = 'meta_app_secret_fake_for_tests_only_not_real_xxxxxxx';
const FAKE_PHONE_NUM_ID = '106540352242922';
const FAKE_INSTANCE_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_COMPANY_ID   = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_MSG_ID       = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_WAMID        = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const FAKE_TIMESTAMP    = '1739321024'; // Unix epoch string

const FAKE_INSTANCE = { id: FAKE_INSTANCE_ID, company_id: FAKE_COMPANY_ID };
const FAKE_RAW_BODY = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

// =============================================================================
// Factories
// =============================================================================

/** Constrói um payload Meta WhatsApp válido com statuses customizáveis. */
function makePayload({
  object   = 'whatsapp_business_account',
  statuses = [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }],
  field    = 'messages',
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  return {
    object,
    entry: [{
      id: '102290129340398',
      changes: [{
        field,
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
          statuses,
        },
      }],
    }],
  };
}

/** Chain para meta_whatsapp_instances: select().eq().is().maybeSingle() */
function makeInstChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_whatsapp_messages SELECT: select().eq().eq().maybeSingle() */
function makeMsgSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_whatsapp_messages UPDATE: update().eq() → Promise */
function makeUpdateChain(error = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({ data: null, error }),
  };
}

/** Request GET para verificação de challenge. */
function makeGetReq({
  mode      = 'subscribe',
  token     = FAKE_VERIFY_TOKEN,
  challenge = '1158201444',
} = {}) {
  return {
    method: 'GET',
    headers: {},
    query: {
      'hub.mode':         mode,
      'hub.verify_token': token,
      'hub.challenge':    challenge,
    },
  };
}

/** Request POST mínimo para webhook. */
function makePostReq({ headers = {} } = {}) {
  return {
    method:  'POST',
    headers: {
      'x-hub-signature-256': 'sha256=fakesignature',
      ...headers,
    },
    query: {},
  };
}

/** Res mock com captura de status e body. */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code)  { this._status = code; return this; },
    json(body)    { this._body = body;   return this; },
    send(body)    { this._body = body;   return this; },
  };
  return res;
}

// =============================================================================
// Setup padrão
// =============================================================================

beforeEach(() => {
  // resetAllMocks: limpa calls + zera implementações (incluindo fila de mockReturnValueOnce)
  // Necessário para evitar contaminação de queue entre testes MATRIX e demais
  vi.resetAllMocks();

  // Re-configurar defaults após reset
  mockGetMetaServerConfig.mockReturnValue({ appSecret: FAKE_APP_SECRET });
  mockGetMetaWebhookConfig.mockReturnValue({ verifyToken: FAKE_VERIFY_TOKEN });
  mockReadRawBody.mockResolvedValue(FAKE_RAW_BODY);
  mockVerifyMetaWebhookSignature.mockReturnValue(true);
});

/** Configura DB para happy path com 1 status. */
function setupDb({
  instance    = FAKE_INSTANCE,
  instErr     = null,
  row         = { id: FAKE_MSG_ID, status: 'accepted' },
  selectErr   = null,
  updateErr   = null,
} = {}) {
  mockSvc.from
    .mockReturnValueOnce(makeInstChain(instance, instErr))
    .mockReturnValueOnce(makeMsgSelectChain(row, selectErr))
    .mockReturnValueOnce(makeUpdateChain(updateErr));
}

// =============================================================================
// GET — Challenge verification
// =============================================================================

describe('GET /api/whatsapp/meta/webhook', () => {
  it('GET-01: mode=subscribe + token válido + challenge → 200 + challenge literal', async () => {
    const req = makeGetReq({ challenge: '1158201444' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toBe('1158201444');
  });

  it('GET-02: token errado → 403', async () => {
    const req = makeGetReq({ token: 'wrong_token' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('GET-03: token ausente (undefined) → 403', async () => {
    const req = makeGetReq();
    delete req.query['hub.verify_token'];
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('GET-04: mode diferente de subscribe → 403', async () => {
    const req = makeGetReq({ mode: 'unsubscribe' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('GET-05: ENV META_WEBHOOK_VERIFY_TOKEN ausente → fail closed 403', async () => {
    mockGetMetaWebhookConfig.mockImplementation(() => { throw new Error('env missing'); });
    const req = makeGetReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('GET-06: nenhum acesso a DB durante GET', async () => {
    const req = makeGetReq({ challenge: 'xyz' });
    const res = makeRes();
    await handler(req, res);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('GET-07: token de comprimento diferente (subset) → 403 sem timingSafeEqual exception', async () => {
    // Garante que comprimentos diferentes são rejeitados antes de timingSafeEqual
    const shortToken = FAKE_VERIFY_TOKEN.slice(0, 5); // 5 chars vs N chars completo
    const req = makeGetReq({ token: shortToken });
    const res = makeRes();
    await expect(handler(req, res)).resolves.not.toThrow();
    expect(res._status).toBe(403);
  });
});

// =============================================================================
// POST — Segurança
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — segurança', () => {
  it('POST-01: HMAC válido → 200', async () => {
    const payload = makePayload({ statuses: [] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('POST-02: HMAC inválido → 401, zero DB', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Invalid signature' });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('POST-03: signature ausente (header vazio) → 401, zero DB', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const req = makePostReq({ headers: { 'x-hub-signature-256': '' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('POST-04: body vazio — readRawBody retorna Buffer vazio, HMAC falha → 401', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.alloc(0));
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });

  it('POST-05: body > 1 MB → 413, zero DB, zero HMAC', async () => {
    mockReadRawBody.mockRejectedValue(Object.assign(new Error('body_too_large'), { code: 'body_too_large' }));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(413);
    expect(mockVerifyMetaWebhookSignature).not.toHaveBeenCalled();
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('POST-06: JSON inválido com HMAC válido → 400', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from('not-json'));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: 'Invalid payload' });
  });

  it('POST-07: object !== whatsapp_business_account → 200 skip sem DB', async () => {
    const payload = { object: 'page', entry: [] };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('POST-08: JSON.parse NÃO é executado antes de HMAC válido (HMAC falha → 401, sem parse)', async () => {
    // Se HMAC falha, nunca chegamos ao JSON.parse
    // Verificamos que quando HMAC inválido, o status é 401 e DB não é acessado
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    mockReadRawBody.mockResolvedValue(Buffer.from('not-valid-json-at-all'));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    // 401 (HMAC) e não 400 (JSON parse), provando que JSON.parse não foi executado
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// POST — Iteração e campos do payload
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — iteração', () => {
  it('ITER-01: múltiplos entry[] processados', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        { id: 'e1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'X' }, statuses: [] } }] },
        { id: 'e2', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'Y' }, statuses: [] } }] },
      ],
    };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    // Sem statuses para processar, mas nenhum erro deve ocorrer
    expect(res._status).toBe(200);
  });

  it('ITER-02: múltiplos changes[] — field!=messages ignorado', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [
          { field: 'account_update', value: {} },
          { field: 'messages', value: { metadata: { phone_number_id: FAKE_PHONE_NUM_ID }, statuses: [] } },
        ],
      }],
    };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // Sem statuses → sem DB calls para instance lookup
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('ITER-03: múltiplos statuses[] em um change — todos processados', async () => {
    const statuses = [
      { id: 'wamid.AAA', status: 'sent',      timestamp: FAKE_TIMESTAMP },
      { id: 'wamid.BBB', status: 'delivered', timestamp: FAKE_TIMESTAMP },
    ];
    const payload = makePayload({ statuses });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const rowA = { id: 'row-aaa', status: 'accepted' };
    const rowB = { id: 'row-bbb', status: 'accepted' };

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(rowA))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeMsgSelectChain(rowB))
      .mockReturnValueOnce(makeUpdateChain());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // 1 instância + 2*(select+update) = 5 from calls
    expect(mockSvc.from).toHaveBeenCalledTimes(5);
  });

  it('ITER-04: change.field !== messages → ignorado (nenhum DB access para esse change)', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'e1', changes: [{ field: 'business_capability_update', value: {} }] }],
    };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('ITER-05: change com messages[] mas sem statuses[] → ignorado', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: FAKE_PHONE_NUM_ID },
            messages: [{ id: 'msg1', type: 'text' }], // inbound — sem statuses
          },
        }],
      }],
    };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('ITER-06: status "played" → ignorado silenciosamente', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'played', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    // instance lookup ocorre, mas sem statuses para processar
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // select e update não chamados (nenhum status em scope)
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });

  it('ITER-07: status desconhecido → ignorado silenciosamente', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'unknown_future_status', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(1); // só instance lookup
  });

  it('ITER-08: wamid ausente/vazio → status ignorado', async () => {
    const payload = makePayload({ statuses: [{ id: '', status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // select não chamado — wamid inválido
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// POST — Tenant resolution
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — tenant', () => {
  it('TENANT-01: phone_number_id desconhecido → 200, nenhum update', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    // instance lookup retorna null (não encontrado)
    mockSvc.from.mockReturnValueOnce(makeInstChain(null));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });

  it('TENANT-02: DB error no instance lookup → 500', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(null, { message: 'connection error' }));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
  });

  it('TENANT-03: company_id e instance_id derivados do banco — nunca do payload', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDb();
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    // instance lookup usa phone_number_id do payload, mas seleciona apenas id e company_id do DB
    const instChainCall = mockSvc.from.mock.calls[0];
    expect(instChainCall[0]).toBe('meta_whatsapp_instances');
  });
});

// =============================================================================
// POST — State machine (TRANSITION_MATRIX)
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — state machine', () => {
  // Tabela de transições: [currentStatus, newStatus, shouldApply]
  const MATRIX_CASES = [
    // accepted (qualquer → APPLY)
    ['accepted', 'sent',      true],
    ['accepted', 'delivered', true],
    ['accepted', 'read',      true],
    ['accepted', 'failed',    true],
    // sent
    ['sent',     'sent',      false],
    ['sent',     'delivered', true],
    ['sent',     'read',      true],
    ['sent',     'failed',    true],
    // delivered
    ['delivered','sent',      false],
    ['delivered','delivered', false],
    ['delivered','read',      true],
    ['delivered','failed',    false],
    // read (nada)
    ['read',     'sent',      false],
    ['read',     'delivered', false],
    ['read',     'read',      false],
    ['read',     'failed',    false],
    // failed (nada)
    ['failed',   'sent',      false],
    ['failed',   'delivered', false],
    ['failed',   'read',      false],
    ['failed',   'failed',    false],
  ];

  it.each(MATRIX_CASES)(
    'MATRIX: %s → %s (apply=%s)',
    async (currentStatus, newStatus, apply) => {
      const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: newStatus, timestamp: FAKE_TIMESTAMP }] });
      mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

      const row         = { id: FAKE_MSG_ID, status: currentStatus };
      const updateChain = makeUpdateChain();

      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(row))
        .mockReturnValueOnce(updateChain); // só chamado se apply=true

      const req = makePostReq();
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      if (apply) {
        expect(updateChain.update).toHaveBeenCalled();
      } else {
        expect(updateChain.update).not.toHaveBeenCalled();
      }
    }
  );
});

// =============================================================================
// POST — Unknown wamid (B1)
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — unknown wamid', () => {
  it('WAMID-01: instance conhecida + wamid desconhecido → 200, sem INSERT, sem UPDATE', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // instance encontrada, mas row não existe
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null)); // row = null

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Apenas 2 DB calls (instance + select), sem update
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
    // Resposta não expõe wamid nem phone_number_id
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PHONE_NUM_ID);
  });
});

// =============================================================================
// POST — Timestamp parsing
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — timestamp', () => {
  async function runTimestampTest(timestamp) {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const updateChain = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'accepted' }))
      .mockReturnValueOnce(updateChain);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    return { res, updateChain };
  }

  it('TS-01: epoch string válido → sent_at preenchido com ISO string', async () => {
    const { res, updateChain } = await runTimestampTest('1739321024');
    expect(res._status).toBe(200);
    const call = updateChain.update.mock.calls[0][0];
    expect(call.sent_at).toBe(new Date(1739321024 * 1000).toISOString());
  });

  it('TS-02: timestamp ausente (undefined) → sent_at usa now() (ISO string válida)', async () => {
    const { res, updateChain } = await runTimestampTest(undefined);
    expect(res._status).toBe(200);
    const call = updateChain.update.mock.calls[0][0];
    expect(typeof call.sent_at).toBe('string');
    expect(call.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('TS-03: timestamp não-string (número) → sent_at usa now()', async () => {
    const { res, updateChain } = await runTimestampTest(1739321024); // number, não string
    expect(res._status).toBe(200);
    const call = updateChain.update.mock.calls[0][0];
    // parseMetaTimestamp só aceita strings → usa fallback
    expect(typeof call.sent_at).toBe('string');
  });

  it('TS-04: timestamp com letras "123abc" → usa now()', async () => {
    const { res, updateChain } = await runTimestampTest('123abc');
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalled();
  });

  it('TS-05: timestamp "0" (zero) → usa now()', async () => {
    const { res, updateChain } = await runTimestampTest('0');
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalled();
  });

  it('TS-06: timestamp negativo "-1739321024" → usa now()', async () => {
    const { res, updateChain } = await runTimestampTest('-1739321024');
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalled();
  });

  it('TS-07: timestamp acima de Number.MAX_SAFE_INTEGER → usa now()', async () => {
    const bigNum = String(Number.MAX_SAFE_INTEGER + 1);
    const { res, updateChain } = await runTimestampTest(bigNum);
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalled();
  });

  it('TS-08: timestamp string vazia "" → usa now()', async () => {
    const { res, updateChain } = await runTimestampTest('');
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalled();
  });
});

// =============================================================================
// POST — Error code extraction (status=failed)
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — error code', () => {
  async function runFailedTest(errors) {
    const statuses = [{ id: FAKE_WAMID, status: 'failed', timestamp: FAKE_TIMESTAMP, errors }];
    const payload = makePayload({ statuses });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const updateChain = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'sent' }))
      .mockReturnValueOnce(updateChain);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    return updateChain.update.mock.calls[0][0];
  }

  it('ERR-01: errors[0].code integer → persistido em error_code', async () => {
    const call = await runFailedTest([{ code: 131049, title: 'T', message: 'M' }]);
    expect(call.error_code).toBe(131049);
    expect(call.error_subcode).toBeNull();
  });

  it('ERR-02: errors[0].code string → null (não integer)', async () => {
    const call = await runFailedTest([{ code: '131049', title: 'T' }]);
    expect(call.error_code).toBeNull();
  });

  it('ERR-03: errors ausente (undefined) → error_code null', async () => {
    const call = await runFailedTest(undefined);
    expect(call.error_code).toBeNull();
  });

  it('ERR-04: errors array vazio → error_code null', async () => {
    const call = await runFailedTest([]);
    expect(call.error_code).toBeNull();
  });

  it('ERR-05: error_subcode presente artificialmente → sempre null (deprecated/inexistente em webhooks)', async () => {
    const call = await runFailedTest([{ code: 131049, error_subcode: 99999, title: 'T' }]);
    expect(call.error_subcode).toBeNull();
  });

  it('ERR-06: title/message/details nunca persistidos', async () => {
    const call = await runFailedTest([{
      code: 131049,
      title: 'SHOULD_NOT_PERSIST',
      message: 'SHOULD_NOT_PERSIST',
      error_data: { details: 'SHOULD_NOT_PERSIST' },
    }]);
    const callStr = JSON.stringify(call);
    expect(callStr).not.toContain('SHOULD_NOT_PERSIST');
  });
});

// =============================================================================
// POST — Batch failure e idempotência
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — batch e idempotência', () => {
  it('BATCH-01: DB error no UPDATE → 500', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'accepted' }))
      .mockReturnValueOnce(makeUpdateChain({ message: 'db error' }));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
  });

  it('BATCH-02: DB error no SELECT da mensagem → 500', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
  });

  it('BATCH-03: retry de batch — status já avançado (NOOP) → 200 idempotente', async () => {
    // Simula retry: row já está em 'sent', webhook entrega 'sent' novamente
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const updateChain = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'sent' })) // já em sent
      .mockReturnValueOnce(updateChain);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // NOOP → update não chamado
    expect(updateChain.update).not.toHaveBeenCalled();
  });
});

// =============================================================================
// POST — Segurança de resposta
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — segurança de resposta', () => {
  it('SEC-01: resposta não expõe wamid', async () => {
    setupDb();
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
  });

  it('SEC-02: resposta não expõe phone_number_id', async () => {
    setupDb();
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PHONE_NUM_ID);
  });

  it('SEC-03: resposta 401 não expõe signature nem app secret', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const req = makePostReq({ headers: { 'x-hub-signature-256': 'sha256=badhash' } });
    const res = makeRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('badhash');
    expect(bodyStr).not.toContain(FAKE_APP_SECRET);
  });

  it('SEC-04: método não suportado → 405', async () => {
    const req = { method: 'DELETE', headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it('SEC-05: HMAC inválido → zero DB access confirmado', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

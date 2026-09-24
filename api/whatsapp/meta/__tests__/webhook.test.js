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

const mockSvc = { from: vi.fn(), rpc: vi.fn() };
vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

// Mocks para INBOUND-DOC-C2 (DOCUMENT inbound)
const mockDecryptMetaToken = vi.fn();
vi.mock('../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockDownloadAndStoreInboundMedia = vi.fn();
vi.mock('../../../lib/meta-whatsapp/inboundMediaProcessor.js', () => ({
  downloadAndStoreInboundMedia: (...args) => mockDownloadAndStoreInboundMedia(...args),
}));

import handler from '../webhook.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_VERIFY_TOKEN  = 'meta_webhook_verify_token_fake_for_tests_only_xxxxxx';
const FAKE_APP_SECRET    = 'meta_app_secret_fake_for_tests_only_not_real_xxxxxxx';
const FAKE_PHONE_NUM_ID  = '106540352242922';
const FAKE_INSTANCE_ID   = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_COMPANY_ID    = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_MSG_ID        = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_WAMID         = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const FAKE_TIMESTAMP     = '1739321024'; // Unix epoch string

// Fixtures inbound (MVP3A)
const FAKE_CONV_ID       = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_INBOUND_WAMID = 'wamid.INBOUND_FAKE_FOR_TESTS_ONLY_xxxxxxxxxxxxxxxx';
const FAKE_WA_ID         = '5511987654321'; // E.164 sem +, fictício
const FAKE_CONTACT_NAME  = 'Contato Teste Ficticio';
const FAKE_BODY          = 'Oi teste mensagem inbound ficticia';

// Fixtures para DOCUMENT inbound (INBOUND-DOC-C2)
const FAKE_MEDIA_ID          = '123456789012345';   // Graph media_id (numeric string)
const FAKE_ASSET_ID          = 'eeee0000-0000-0000-0000-000000000005'; // CML UUID
const FAKE_ACCESS_TOKEN_ENC  = 'encrypted_token_fake_for_tests_only_xxxxxxxxxxxxxxxxxxxx';
const FAKE_PLAIN_TOKEN       = 'plain_token_fake_for_tests_only_xxxxxxxxxxxxxxxxxxxxx';

const FAKE_INSTANCE = {
  id:                FAKE_INSTANCE_ID,
  company_id:        FAKE_COMPANY_ID,
  access_token_enc:  FAKE_ACCESS_TOKEN_ENC,
};
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

// =============================================================================
// Factories — inbound messages (MVP3A)
// =============================================================================

/**
 * Constrói uma mensagem inbound Meta fictícia.
 * body=undefined  → omite text.text (para testar body ausente).
 * timestamp=null  → omite o campo timestamp do objeto message (ausente no payload).
 */
function makeInboundMessage({
  id        = FAKE_INBOUND_WAMID,
  from      = FAKE_WA_ID,
  type      = 'text',
  body      = FAKE_BODY,
  timestamp = FAKE_TIMESTAMP,
  group_id  = undefined,
} = {}) {
  const msg = { id, from, type };
  // null = campo ausente no payload (timestamp omitido pela Meta)
  if (timestamp !== null) msg.timestamp = timestamp;
  if (type === 'text' && body !== undefined) msg.text = { body };
  if (group_id !== undefined) msg.group_id = group_id;
  return msg;
}

/**
 * Constrói um payload Meta com messages[] inbound.
 * contacts=null  → omite o campo contacts[] completamente do payload.
 * statuses=null  → omite o campo statuses[] completamente do payload.
 * (undefined ativa o default do parâmetro — use null para omissão explícita)
 */
function makeInboundPayload({
  messages  = [makeInboundMessage()],
  contacts  = [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
  statuses  = null,
  phoneId   = FAKE_PHONE_NUM_ID,
} = {}) {
  const value = {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
    messages,
  };
  // null = omitir campo do payload (ausente, não array vazio)
  if (contacts !== null) value.contacts = contacts;
  if (statuses !== null) value.statuses = statuses;
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'entry-inbound-1', changes: [{ field: 'messages', value }] }],
  };
}

/** Resultado padrão da RPC process_meta_inbound_message. */
function makeRpcResult({ created = true, error = null } = {}) {
  return {
    data: error
      ? null
      : { created, conversation_id: FAKE_CONV_ID, message_id: created ? FAKE_MSG_ID : null },
    error,
  };
}

/** Configura DB para happy path inbound: instance lookup + RPC. */
function setupInboundDb({
  instance  = FAKE_INSTANCE,
  instErr   = null,
  rpcResult = makeRpcResult(),
} = {}) {
  mockSvc.from.mockReturnValueOnce(makeInstChain(instance, instErr));
  mockSvc.rpc.mockResolvedValueOnce(rpcResult);
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
  // Default RPC: sucesso com created=true
  mockSvc.rpc.mockResolvedValue(makeRpcResult());

  // Defaults DOCUMENT (INBOUND-DOC-C2)
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockDownloadAndStoreInboundMedia.mockResolvedValue({
    assetId:  FAKE_ASSET_ID,
    mimeType: 'application/pdf',
    fileSize: 102400,
    filename: 'report.pdf',
    reused:   false,
  });
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

  it('ITER-05: messages[] com mensagem inválida (from ausente) → instance lookup + 200 + zero RPC', async () => {
    // Comportamento corrigido (MVP3A): messages[] NÃO é ignorado pela ausência de statuses[].
    // Instance lookup ocorre; mensagem é pulada por missing field 'from'.
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'e1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: FAKE_PHONE_NUM_ID },
            messages: [{ id: 'msg1', type: 'text', text: { body: 'oi' } }], // from ausente
          },
        }],
      }],
    };
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    // Instance lookup deve ser feito (messages.length > 0)
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // 1 DB call (instance lookup); RPC não chamada (from ausente)
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
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

// =============================================================================
// POST — messages[] inbound TEXT (MVP3A)
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — inbound messages (MVP3A)', () => {

  // ---------------------------------------------------------------------------
  // INBOUND-01: happy path — RPC chamada com argumentos corretos
  // ---------------------------------------------------------------------------
  it('INBOUND-01: text válida → RPC chamada com p_company_id/p_instance_id/p_wa_id/p_meta_message_id/p_body/p_contact_name/p_provider_timestamp corretos', async () => {
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledWith('process_meta_inbound_message', {
      p_company_id:         FAKE_COMPANY_ID,
      p_instance_id:        FAKE_INSTANCE_ID,
      p_wa_id:              FAKE_WA_ID,
      p_meta_message_id:    FAKE_INBOUND_WAMID,
      p_body:               FAKE_BODY,
      p_contact_name:       FAKE_CONTACT_NAME,
      p_provider_timestamp: new Date(Number(FAKE_TIMESTAMP) * 1000).toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // INBOUND-02: contacts ausente → contact_name null
  // ---------------------------------------------------------------------------
  it('INBOUND-02: contacts[] ausente no payload → p_contact_name=null enviado à RPC', async () => {
    // null = campo contacts omitido do payload (não envia contacts[] à Meta)
    const payload = makeInboundPayload({ contacts: null });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const rpcArgs = mockSvc.rpc.mock.calls[0][1];
    expect(rpcArgs.p_contact_name).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-03: contact correto encontrado por wa_id, não por contacts[0]
  // ---------------------------------------------------------------------------
  it('INBOUND-03: contacts[0].wa_id !== message.from → usa contacts[1] (lookup por wa_id, não por index)', async () => {
    const OTHER_WA_ID   = '5599000000001';
    const OTHER_NAME    = 'Outro Contato';
    const contacts = [
      { wa_id: OTHER_WA_ID, profile: { name: OTHER_NAME } },        // contacts[0] — wa_id diferente
      { wa_id: FAKE_WA_ID,  profile: { name: FAKE_CONTACT_NAME } }, // contacts[1] — correto
    ];
    const payload = makeInboundPayload({ contacts });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const rpcArgs = mockSvc.rpc.mock.calls[0][1];
    // Deve usar o contato correto (wa_id bate), não contacts[0]
    expect(rpcArgs.p_contact_name).toBe(FAKE_CONTACT_NAME);
  });

  // ---------------------------------------------------------------------------
  // INBOUND-04: timestamp válido convertido para ISO
  // ---------------------------------------------------------------------------
  it('INBOUND-04: message.timestamp string epoch válida → p_provider_timestamp ISO 8601 correto', async () => {
    const payload = makeInboundPayload({
      messages: [makeInboundMessage({ timestamp: '1739321024' })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    const rpcArgs = mockSvc.rpc.mock.calls[0][1];
    expect(rpcArgs.p_provider_timestamp).toBe(new Date(1739321024 * 1000).toISOString());
  });

  // ---------------------------------------------------------------------------
  // INBOUND-05: timestamp inválido → null
  // ---------------------------------------------------------------------------
  it.each([
    // null = campo timestamp ausente no payload (makeInboundMessage trata null como "omitir")
    ['ausente',       null],
    ['string vazia',  ''],
    ['com letras',    '123abc'],
    ['zero',          '0'],
    ['negativo',      '-1739321024'],
    ['não-string',    1739321024],
  ])('INBOUND-05: timestamp %s → p_provider_timestamp=null', async (_label, ts) => {
    const msg = makeInboundMessage({ timestamp: ts });
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    const rpcArgs = mockSvc.rpc.mock.calls[0][1];
    expect(rpcArgs.p_provider_timestamp).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-06: duplicata (created=false) → HTTP 200
  // ---------------------------------------------------------------------------
  it('INBOUND-06: RPC retorna created=false (duplicata/idempotente) → HTTP 200', async () => {
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb({ rpcResult: makeRpcResult({ created: false }) });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // INBOUND-07: RPC failure → HTTP 500
  // ---------------------------------------------------------------------------
  it('INBOUND-07: RPC retorna erro real (DB/constraint) em text válida → HTTP 500', async () => {
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb({ rpcResult: makeRpcResult({ error: { message: 'db constraint error' } }) });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: 'Internal error' });
  });

  // ---------------------------------------------------------------------------
  // INBOUND-08: type image → ignorado, RPC não chamada
  // ---------------------------------------------------------------------------
  it('INBOUND-08: message.type=image → ignorado + HTTP 200 + RPC não chamada', async () => {
    const msg = makeInboundMessage({ type: 'image', body: undefined });
    delete msg.text; // imagem não tem text
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-09: group_id presente → ignorado, RPC não chamada
  // ---------------------------------------------------------------------------
  it('INBOUND-09: message.group_id presente → ignorado + HTTP 200 + RPC não chamada', async () => {
    const msg = makeInboundMessage({ group_id: 'fake-group-id-12345@g.us' });
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-10: message.id ausente → ignorado
  // ---------------------------------------------------------------------------
  it('INBOUND-10: message.id ausente → ignorado + HTTP 200 + RPC não chamada', async () => {
    const msg = makeInboundMessage();
    delete msg.id;
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-11: message.from ausente → ignorado
  // ---------------------------------------------------------------------------
  it('INBOUND-11: message.from ausente → ignorado + HTTP 200 + RPC não chamada', async () => {
    const msg = makeInboundMessage();
    delete msg.from;
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-12: text.body vazio/inválido → ignorado
  // ---------------------------------------------------------------------------
  it.each([
    ['body vazio ""',       ''],
    ['body somente espaços', '   '],
  ])('INBOUND-12: %s → ignorado + HTTP 200 + RPC não chamada', async (_label, body) => {
    const msg = makeInboundMessage({ body });
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-13: phone_number_id desconhecido no ramo messages → 200, zero RPC
  // ---------------------------------------------------------------------------
  it('INBOUND-13: phone_number_id desconhecido (ramo messages[]) → HTTP 200, zero RPC', async () => {
    const payload = makeInboundPayload({ phoneId: 'unknown-phone-id-99999' });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(null)); // instance not found

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-14: payload somente statuses[] continua funcionando (regressão MVP2)
  // ---------------------------------------------------------------------------
  it('INBOUND-14: payload com statuses[] apenas → ramo MVP2 funciona intacto, RPC NÃO chamada', async () => {
    const payload = makePayload({
      statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    // DB setup: instance + select + update (MVP2 flow)
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'accepted' }))
      .mockReturnValueOnce(makeUpdateChain());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // RPC de inbound NÃO deve ser chamada
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    // Update MVP2 deve ter sido chamado
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  // ---------------------------------------------------------------------------
  // INBOUND-15: payload somente messages[] → funciona
  // ---------------------------------------------------------------------------
  it('INBOUND-15: payload com messages[] apenas (sem statuses[]) → HTTP 200 + RPC chamada', async () => {
    const payload = makeInboundPayload(); // sem statuses
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // INBOUND-16: mesmo value com statuses[] + messages[] → AMBOS processados
  // ---------------------------------------------------------------------------
  it('INBOUND-16: value com statuses[] + messages[] → ramo A e ramo B processados independentemente', async () => {
    const payload = makeInboundPayload({
      statuses: [{ id: FAKE_WAMID, status: 'delivered', timestamp: FAKE_TIMESTAMP }],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // DB: instance (compartilhada), select outbound, update outbound, RPC inbound
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'sent' }))
      .mockReturnValueOnce(makeUpdateChain());
    mockSvc.rpc.mockResolvedValueOnce(makeRpcResult());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Ramo A: update chamado
    expect(mockSvc.from).toHaveBeenCalledTimes(3); // instance + select + update
    // Ramo B: RPC chamada
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // INBOUND-17: múltiplas messages[] → todas iteradas
  // ---------------------------------------------------------------------------
  it('INBOUND-17: múltiplas messages[] válidas → RPC chamada para cada uma', async () => {
    const msg1 = makeInboundMessage({ id: 'wamid.MSG1_FAKE', from: '5511000000001' });
    const msg2 = makeInboundMessage({ id: 'wamid.MSG2_FAKE', from: '5511000000002' });
    const contacts = [
      { wa_id: '5511000000001', profile: { name: 'Usuario Um' } },
      { wa_id: '5511000000002', profile: { name: 'Usuario Dois' } },
    ];
    const payload = makeInboundPayload({ messages: [msg1, msg2], contacts });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc
      .mockResolvedValueOnce(makeRpcResult())
      .mockResolvedValueOnce(makeRpcResult());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    // Primeira mensagem usa contato correto por wa_id
    expect(mockSvc.rpc.mock.calls[0][1].p_contact_name).toBe('Usuario Um');
    expect(mockSvc.rpc.mock.calls[1][1].p_contact_name).toBe('Usuario Dois');
  });

  // ---------------------------------------------------------------------------
  // INBOUND-18: logs não incluem PII (body, wa_id, contact_name, from)
  // ---------------------------------------------------------------------------
  it('INBOUND-18: log de sucesso NÃO contém body, wa_id, contact_name nem from', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    const allLogs = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allLogs).not.toContain(FAKE_BODY);
    expect(allLogs).not.toContain(FAKE_WA_ID);
    expect(allLogs).not.toContain(FAKE_CONTACT_NAME);
    consoleSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // INBOUND-19: assinatura inválida → 401, zero DB, zero RPC (regressão)
  // ---------------------------------------------------------------------------
  it('INBOUND-19: HMAC inválido → 401, zero DB, zero RPC', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers auxiliares — DOCUMENT inbound (INBOUND-DOC-C2)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cria um objeto de mensagem type='document' com os campos obrigatórios.
 * documentId=null simula payload sem document.id (caso inválido DOC.1).
 */
function makeDocumentMessage({
  id         = FAKE_INBOUND_WAMID,
  from       = FAKE_WA_ID,
  timestamp  = FAKE_TIMESTAMP,
  documentId = FAKE_MEDIA_ID,
  filename   = 'report.pdf',
  mime_type  = 'application/pdf',
} = {}) {
  const msg = { id, from, type: 'document', timestamp };
  if (documentId !== null) {
    msg.document = { id: documentId, filename, mime_type, sha256: 'sha256_fake_for_tests' };
  }
  return msg;
}

/**
 * Payload inbound completo com type='document'.
 * Reutiliza makeInboundPayload para manter estrutura idêntica ao TEXT.
 */
function makeDocumentPayload({
  messages = [makeDocumentMessage()],
  contacts = [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
  statuses = null,
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  return makeInboundPayload({ messages, contacts, statuses, phoneId });
}

/**
 * Chain mínima para svc.from('meta_messages').select().eq().eq().maybeSingle().
 * Simula a query de early dedupe do ramo DOCUMENT (DOC.2).
 */
function makeDedupeChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/**
 * Erro tipado simulando um throw do inboundMediaProcessor.
 */
function makeMediaError(code, message = `media error: ${code}`) {
  const err = new Error(message);
  err.code  = code;
  return err;
}

/**
 * Setup completo do DB para o caminho feliz de um DOCUMENT.
 * Configura:
 *   1. svc.from('meta_whatsapp_instances') → instância
 *   2. svc.from('meta_messages')           → dedupe (default: não encontrado)
 *   3. svc.rpc('process_meta_inbound_media_message') → sucesso
 *
 * mockDecryptMetaToken e mockDownloadAndStoreInboundMedia já têm defaults
 * configurados no beforeEach — apenas sobrescreva quando necessário.
 */
function setupDocumentDb({
  instance        = FAKE_INSTANCE,
  instErr         = null,
  dedupeData      = null,   // null = não encontrado → processar
  dedupeErr       = null,
  rpcDocResult    = {
    data:  { created: true, conversation_id: FAKE_CONV_ID, message_id: FAKE_MSG_ID },
    error: null,
  },
} = {}) {
  mockSvc.from
    .mockReturnValueOnce(makeInstChain(instance, instErr))
    .mockReturnValueOnce(makeDedupeChain(dedupeData, dedupeErr));
  mockSvc.rpc.mockResolvedValueOnce(rpcDocResult);
}

// ──────────────────────────────────────────────────────────────────────────────
// W-DOC-01..15 — POST inbound DOCUMENT (INBOUND-DOC-C2)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST — inbound DOCUMENT (INBOUND-DOC-C2)', () => {
  // W-DOC-01 — Caminho feliz completo —————————————————————————————————————————
  it('W-DOC-01 | caminho feliz: document válido → processor, RPC, 200', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Processor chamado com parâmetros corretos — tenant server-side
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    const processorArgs = mockDownloadAndStoreInboundMedia.mock.calls[0][0];
    expect(processorArgs.companyId).toBe(FAKE_COMPANY_ID);          // sempre do DB
    expect(processorArgs.mediaId).toBe(FAKE_MEDIA_ID);
    expect(processorArgs.expectedMediaType).toBe('DOCUMENT');
    expect(processorArgs.maxBytes).toBe(5 * 1024 * 1024);
    expect(processorArgs.token).toBe(FAKE_PLAIN_TOKEN);             // token plain

    // RPC chamado com message_type='document' e asset correto
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const rpcArgs = mockSvc.rpc.mock.calls[0];
    expect(rpcArgs[0]).toBe('process_meta_inbound_media_message');
    expect(rpcArgs[1]).toMatchObject({
      p_company_id:     FAKE_COMPANY_ID,                            // sempre DB
      p_instance_id:    FAKE_INSTANCE_ID,                           // sempre DB
      p_media_asset_id: FAKE_ASSET_ID,
      p_message_type:   'document',
    });
  });

  // W-DOC-02 — document.id ausente ————————————————————————————————————————————
  it('W-DOC-02 | document.id ausente → skip 200; zero decrypt/download/RPC', async () => {
    const msg     = makeDocumentMessage({ documentId: null });
    const payload = makeDocumentPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // Apenas instance lookup — dedupe e RPC NÃO devem ocorrer
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // W-DOC-03 — Duplicate wamid (early dedupe) ——————————————————————————————————
  it('W-DOC-03 | wamid já persisted → skip 200; zero decrypt/download/RPC', async () => {
    const existingRow = { id: 'existing-message-uuid' };
    const payload     = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(existingRow));            // deduplicado

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // W-DOC-04 — Arquivo grande demais (definitivo) ——————————————————————————————
  it('W-DOC-04 | inbound_media_too_large → skip 200; zero RPC', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_too_large'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);                                  // definitivo → skip
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // W-DOC-05 — Tipo MIME incompatível (definitivo) ———————————————————————————
  it('W-DOC-05 | inbound_media_type_mismatch → skip 200; zero RPC', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_type_mismatch'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // W-DOC-06 — Falha de metadata Graph (transiente) ——————————————————————————
  it('W-DOC-06 | media_metadata_failed → 500 (transiente)', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('media_metadata_failed'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  // W-DOC-07 — Timeout de download (transiente) ———————————————————————————————
  it('W-DOC-07 | media_download_timeout → 500 (transiente)', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('media_download_timeout'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  // W-DOC-08 — Credencial ausente (definitivo operacional) ——————————————————
  it('W-DOC-08 | credential ausente → skip 200; zero download/RPC; nenhum segredo em res', async () => {
    const instanceNoToken = { id: FAKE_INSTANCE_ID, company_id: FAKE_COMPANY_ID, access_token_enc: null };
    const payload         = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(instanceNoToken))
      .mockReturnValueOnce(makeDedupeChain(null));

    // Decrypt falha porque access_token_enc é null — webhook testa internamente antes de chamar
    // mockDecryptMetaToken NÃO é chamado pois o branch verifica !instance.access_token_enc primeiro

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);                                  // skip, não retry storm
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    // Resposta não deve conter nenhum token ou ciphertext
    const body = JSON.stringify(res._body ?? {});
    expect(body).not.toContain('token');
    expect(body).not.toContain('enc');
    expect(body).not.toContain('plain');
  });

  // W-DOC-09 — Falha de Storage (transiente) ——————————————————————————————————
  it('W-DOC-09 | inbound_media_storage_failed → 500 (transiente)', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_storage_failed'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  // W-DOC-10 — Falha de RPC (transiente) ——————————————————————————————————————
  it('W-DOC-10 | RPC process_meta_inbound_media_message falha → 500', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockSvc.rpc.mockResolvedValueOnce({ data: null, error: { message: 'db error' } });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  // W-DOC-11 — Asset reutilizado (reused=true) —————————————————————————————————
  it('W-DOC-11 | reused=true do processor → RPC chamado; 200', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockResolvedValueOnce({
      assetId:  FAKE_ASSET_ID,
      mimeType: 'application/pdf',
      fileSize: 50000,
      filename: 'report.pdf',
      reused:   true,                                               // asset pré-existente
    });
    mockSvc.rpc.mockResolvedValueOnce({
      data:  { created: true, conversation_id: FAKE_CONV_ID, message_id: FAKE_MSG_ID },
      error: null,
    });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[0][1].p_media_asset_id).toBe(FAKE_ASSET_ID);
  });

  // W-DOC-12 — TEXT + DOCUMENT no mesmo payload ———————————————————————————————
  it('W-DOC-12 | TEXT + DOCUMENT no mesmo payload → TEXT processado; 200 (doc ok)', async () => {
    const textMsg = makeInboundMessage({ id: 'wamid_text_01', body: 'Olá' });
    const docMsg  = makeDocumentMessage({ id: 'wamid_doc_01' });

    const payload = makeInboundPayload({ messages: [textMsg, docMsg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // instance lookup único (compartilhado por ambas mensagens do entry)
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))            // instance
      .mockReturnValueOnce(makeDedupeChain(null));                  // dedupe DOC

    // TEXT: rpc process_meta_inbound_message
    // DOCUMENT: rpc process_meta_inbound_media_message
    mockSvc.rpc
      .mockResolvedValueOnce({ data: { created: true }, error: null })  // TEXT
      .mockResolvedValueOnce({ data: { created: true }, error: null }); // DOCUMENT

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_message');
    expect(mockSvc.rpc.mock.calls[1][0]).toBe('process_meta_inbound_media_message');
  });

  // W-DOC-13 — Falha transiente em 1º doc não aborta o 2º (batch safety) ——————
  it('W-DOC-13 | DOCUMENT transiente + DOCUMENT ok → 2º processado; retorna 500', async () => {
    const docMsg1 = makeDocumentMessage({ id: 'wamid_doc_fail', documentId: FAKE_MEDIA_ID });
    const docMsg2 = makeDocumentMessage({ id: 'wamid_doc_ok',   documentId: '999888777666' });

    const payload = makeInboundPayload({ messages: [docMsg1, docMsg2] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))            // instance
      .mockReturnValueOnce(makeDedupeChain(null))                   // dedupe doc1
      .mockReturnValueOnce(makeDedupeChain(null));                  // dedupe doc2

    // doc1: download falha (transiente)
    mockDownloadAndStoreInboundMedia
      .mockRejectedValueOnce(makeMediaError('media_metadata_failed'))
      .mockResolvedValueOnce({ assetId: FAKE_ASSET_ID, mimeType: 'application/pdf', fileSize: 1024, filename: 'ok.pdf', reused: false });

    // doc2: RPC ok
    mockSvc.rpc.mockResolvedValueOnce({ data: { created: true }, error: null });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    // 2º documento ainda foi processado (batch safety)
    expect(mockSvc.rpc).toHaveBeenCalledOnce();                     // apenas doc2
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_media_message');

    // hasTransientFailure=true → 500 para retry do payload inteiro
    expect(res._status).toBe(500);
  });

  // W-DOC-14 — image/video: type_skipped, zero processor ——————————————————————
  it('W-DOC-14 | type=image e type=video → type_skipped; zero downloadAndStoreInboundMedia', async () => {
    const imageMsg = { id: 'wamid_img_01', from: FAKE_WA_ID, type: 'image',
                       image: { id: '111', mime_type: 'image/jpeg' }, timestamp: FAKE_TIMESTAMP };
    const videoMsg = { id: 'wamid_vid_01', from: FAKE_WA_ID, type: 'video',
                       video: { id: '222', mime_type: 'video/mp4' }, timestamp: FAKE_TIMESTAMP };

    const payload = makeInboundPayload({ messages: [imageMsg, videoMsg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // Somente instance lookup (sem dedupe, sem download, sem RPC)
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // W-DOC-15 — media_download_url_invalid (DEBT-DOMAIN-ALLOWLIST-C) ————————————
  it('W-DOC-15 | media_download_url_invalid → 500 (transiente; sem URL/token em res)', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('media_download_url_invalid'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);

    // Resposta não deve vazar URL, token ou ciphertext
    const body = JSON.stringify(res._body ?? {});
    expect(body).not.toContain('fbcdn');
    expect(body).not.toContain('fbsbx');
    expect(body).not.toContain('http');
    expect(body).not.toContain('token');
  });
});

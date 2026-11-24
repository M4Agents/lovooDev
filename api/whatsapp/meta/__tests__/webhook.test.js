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

// FAKE_INSTANCE representa somente as colunas reais de meta_whatsapp_instances
// utilizadas pelo webhook. access_token_enc NÃO pertence a esta tabela —
// está em meta_whatsapp_credentials (tabela separada 1:1).
const FAKE_INSTANCE = {
  id:         FAKE_INSTANCE_ID,
  company_id: FAKE_COMPANY_ID,
};

// Credencial separada — simula meta_whatsapp_credentials.
const FAKE_CREDENTIAL = {
  access_token_enc: FAKE_ACCESS_TOKEN_ENC,
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

/** Chain para meta_whatsapp_credentials: select().eq().maybeSingle() */
function makeCredentialChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
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

/**
 * Chain para meta_whatsapp_messages UPDATE condicional:
 * update().eq().eq().eq().eq().select('id')
 * data vazio significa que o predicado de status não encontrou linha.
 * Erro do cliente não é tratado como atualização.
 */
function makeUpdateChain(error = null, data = [{ id: FAKE_MSG_ID }]) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: error ? null : data, error }),
  };
}

/**
 * Chain para meta_messages touch (MVP5.B1.2):
 * update().eq().eq().eq().eq().select()
 */
function makeChatTouchChain(data = [{ id: 'chat-touch-row' }], error = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data, error }),
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
  touchData   = [{ id: 'chat-touch-row' }],
  touchErr    = null,
} = {}) {
  mockSvc.from
    .mockReturnValueOnce(makeInstChain(instance, instErr))
    .mockReturnValueOnce(makeMsgSelectChain(row, selectErr))
    .mockReturnValueOnce(makeUpdateChain(updateErr));
  if (!updateErr && !selectErr && instance && row) {
    mockSvc.from.mockReturnValueOnce(makeChatTouchChain(touchData, touchErr));
  }
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
      .mockReturnValueOnce(makeChatTouchChain())
      .mockReturnValueOnce(makeMsgSelectChain(rowB))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    // 1 instância + 2*(select+update+touch) = 7 from calls
    expect(mockSvc.from).toHaveBeenCalledTimes(7);
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
      const exactDuplicate = !apply && currentStatus === newStatus;
      const touch = makeChatTouchChain();

      mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
      mockSvc.from.mockReturnValueOnce(makeMsgSelectChain(row));
      if (apply) {
        mockSvc.from.mockReturnValueOnce(updateChain);
        mockSvc.from.mockReturnValueOnce(touch);
      } else if (exactDuplicate) {
        mockSvc.from.mockReturnValueOnce(touch);
      }

      const req = makePostReq();
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      if (apply) {
        expect(updateChain.update).toHaveBeenCalled();
        expect(touch.update).toHaveBeenCalledTimes(1);
        expect(mockSvc.from).toHaveBeenCalledTimes(4);
        expect(mockSvc.from.mock.calls[3][0]).toBe('meta_messages');
      } else if (exactDuplicate) {
        expect(updateChain.update).not.toHaveBeenCalled();
        expect(touch.update).toHaveBeenCalledTimes(1);
        expect(mockSvc.from.mock.calls.map((call) => call[0])).toEqual([
          'meta_whatsapp_instances',
          'meta_whatsapp_messages',
          'meta_messages',
        ]);
      } else {
        expect(updateChain.update).not.toHaveBeenCalled();
        expect(touch.update).not.toHaveBeenCalled();
        expect(mockSvc.from).toHaveBeenCalledTimes(2);
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
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
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
      expect(log).toHaveBeenCalledWith(
        '[meta/webhook] event_type=status instance_resolved=true wamid_found=false correlated=false status=%s',
        'sent',
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_WAMID);
      expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_PHONE_NUM_ID);
    } finally {
      log.mockRestore();
    }
  });

  it('WAMID-01b: wamid desconhecido com failed loga status sem persistir', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'failed', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(null));

      const req = makePostReq();
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(mockSvc.from).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(
        '[meta/webhook] event_type=status instance_resolved=true wamid_found=false correlated=false status=%s',
        'failed',
      );
    } finally {
      log.mockRestore();
    }
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
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(makeChatTouchChain());
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
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(makeChatTouchChain());
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
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'sent' })) // já em sent
      .mockReturnValueOnce(touch);
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(updateChain.update).not.toHaveBeenCalled();
    expect(touch.update).toHaveBeenCalledTimes(1);
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

    // TEXT: credential lookup NÃO deve ocorrer — decrypt é lazy (somente DOCUMENT)
    const fromTableNames = mockSvc.from.mock.calls.map(([t]) => t);
    expect(fromTableNames).not.toContain('meta_whatsapp_credentials');
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
  // INBOUND-08: type image sem image.id → fail-closed (não é type_skipped)
  // IMAGE com id válido é coberta em W-IMG-01.
  // ---------------------------------------------------------------------------
  it('INBOUND-08: message.type=image sem image.id → skip 200; zero processor/RPC', async () => {
    const msg = makeInboundMessage({ type: 'image', body: undefined });
    delete msg.text;
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
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
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // RPC de inbound NÃO deve ser chamada
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    // Update MVP2 + touch do chat (B1.2)
    expect(mockSvc.from).toHaveBeenCalledTimes(4);
    // STATUS: credential lookup NÃO deve ocorrer — decrypt é lazy (somente DOCUMENT)
    const fromTableNames = mockSvc.from.mock.calls.map(([t]) => t);
    expect(fromTableNames).not.toContain('meta_whatsapp_credentials');
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
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain());
    mockSvc.rpc.mockResolvedValueOnce(makeRpcResult());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Ramo A: tracking update + chat touch
    expect(mockSvc.from).toHaveBeenCalledTimes(4); // instance + select + update + touch
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
  credentialData  = FAKE_CREDENTIAL,
  credentialErr   = null,
  rpcDocResult    = {
    data:  { created: true, conversation_id: FAKE_CONV_ID, message_id: FAKE_MSG_ID },
    error: null,
  },
} = {}) {
  mockSvc.from
    .mockReturnValueOnce(makeInstChain(instance, instErr))
    .mockReturnValueOnce(makeDedupeChain(dedupeData, dedupeErr))
    .mockReturnValueOnce(makeCredentialChain(credentialData, credentialErr));
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

    // CRED-01: credential lookup ocorreu em meta_whatsapp_credentials, não em meta_whatsapp_instances
    const credCalls = mockSvc.from.mock.calls.filter(([t]) => t === 'meta_whatsapp_credentials');
    expect(credCalls.length).toBe(1);
    // decrypt recebeu access_token_enc da credencial (não de instance)
    expect(mockDecryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN_ENC);
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('media_download_timeout'),
    );

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });

  // W-DOC-08 / CRED-02 — Credential row ausente em meta_whatsapp_credentials ——
  // A consulta não prova que a ausência é permanente. HTTP 500 pede retry
  // e não inicia download. Nenhum segredo entra na resposta.
  it('W-DOC-08 | credential row ausente → HTTP 500; zero download/RPC; nenhum segredo em res', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    // Instance ok; dedupe miss; credential lookup retorna null (row inexistente)
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(null));  // row ausente

    // decryptMetaToken NÃO deve ser chamado — guard aborta antes
    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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
      .mockReturnValueOnce(makeDedupeChain(null))                   // dedupe DOC
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));   // credential DOC

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
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL))    // credential doc1
      .mockReturnValueOnce(makeDedupeChain(null))                   // dedupe doc2
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));   // credential doc2

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

  // W-DOC-14 — STICKER continua type_skipped; AUDIO saiu para W-AUD ———
  it('W-DOC-14 | type=sticker → type_skipped; zero processor/RPC', async () => {
    const stickerMsg = { id: 'wamid_stk_01', from: FAKE_WA_ID, type: 'sticker',
                         sticker: { id: '444', mime_type: 'image/webp' }, timestamp: FAKE_TIMESTAMP };

    const payload = makeInboundPayload({ messages: [stickerMsg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  // R-SCHEMA-01 — Regressão: instance lookup SELECT não contém access_token_enc ——
  // Se alguém adicionar access_token_enc ao SELECT de meta_whatsapp_instances,
  // este teste falha imediatamente (schema drift detection).
  it('R-SCHEMA-01 | meta_whatsapp_instances SELECT = "id, company_id" — sem access_token_enc', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const instChain = makeInstChain(FAKE_INSTANCE);
    mockSvc.from
      .mockReturnValueOnce(instChain)
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'accepted' }))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain());

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    // Inspecionar o argumento de .select() na query de instance lookup
    const selectArg = instChain.select.mock.calls[0][0];
    expect(selectArg).toContain('id');
    expect(selectArg).toContain('company_id');
    // CRÍTICO: access_token_enc pertence a meta_whatsapp_credentials — não a esta tabela
    expect(selectArg).not.toContain('access_token_enc');
  });

  // CRED-03 — Erro de consulta da credencial é falha recuperável ————————————
  it('CRED-03 | credential lookup DB error → HTTP 500; zero decrypt/download/RPC', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(null, { message: 'connection timeout' })); // credErr

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    // Nenhum detalhe do erro de DB na resposta
    const body = JSON.stringify(res._body ?? {});
    expect(body).not.toContain('connection');
    expect(body).not.toContain('timeout');
  });

  // CRED-04 — decrypt sem classificação permanente pede retry e não vaza segredo
  it('CRED-04 | decryptMetaToken lança → HTTP 500; zero download/RPC; nenhum segredo em res', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));  // credential ok
    // decrypt falha (chave corrompida, base64 inválido, etc.)
    mockDecryptMetaToken.mockImplementationOnce(() => {
      throw new Error('decryption_failed_bad_key');
    });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    // Mensagem de erro interno NÃO deve vazar na resposta
    const body = JSON.stringify(res._body ?? {});
    expect(body).not.toContain('decryption');
    expect(body).not.toContain(FAKE_ACCESS_TOKEN_ENC);
    expect(body).not.toContain(FAKE_PLAIN_TOKEN);
  });

  // W-DOC-15 — media_download_url_invalid (DEBT-DOMAIN-ALLOWLIST-C) ————————————
  it('W-DOC-15 | media_download_url_invalid → 500 (transiente; sem URL/token em res)', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
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

// =============================================================================
// Helpers — IMAGE inbound
// =============================================================================

function makeImageMessage({
  id        = FAKE_INBOUND_WAMID,
  from      = FAKE_WA_ID,
  timestamp = FAKE_TIMESTAMP,
  imageId   = FAKE_MEDIA_ID,
  mime_type = 'image/jpeg',
  caption   = 'caption_should_be_ignored_in_mvp',
} = {}) {
  const msg = { id, from, type: 'image', timestamp };
  if (imageId !== null) {
    msg.image = { id: imageId, mime_type, sha256: 'sha256_fake_image_for_tests', caption };
  }
  return msg;
}

function makeImagePayload({
  messages = [makeImageMessage()],
  contacts = [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
  statuses = null,
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  return makeInboundPayload({ messages, contacts, statuses, phoneId });
}

// =============================================================================
// W-IMG-01..04 — POST inbound IMAGE
// =============================================================================

describe('POST — inbound IMAGE', () => {
  it('W-IMG-01 | caminho feliz: image válida → processor IMAGE, RPC image, 200', async () => {
    const payload = makeImagePayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    const processorArgs = mockDownloadAndStoreInboundMedia.mock.calls[0][0];
    expect(processorArgs.companyId).toBe(FAKE_COMPANY_ID);
    expect(processorArgs.mediaId).toBe(FAKE_MEDIA_ID);
    expect(processorArgs.expectedMediaType).toBe('IMAGE');
    expect(processorArgs.maxBytes).toBe(5 * 1024 * 1024);
    expect(processorArgs.hintFilename).toBeUndefined();
    expect(processorArgs.token).toBe(FAKE_PLAIN_TOKEN);

    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcArgs] = mockSvc.rpc.mock.calls[0];
    expect(rpcName).toBe('process_meta_inbound_media_message');
    expect(rpcArgs).toMatchObject({
      p_company_id:     FAKE_COMPANY_ID,
      p_instance_id:    FAKE_INSTANCE_ID,
      p_media_asset_id: FAKE_ASSET_ID,
      p_message_type:   'image',
    });
    expect(rpcArgs).not.toHaveProperty('p_body');

    const credCalls = mockSvc.from.mock.calls.filter(([t]) => t === 'meta_whatsapp_credentials');
    expect(credCalls.length).toBe(1);
    expect(mockDecryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN_ENC);
  });

  it('W-IMG-02 | image.id ausente → skip 200; zero decrypt/download/RPC', async () => {
    const payload = makeImagePayload({ messages: [makeImageMessage({ imageId: null })] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-IMG-03 | TEXT + IMAGE no mesmo payload → ambos processados; 200', async () => {
    const textMsg = makeInboundMessage({ id: 'wamid_text_img_01', body: 'Olá' });
    const imgMsg  = makeImageMessage({ id: 'wamid_img_ok_01' });
    const payload = makeInboundPayload({ messages: [textMsg, imgMsg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));

    mockSvc.rpc
      .mockResolvedValueOnce({ data: { created: true }, error: null })
      .mockResolvedValueOnce({ data: { created: true }, error: null });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_message');
    expect(mockSvc.rpc.mock.calls[1][0]).toBe('process_meta_inbound_media_message');
    expect(mockSvc.rpc.mock.calls[1][1].p_message_type).toBe('image');
  });

  it('W-IMG-04 | DOCUMENT continua no pipeline após IMAGE ser suportada', async () => {
    const payload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const processorArgs = mockDownloadAndStoreInboundMedia.mock.calls[0][0];
    expect(processorArgs.expectedMediaType).toBe('DOCUMENT');
    expect(mockSvc.rpc.mock.calls[0][1].p_message_type).toBe('document');
  });
});

// =============================================================================
// Helpers — VIDEO inbound
// =============================================================================

function makeVideoMessage({
  id        = FAKE_INBOUND_WAMID,
  from      = FAKE_WA_ID,
  timestamp = FAKE_TIMESTAMP,
  videoId   = FAKE_MEDIA_ID,
  mime_type = 'video/mp4',
  caption   = 'caption_should_be_ignored_in_mvp',
} = {}) {
  const msg = { id, from, type: 'video', timestamp };
  if (videoId !== null) {
    msg.video = { id: videoId, mime_type, sha256: 'sha256_fake_video_for_tests', caption };
  }
  return msg;
}

function makeVideoPayload({
  messages = [makeVideoMessage()],
  contacts = [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
  statuses = null,
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  return makeInboundPayload({ messages, contacts, statuses, phoneId });
}

// =============================================================================
// W-VID-01..04 — POST inbound VIDEO
// =============================================================================

describe('POST — inbound VIDEO', () => {
  it('W-VID-01 | caminho feliz: video válida → processor VIDEO, RPC video, 200', async () => {
    const payload = makeVideoPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    const processorArgs = mockDownloadAndStoreInboundMedia.mock.calls[0][0];
    expect(processorArgs.companyId).toBe(FAKE_COMPANY_ID);
    expect(processorArgs.mediaId).toBe(FAKE_MEDIA_ID);
    expect(processorArgs.expectedMediaType).toBe('VIDEO');
    expect(processorArgs.maxBytes).toBe(16 * 1024 * 1024);
    expect(processorArgs.hintFilename).toBeUndefined();
    expect(processorArgs.token).toBe(FAKE_PLAIN_TOKEN);

    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcArgs] = mockSvc.rpc.mock.calls[0];
    expect(rpcName).toBe('process_meta_inbound_media_message');
    expect(rpcArgs).toMatchObject({
      p_company_id:     FAKE_COMPANY_ID,
      p_instance_id:    FAKE_INSTANCE_ID,
      p_media_asset_id: FAKE_ASSET_ID,
      p_message_type:   'video',
    });
    expect(rpcArgs).not.toHaveProperty('p_body');

    const credCalls = mockSvc.from.mock.calls.filter(([t]) => t === 'meta_whatsapp_credentials');
    expect(credCalls.length).toBe(1);
    expect(mockDecryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN_ENC);
  });

  it('W-VID-02 | video.id ausente → skip 200; zero decrypt/download/RPC', async () => {
    const payload = makeVideoPayload({ messages: [makeVideoMessage({ videoId: null })] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-VID-03 | TEXT + VIDEO no mesmo payload → ambos processados; 200', async () => {
    const textMsg = makeInboundMessage({ id: 'wamid_text_vid_01', body: 'Olá' });
    const vidMsg  = makeVideoMessage({ id: 'wamid_vid_ok_01' });
    const payload = makeInboundPayload({ messages: [textMsg, vidMsg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));

    mockSvc.rpc
      .mockResolvedValueOnce({ data: { created: true }, error: null })
      .mockResolvedValueOnce({ data: { created: true }, error: null });

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_message');
    expect(mockSvc.rpc.mock.calls[1][0]).toBe('process_meta_inbound_media_message');
    expect(mockSvc.rpc.mock.calls[1][1].p_message_type).toBe('video');
  });

  it('W-VID-04 | DOCUMENT e IMAGE continuam no pipeline após VIDEO ser suportada', async () => {
    const docPayload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(docPayload)));
    setupDocumentDb();

    const docReq = makePostReq();
    const docRes = makeRes();
    await handler(docReq, docRes);

    expect(docRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].expectedMediaType).toBe('DOCUMENT');
    expect(mockSvc.rpc.mock.calls[0][1].p_message_type).toBe('document');

    const imgPayload = makeImagePayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(imgPayload)));
    setupDocumentDb();

    const imgReq = makePostReq();
    const imgRes = makeRes();
    await handler(imgReq, imgRes);

    expect(imgRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[1][0].expectedMediaType).toBe('IMAGE');
    expect(mockSvc.rpc.mock.calls[1][1].p_message_type).toBe('image');
  });
});

// =============================================================================
// Helpers — AUDIO inbound (MVP5.B3.2.B)
// =============================================================================

function makeAudioMessage({
  id        = FAKE_INBOUND_WAMID,
  from      = FAKE_WA_ID,
  timestamp = FAKE_TIMESTAMP,
  audioId   = FAKE_MEDIA_ID,
  mime_type = 'audio/ogg; codecs=opus',
  voice     = true,
  sha256    = 'sha256_fake_audio_for_tests',
} = {}) {
  const msg = { id, from, type: 'audio', timestamp };
  if (audioId === null) return msg;
  msg.audio = { id: audioId, mime_type, sha256, voice };
  return msg;
}

function makeAudioPayload({
  messages = [makeAudioMessage()],
  contacts = [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
  statuses = null,
  phoneId  = FAKE_PHONE_NUM_ID,
} = {}) {
  return makeInboundPayload({ messages, contacts, statuses, phoneId });
}

// =============================================================================
// W-AUD — POST inbound AUDIO (MVP5.B3.2.B)
// =============================================================================

describe('POST — inbound AUDIO (MVP5.B3.2.B)', () => {
  it('W-AUD-A: audio OGG válido → processor AUDIO, RPC audio, 200', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    const processorArgs = mockDownloadAndStoreInboundMedia.mock.calls[0][0];
    expect(processorArgs.companyId).toBe(FAKE_COMPANY_ID);
    expect(processorArgs.mediaId).toBe(FAKE_MEDIA_ID);
    expect(processorArgs.expectedMediaType).toBe('AUDIO');
    expect(processorArgs.maxBytes).toBe(16 * 1024 * 1024);
    expect(processorArgs.hintFilename).toBeUndefined();
    expect(processorArgs.token).toBe(FAKE_PLAIN_TOKEN);
    expect(processorArgs).not.toHaveProperty('voice');

    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    const [rpcName, rpcArgs] = mockSvc.rpc.mock.calls[0];
    expect(rpcName).toBe('process_meta_inbound_media_message');
    expect(rpcArgs).toMatchObject({
      p_company_id:     FAKE_COMPANY_ID,
      p_instance_id:    FAKE_INSTANCE_ID,
      p_media_asset_id: FAKE_ASSET_ID,
      p_message_type:   'audio',
    });
    expect(rpcArgs).not.toHaveProperty('p_body');
    expect(rpcArgs).not.toHaveProperty('p_voice');
    expect(JSON.stringify(rpcArgs)).not.toContain('sha256_fake_audio_for_tests');
  });

  it('W-AUD-C: voice true e false → mesma RPC; flag não persistida', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(
      makeAudioPayload({ messages: [makeAudioMessage({ voice: true })] }),
    )));
    setupDocumentDb();
    await handler(makePostReq(), makeRes());

    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(
      makeAudioPayload({ messages: [makeAudioMessage({ id: 'wamid.voice_false', voice: false })] }),
    )));
    setupDocumentDb();
    await handler(makePostReq(), makeRes());

    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[0][1].p_message_type).toBe('audio');
    expect(mockSvc.rpc.mock.calls[1][1].p_message_type).toBe('audio');
    expect(mockSvc.rpc.mock.calls[0][1]).not.toHaveProperty('p_voice');
    expect(mockSvc.rpc.mock.calls[1][1]).not.toHaveProperty('p_voice');
    expect(JSON.stringify(mockSvc.rpc.mock.calls[0][1])).not.toContain('"voice"');
    expect(JSON.stringify(mockSvc.rpc.mock.calls[1][1])).not.toContain('"voice"');
  });

  it.each([
    ['ausente', makeAudioMessage({ audioId: null })],
    ['vazio', makeAudioMessage({ audioId: '' })],
    ['whitespace', makeAudioMessage({ audioId: '   ' })],
    ['não-string', (() => {
      const msg = makeAudioMessage({ audioId: null });
      msg.audio = { id: 123, mime_type: 'audio/ogg', voice: true };
      return msg;
    })()],
  ])('W-AUD-D: audio.id %s → skip 200; zero decrypt/download/RPC', async (_label, msg) => {
    const payload = makeAudioPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-I: inbound_media_type_mismatch → 200; zero RPC', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_type_mismatch'),
    );

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-G: inbound_media_too_large → 200; zero RPC', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_too_large'),
    );

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-H: falha transitória de download → HTTP 500', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockDownloadAndStoreInboundMedia.mockRejectedValueOnce(
      makeMediaError('inbound_media_download_failed'),
    );

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(500);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-J: wamid já persistido → 200; zero decrypt/download/RPC', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain({ id: 'existing-audio-uuid' }));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-K: HMAC inválido → 401; zero DB; zero RPC', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
  });

  it('W-AUD-L: company_id/instance_id do payload ignorados; usa instância', async () => {
    const spoofCompany  = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const spoofInstance = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const payload = makeAudioPayload();
    payload.entry[0].id = spoofCompany;
    payload.entry[0].changes[0].value.metadata.company_id = spoofCompany;
    payload.entry[0].changes[0].value.metadata.instance_id = spoofInstance;
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].companyId).toBe(FAKE_COMPANY_ID);
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).toBe(FAKE_COMPANY_ID);
    expect(mockSvc.rpc.mock.calls[0][1].p_instance_id).toBe(FAKE_INSTANCE_ID);
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).not.toBe(spoofCompany);
  });

  it('W-AUD-M: RPC falha → HTTP 500', async () => {
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockSvc.rpc.mockResolvedValueOnce({ data: null, error: { message: 'db error' } });

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal error' });
  });

  it('W-AUD-N: regressão text/button/image/video/document intactos', async () => {
    const textPayload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(textPayload)));
    setupInboundDb();
    const textRes = makeRes();
    await handler(makePostReq(), textRes);
    expect(textRes._status).toBe(200);
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_message');
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toBe(FAKE_BODY);

    const btnPayload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(btnPayload)));
    setupInboundDb();
    const btnRes = makeRes();
    await handler(makePostReq(), btnRes);
    expect(btnRes._status).toBe(200);
    expect(mockSvc.rpc.mock.calls[1][1].p_body).toBe(FAKE_BUTTON_TEXT);

    const docPayload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(docPayload)));
    setupDocumentDb();
    const docRes = makeRes();
    await handler(makePostReq(), docRes);
    expect(docRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].expectedMediaType).toBe('DOCUMENT');
  });

  it('W-AUD-O: location/sticker/unknown continuam skipped', async () => {
    const skipped = makeInboundPayload({
      messages: [
        { id: 'wamid_loc_aud', from: FAKE_WA_ID, type: 'location', location: { latitude: 0, longitude: 0 }, timestamp: FAKE_TIMESTAMP },
        { id: 'wamid_stk_aud', from: FAKE_WA_ID, type: 'sticker', sticker: { id: '2' }, timestamp: FAKE_TIMESTAMP },
        { id: 'wamid_unk_aud', from: FAKE_WA_ID, type: 'unknown', timestamp: FAKE_TIMESTAMP },
      ],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(skipped)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const skipRes = makeRes();
    await handler(makePostReq(), skipRes);
    expect(skipRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('W-AUD-P: logs não contêm wa_id, token, media_id, voice nem MIME de payload', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = makeAudioPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupDocumentDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    const logs = collectHandlerLogs(logSpy, errSpy);
    expect(logs).not.toContain(FAKE_WA_ID);
    expect(logs).not.toContain(FAKE_PLAIN_TOKEN);
    expect(logs).not.toContain(FAKE_APP_SECRET);
    expect(logs).not.toContain(FAKE_MEDIA_ID);
    expect(logs).not.toContain('audio/ogg');
    expect(logs).not.toContain('codecs=opus');
    expect(logs).not.toContain('sha256_fake_audio_for_tests');
    expect(logs.toLowerCase()).not.toContain('voice=true');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WA_ID);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_MEDIA_ID);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// =============================================================================
// MVP4C.12.A1 — inbound type=button (QUICK_REPLY)
// =============================================================================

const FAKE_BUTTON_TEXT = 'Confirmar';
const FAKE_QR_PAYLOAD  = 'lovoo:qr:v1:hello_world:pt_BR:0';

function makeButtonMessage({
  id        = FAKE_INBOUND_WAMID,
  from      = FAKE_WA_ID,
  timestamp = FAKE_TIMESTAMP,
  text      = FAKE_BUTTON_TEXT,
  payload   = FAKE_QR_PAYLOAD,
  button    = undefined,
} = {}) {
  const msg = { id, from, type: 'button', timestamp };
  if (button === null) return msg;
  if (button !== undefined) {
    msg.button = button;
    return msg;
  }
  msg.button = {};
  if (text !== undefined) msg.button.text = text;
  if (payload !== undefined) msg.button.payload = payload;
  return msg;
}

function expectedTextRpcArgs({
  body = FAKE_BUTTON_TEXT,
  wamid = FAKE_INBOUND_WAMID,
} = {}) {
  return {
    p_company_id:         FAKE_COMPANY_ID,
    p_instance_id:        FAKE_INSTANCE_ID,
    p_wa_id:              FAKE_WA_ID,
    p_meta_message_id:    wamid,
    p_body:               body,
    p_contact_name:       FAKE_CONTACT_NAME,
    p_provider_timestamp: new Date(Number(FAKE_TIMESTAMP) * 1000).toISOString(),
  };
}

describe('POST — inbound BUTTON / QUICK_REPLY (MVP4C.12)', () => {
  it('BTN-01: type=button texto válido → RPC com body do botão; HTTP 200', async () => {
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const req = makePostReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).toHaveBeenCalledWith(
      'process_meta_inbound_message',
      expectedTextRpcArgs(),
    );
    expect(mockSvc.from.mock.calls[0][0]).toBe('meta_whatsapp_instances');
  });

  it('BTN-02: payload presente não altera body; payload ausente também persiste', async () => {
    const withPayload = makeInboundPayload({
      messages: [makeButtonMessage({ text: 'Confirmar', payload: FAKE_QR_PAYLOAD })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(withPayload)));
    setupInboundDb();
    await handler(makePostReq(), makeRes());
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toBe('Confirmar');
    expect(mockSvc.rpc.mock.calls[0][1]).not.toHaveProperty('p_payload');
    expect(JSON.stringify(mockSvc.rpc.mock.calls[0][1])).not.toContain(FAKE_QR_PAYLOAD);

    const noPayload = makeInboundPayload({
      messages: [makeButtonMessage({ text: 'Confirmar', payload: undefined })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(noPayload)));
    setupInboundDb();
    await handler(makePostReq(), makeRes());
    expect(mockSvc.rpc.mock.calls[1][1].p_body).toBe('Confirmar');
    expect(JSON.stringify(mockSvc.rpc.mock.calls[1][1])).not.toContain('payload');
  });

  it('BTN-03: payload não aparece em logs nem na resposta HTTP', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    const logs = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .map(c => c.join(' '))
      .join('\n');
    expect(logs).not.toContain(FAKE_QR_PAYLOAD);
    expect(logs).not.toContain('payload');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_QR_PAYLOAD);
    expect(JSON.stringify(res._body)).not.toContain('payload');
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it.each([
    ['button ausente', makeButtonMessage({ button: null })],
    ['text ausente', makeButtonMessage({ button: { payload: FAKE_QR_PAYLOAD } })],
    ['text não-string', makeButtonMessage({ button: { text: 1, payload: FAKE_QR_PAYLOAD } })],
    ['text vazio', makeButtonMessage({ text: '', payload: FAKE_QR_PAYLOAD })],
    ['text whitespace', makeButtonMessage({ text: '   ', payload: FAKE_QR_PAYLOAD })],
  ])('BTN-04: %s → HTTP 200; RPC 0; payload não é fallback', async (_label, msg) => {
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(res._body)).not.toContain(FAKE_QR_PAYLOAD);
  });

  it('BTN-05: HMAC inválido → 401; zero DB; zero RPC', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('BTN-06: instância ausente → HTTP 200; zero RPC; company_id não vem do payload', async () => {
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(null));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(res._body)).not.toContain(FAKE_COMPANY_ID);
  });

  it('BTN-07: RPC erro → HTTP 500; corpo sem payload', async () => {
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb({ rpcResult: makeRpcResult({ error: { message: 'db constraint error' } }) });

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal error' });
    expect(JSON.stringify(res._body)).not.toContain(FAKE_QR_PAYLOAD);
  });

  it('BTN-08: text inbound continua na RPC existente', async () => {
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

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

  it('BTN-09: button e interactive no mesmo payload → ambos persistidos via RPC de texto', async () => {
    const messages = [
      makeButtonMessage({ id: 'wamid.INBOUND_FAKE_BTN_MIX' }),
      makeInteractiveMessage({
        id: 'wamid.INBOUND_FAKE_INT_MIX',
        subtype: 'button_reply',
        title: 'Opção A',
      }),
    ];
    const payload = makeInboundPayload({ messages });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc
      .mockResolvedValueOnce(makeRpcResult())
      .mockResolvedValueOnce(makeRpcResult());

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[0]).toEqual([
      'process_meta_inbound_message',
      expectedTextRpcArgs({ body: FAKE_BUTTON_TEXT, wamid: 'wamid.INBOUND_FAKE_BTN_MIX' }),
    ]);
    expect(mockSvc.rpc.mock.calls[1]).toEqual([
      'process_meta_inbound_message',
      expectedTextRpcArgs({ body: 'Opção A', wamid: 'wamid.INBOUND_FAKE_INT_MIX' }),
    ]);
  });

  it('BTN-10: sticker continua skipped; document intacto', async () => {
    const skipped = makeInboundPayload({
      messages: [
        { id: 'wamid_stk_btn', from: FAKE_WA_ID, type: 'sticker', sticker: { id: '2' }, timestamp: FAKE_TIMESTAMP },
      ],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(skipped)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const skipRes = makeRes();
    await handler(makePostReq(), skipRes);
    expect(skipRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    const docPayload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(docPayload)));
    setupDocumentDb();
    const docRes = makeRes();
    await handler(makePostReq(), docRes);
    expect(docRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc.mock.calls[0][1].p_message_type).toBe('document');
  });
});

// =============================================================================
// MVP5.B3.1 — inbound type=interactive (button_reply / list_reply)
// =============================================================================

const FAKE_INTERACTIVE_BUTTON_TITLE = 'Confirmar pedido';
const FAKE_INTERACTIVE_LIST_TITLE   = 'Plano mensal';
const FAKE_INTERACTIVE_OPTION_ID    = 'opt_internal_id_never_persist';
const FAKE_INTERACTIVE_DESCRIPTION  = 'Descrição da opção — nunca persistir';
const MAX_INBOUND_TEXT_BODY_LENGTH  = 4096;

function makeInteractiveMessage({
  id          = FAKE_INBOUND_WAMID,
  from        = FAKE_WA_ID,
  timestamp   = FAKE_TIMESTAMP,
  subtype     = 'button_reply',
  title       = FAKE_INTERACTIVE_BUTTON_TITLE,
  optionId    = FAKE_INTERACTIVE_OPTION_ID,
  interactive = undefined,
} = {}) {
  const msg = { id, from, type: 'interactive', timestamp };
  if (interactive === null) return msg;
  if (interactive !== undefined) {
    msg.interactive = interactive;
    return msg;
  }

  const reply = { id: optionId, title };
  if (subtype === 'list_reply') {
    reply.description = FAKE_INTERACTIVE_DESCRIPTION;
    msg.interactive = { type: 'list_reply', list_reply: reply };
  } else {
    msg.interactive = { type: subtype, button_reply: reply };
  }
  return msg;
}

function collectHandlerLogs(logSpy, errSpy) {
  return [...logSpy.mock.calls, ...errSpy.mock.calls]
    .map(c => c.map(part => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '))
    .join('\n');
}

describe('POST — inbound INTERACTIVE (MVP5.B3.1)', () => {
  it('INT-A: button_reply válido → RPC de texto com title; HTTP 200', async () => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({ subtype: 'button_reply' })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).toHaveBeenCalledWith(
      'process_meta_inbound_message',
      expectedTextRpcArgs({ body: FAKE_INTERACTIVE_BUTTON_TITLE }),
    );
    expect(mockSvc.rpc.mock.calls[0][1]).not.toHaveProperty('p_message_type');
    expect(JSON.stringify(mockSvc.rpc.mock.calls[0][1])).not.toContain(FAKE_INTERACTIVE_OPTION_ID);
  });

  it('INT-B: list_reply válido → RPC de texto com title; HTTP 200', async () => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({
        subtype: 'list_reply',
        title: FAKE_INTERACTIVE_LIST_TITLE,
      })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).toHaveBeenCalledWith(
      'process_meta_inbound_message',
      expectedTextRpcArgs({ body: FAKE_INTERACTIVE_LIST_TITLE }),
    );
    expect(JSON.stringify(mockSvc.rpc.mock.calls[0][1])).not.toContain(FAKE_INTERACTIVE_OPTION_ID);
    expect(JSON.stringify(mockSvc.rpc.mock.calls[0][1])).not.toContain(FAKE_INTERACTIVE_DESCRIPTION);
  });

  it('INT-C: title com espaços → persiste somente o valor após trim', async () => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({ title: '  Confirmar pedido  ' })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toBe('Confirmar pedido');
  });

  it.each([
    ['title vazio', ''],
    ['title somente espaços', '   '],
    ['title só quebra de linha', '\n\t'],
  ])('INT-D: %s → HTTP 200; RPC 0', async (_label, title) => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({ title })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['number', 1],
    ['boolean', true],
    ['object', { nested: 'x' }],
    ['array', ['x']],
    ['null', null],
  ])('INT-E: title %s → HTTP 200; RPC 0', async (_label, title) => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({ title })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('INT-F: title acima de 4096 após trim → skip; 4096 persiste', async () => {
    const over = 'A'.repeat(MAX_INBOUND_TEXT_BODY_LENGTH + 1);
    const overPayload = makeInboundPayload({
      messages: [makeInteractiveMessage({ title: over })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(overPayload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const overRes = makeRes();
    await handler(makePostReq(), overRes);

    expect(overRes._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    const exact = 'B'.repeat(MAX_INBOUND_TEXT_BODY_LENGTH);
    const exactPayload = makeInboundPayload({
      messages: [makeInteractiveMessage({ id: 'wamid.INBOUND_FAKE_INT_MAX', title: exact })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(exactPayload)));
    setupInboundDb();

    const exactRes = makeRes();
    await handler(makePostReq(), exactRes);

    expect(exactRes._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toBe(exact);
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toHaveLength(MAX_INBOUND_TEXT_BODY_LENGTH);
  });

  it.each([
    ['nfm_reply', 'nfm_reply'],
    ['product_list', 'product_list'],
    ['button', 'button'],
    ['desconhecido', 'unknown_subtype'],
  ])('INT-G: interactive.type=%s → HTTP 200; RPC 0', async (_label, subtype) => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({
        subtype,
        title: FAKE_INTERACTIVE_BUTTON_TITLE,
      })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['interactive ausente', makeInteractiveMessage({ interactive: null })],
    ['interactive não-objeto', makeInteractiveMessage({ interactive: 'x' })],
    ['button_reply null', {
      id: FAKE_INBOUND_WAMID,
      from: FAKE_WA_ID,
      type: 'interactive',
      timestamp: FAKE_TIMESTAMP,
      interactive: { type: 'button_reply', button_reply: null },
    }],
    ['button_reply ausente', {
      id: FAKE_INBOUND_WAMID,
      from: FAKE_WA_ID,
      type: 'interactive',
      timestamp: FAKE_TIMESTAMP,
      interactive: { type: 'button_reply' },
    }],
    ['list_reply ausente', {
      id: FAKE_INBOUND_WAMID,
      from: FAKE_WA_ID,
      type: 'interactive',
      timestamp: FAKE_TIMESTAMP,
      interactive: { type: 'list_reply' },
    }],
    ['title ausente', {
      id: FAKE_INBOUND_WAMID,
      from: FAKE_WA_ID,
      type: 'interactive',
      timestamp: FAKE_TIMESTAMP,
      interactive: { type: 'button_reply', button_reply: { id: FAKE_INTERACTIVE_OPTION_ID } },
    }],
    ['interactive array', makeInteractiveMessage({ interactive: [] })],
  ])('INT-H: %s → HTTP 200; RPC 0', async (_label, msg) => {
    const payload = makeInboundPayload({ messages: [msg] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('INT-I: mesmo wamid com created=false → HTTP 200; RPC ainda chamada (dedup na RPC)', async () => {
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage()],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb({ rpcResult: makeRpcResult({ created: false }) });

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe(FAKE_INBOUND_WAMID);
  });

  it('INT-J: HMAC inválido → 401; zero DB; zero RPC', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage()],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('INT-K: company_id e instance_id vêm da instância, não do payload', async () => {
    const spoofCompany  = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const spoofInstance = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage()],
    });
    payload.entry[0].id = spoofCompany;
    payload.entry[0].changes[0].value.metadata.company_id = spoofCompany;
    payload.entry[0].changes[0].value.metadata.instance_id = spoofInstance;

    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.from.mock.calls[0][0]).toBe('meta_whatsapp_instances');
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).toBe(FAKE_COMPANY_ID);
    expect(mockSvc.rpc.mock.calls[0][1].p_instance_id).toBe(FAKE_INSTANCE_ID);
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).not.toBe(spoofCompany);
    expect(mockSvc.rpc.mock.calls[0][1].p_instance_id).not.toBe(spoofInstance);
  });

  it('INT-L: regressão button.text → RPC inalterada', async () => {
    const payload = makeInboundPayload({ messages: [makeButtonMessage()] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.rpc).toHaveBeenCalledWith(
      'process_meta_inbound_message',
      expectedTextRpcArgs(),
    );
  });

  it('INT-M: regressão text → RPC inalterada', async () => {
    const payload = makeInboundPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

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

  it('INT-N: location/sticker/unknown continuam skipped; document intacto', async () => {
    const skipped = makeInboundPayload({
      messages: [
        { id: 'wamid_loc_int', from: FAKE_WA_ID, type: 'location', location: { latitude: 0, longitude: 0 }, timestamp: FAKE_TIMESTAMP },
        { id: 'wamid_stk_int', from: FAKE_WA_ID, type: 'sticker', sticker: { id: '2' }, timestamp: FAKE_TIMESTAMP },
        { id: 'wamid_unk_int', from: FAKE_WA_ID, type: 'unknown', timestamp: FAKE_TIMESTAMP },
      ],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(skipped)));
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    const skipRes = makeRes();
    await handler(makePostReq(), skipRes);
    expect(skipRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    const docPayload = makeDocumentPayload();
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(docPayload)));
    setupDocumentDb();
    const docRes = makeRes();
    await handler(makePostReq(), docRes);
    expect(docRes._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].expectedMediaType).toBe('DOCUMENT');
    expect(mockSvc.rpc.mock.calls[0][1].p_message_type).toBe('document');
  });

  it('INT-O: logs e resposta HTTP não contém title, wa_id, option id, token nem payload interativo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = makeInboundPayload({
      messages: [makeInteractiveMessage({
        subtype: 'list_reply',
        title: FAKE_INTERACTIVE_LIST_TITLE,
      })],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    setupInboundDb();

    const res = makeRes();
    await handler(makePostReq(), res);

    const logs = collectHandlerLogs(logSpy, errSpy);
    expect(logs).not.toContain(FAKE_INTERACTIVE_LIST_TITLE);
    expect(logs).not.toContain(FAKE_INTERACTIVE_OPTION_ID);
    expect(logs).not.toContain(FAKE_INTERACTIVE_DESCRIPTION);
    expect(logs).not.toContain(FAKE_WA_ID);
    expect(logs).not.toContain(FAKE_PLAIN_TOKEN);
    expect(logs).not.toContain(FAKE_APP_SECRET);
    expect(logs).not.toContain('list_reply');
    expect(logs).not.toContain('button_reply');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_INTERACTIVE_LIST_TITLE);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_INTERACTIVE_OPTION_ID);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WA_ID);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// =============================================================================
// MVP5.B1.2 — sinal Realtime via touch de meta_messages.updated_at
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — chat touch (MVP5.B1.2)', () => {
  async function runApplied({
    currentStatus = 'accepted',
    newStatus     = 'sent',
    touchData     = [{ id: 'chat-touch-row' }],
    touchErr      = null,
  } = {}) {
    const payload = makePayload({
      statuses: [{ id: FAKE_WAMID, status: newStatus, timestamp: FAKE_TIMESTAMP }],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const tracking = makeUpdateChain();
    const touch    = makeChatTouchChain(touchData, touchErr);
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: currentStatus }))
      .mockReturnValueOnce(tracking)
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(makePostReq(), res);
    return { res, tracking, touch };
  }

  it.each([
    ['accepted', 'sent'],
    ['sent',     'delivered'],
    ['delivered','read'],
    ['sent',     'failed'],
  ])('RT-WH-01: %s → %s aplicado → touch em meta_messages', async (currentStatus, newStatus) => {
    const { res, tracking, touch } = await runApplied({ currentStatus, newStatus });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(tracking.update).toHaveBeenCalled();
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(touch.update.mock.calls[0][0]).toEqual({ updated_at: expect.any(String) });
    expect(Object.keys(touch.update.mock.calls[0][0])).toEqual(['updated_at']);
    expect(mockSvc.from.mock.calls[3][0]).toBe('meta_messages');
  });

  it('RT-WH-02: duplicata exata (sent→sent) toca sem alterar o tracking', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'sent' }))
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(touch.update.mock.calls[0][0]).toEqual({ updated_at: expect.any(String) });
    expect(touch.eq).toHaveBeenNthCalledWith(1, 'company_id', FAKE_COMPANY_ID);
    expect(touch.eq).toHaveBeenNthCalledWith(2, 'instance_id', FAKE_INSTANCE_ID);
    expect(touch.eq).toHaveBeenNthCalledWith(3, 'meta_message_id', FAKE_WAMID);
    expect(touch.eq).toHaveBeenNthCalledWith(4, 'direction', 'outbound');
    expect(mockSvc.from.mock.calls.map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
      'meta_messages',
    ]);
  });

  it('RT-WH-03: fora de ordem (delivered→sent) → sem regressão e sem touch', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const tracking = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({ id: FAKE_MSG_ID, status: 'delivered' }))
      .mockReturnValueOnce(tracking);
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(200);
    expect(tracking.update).not.toHaveBeenCalled();
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });

  it('RT-WH-04: wamid desconhecido → sem touch', async () => {
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'delivered', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null));
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
    expect(mockSvc.from.mock.calls.map((c) => c[0])).not.toContain('meta_messages');
  });

  it('RT-WH-05: mensagem ainda ausente no chat → zero linhas, sem INSERT', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { res, tracking, touch } = await runApplied({ touchData: [] });
    expect(res._status).toBe(200);
    expect(tracking.update).toHaveBeenCalled();
    expect(touch.update).toHaveBeenCalled();
    expect(touch.select).toHaveBeenCalledWith('id');
    expect(JSON.stringify(res._body)).not.toContain('insert');
    spy.mockRestore();
  });

  it('RT-WH-06: isolamento company_id + instance_id no touch', async () => {
    const { res, touch } = await runApplied({ newStatus: 'delivered', currentStatus: 'sent' });
    expect(res._status).toBe(200);
    expect(touch.eq).toHaveBeenNthCalledWith(1, 'company_id', FAKE_COMPANY_ID);
    expect(touch.eq).toHaveBeenNthCalledWith(2, 'instance_id', FAKE_INSTANCE_ID);
    expect(touch.eq).toHaveBeenNthCalledWith(3, 'meta_message_id', FAKE_WAMID);
    expect(touch.eq).toHaveBeenNthCalledWith(4, 'direction', 'outbound');
  });

  it('RT-WH-07: falha no UPDATE de meta_messages → 500, tracking preservado, log sanitizado', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, tracking, touch } = await runApplied({
      touchErr: { message: 'query timeout' },
    });
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal error' });
    expect(tracking.update).toHaveBeenCalled();
    expect(touch.update).toHaveBeenCalled();
    expect(JSON.stringify(res._body)).not.toContain('query timeout');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(logged).toContain('chat_touch_failed');
    expect(logged).not.toContain(FAKE_WAMID);
    spy.mockRestore();
  });

  it('RT-WH-08: HMAC inválido → nenhuma operação, inclusive sem touch', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const payload = makePayload({ statuses: [{ id: FAKE_WAMID, status: 'sent', timestamp: FAKE_TIMESTAMP }] });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('RT-WH-09: contrato HTTP preservado após touch (200 received:true)', async () => {
    const { res } = await runApplied();
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
    expect(JSON.stringify(res._body)).not.toContain('updated_at');
  });
});

// =============================================================================
// Compare-and-swap do status outbound
// Simulação determinística com mocks. Não exercita duas transações
// PostgreSQL concorrentes.
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — status compare-and-swap', () => {
  const OTHER_COMPANY_ID  = 'ffff0000-0000-0000-0000-000000000099';
  const OTHER_INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000098';

  function trackingRow(status, extra = {}) {
    return {
      id:          FAKE_MSG_ID,
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      status,
      ...extra,
    };
  }

  function postStatus(status, extra = {}) {
    const payload = makePayload({
      statuses: [{
        id: FAKE_WAMID,
        status,
        timestamp: FAKE_TIMESTAMP,
        ...extra,
      }],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    return makePostReq();
  }

  function casFilters(chain) {
    return Object.fromEntries(chain.eq.mock.calls);
  }

  function expectScopedRead(selectChain) {
    expect(selectChain.select).toHaveBeenCalledWith('id, company_id, instance_id, status');
    expect(casFilters(selectChain)).toEqual({
      company_id:      FAKE_COMPANY_ID,
      instance_id:     FAKE_INSTANCE_ID,
      meta_message_id: FAKE_WAMID,
    });
  }

  function expectCas(chain, previousStatus, payloadFields) {
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(casFilters(chain)).toEqual({
      id:          FAKE_MSG_ID,
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      status:      previousStatus,
    });
    const payload = chain.update.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(payloadFields.sort());
    expect(payload.status).toBe(payloadFields.includes('status') ? payload.status : undefined);
    return payload;
  }

  it('A/B: sent→delivered e delivered→read gravam só o timestamp da transição', async () => {
    const deliveredSelect = makeMsgSelectChain(trackingRow('sent'));
    const deliveredUpdate = makeUpdateChain();
    const deliveredTouch  = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(deliveredSelect)
      .mockReturnValueOnce(deliveredUpdate)
      .mockReturnValueOnce(deliveredTouch);

    const deliveredRes = makeRes();
    await handler(postStatus('delivered'), deliveredRes);

    expect(deliveredRes._status).toBe(200);
    expectScopedRead(deliveredSelect);
    const deliveredPayload = expectCas(
      deliveredUpdate,
      'sent',
      ['status', 'delivered_at', 'updated_at'],
    );
    expect(deliveredPayload.status).toBe('delivered');
    expect(deliveredPayload.delivered_at).toBe(new Date(Number(FAKE_TIMESTAMP) * 1000).toISOString());
    expect(deliveredPayload).not.toHaveProperty('read_at');
    expect(deliveredPayload).not.toHaveProperty('error_code');
    expect(deliveredTouch.update).toHaveBeenCalledTimes(1);

    vi.resetAllMocks();
    mockGetMetaServerConfig.mockReturnValue({ appSecret: FAKE_APP_SECRET });
    mockGetMetaWebhookConfig.mockReturnValue({ verifyToken: FAKE_VERIFY_TOKEN });
    mockVerifyMetaWebhookSignature.mockReturnValue(true);

    const readSelect = makeMsgSelectChain(trackingRow('delivered'));
    const readUpdate = makeUpdateChain();
    const readTouch  = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(readSelect)
      .mockReturnValueOnce(readUpdate)
      .mockReturnValueOnce(readTouch);

    const readRes = makeRes();
    await handler(postStatus('read'), readRes);

    expect(readRes._status).toBe(200);
    const readPayload = expectCas(readUpdate, 'delivered', ['status', 'read_at', 'updated_at']);
    expect(readPayload.status).toBe('read');
    expect(readPayload).not.toHaveProperty('delivered_at');
    expect(readTouch.update).toHaveBeenCalledTimes(1);
  });

  it('C/D: read não aceita delivered atrasado e sent duplicado não grava', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('read')));
    const lateRes = makeRes();
    await handler(postStatus('delivered'), lateRes);
    expect(lateRes._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');

    const dupTouch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(dupTouch);
    const dupRes = makeRes();
    await handler(postStatus('sent'), dupRes);
    expect(dupRes._status).toBe(200);
    expect(dupTouch.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.slice(2).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
      'meta_messages',
    ]);
  });

  it('E–H: duas leituras de sent; read vence e delivered atrasado vira NOOP', async () => {
    const firstRead  = makeMsgSelectChain(trackingRow('sent'));
    const lostUpdate = makeUpdateChain(null, []);
    const reread     = makeMsgSelectChain(trackingRow('read'));
    const touch      = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(firstRead)
      .mockReturnValueOnce(lostUpdate)
      .mockReturnValueOnce(reread)
      .mockReturnValueOnce(touch);

    const res = makeRes();
    await handler(postStatus('delivered'), res);

    expect(res._status).toBe(200);
    expect(lostUpdate.update).toHaveBeenCalledTimes(1);
    expectCas(lostUpdate, 'sent', ['status', 'delivered_at', 'updated_at']);
    expect(reread.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(reread.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
    expect(touch.update).not.toHaveBeenCalled();
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');
  });

  it('I: releitura ainda permite a transição e a segunda tentativa grava uma vez', async () => {
    const firstUpdate = makeUpdateChain(null, []);
    const secondUpdate = makeUpdateChain();
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(firstUpdate)
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(secondUpdate)
      .mockReturnValueOnce(touch);

    const res = makeRes();
    await handler(postStatus('read'), res);

    expect(res._status).toBe(200);
    expectCas(firstUpdate, 'sent', ['status', 'read_at', 'updated_at']);
    expectCas(secondUpdate, 'sent', ['status', 'read_at', 'updated_at']);
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(firstUpdate.select).toHaveBeenCalledTimes(1);
    expect(secondUpdate.select).toHaveBeenCalledTimes(1);
  });

  it('J: três CAS sem linha e a transição ainda válida → 500, sem touch', async () => {
    const updates = [makeUpdateChain(null, []), makeUpdateChain(null, []), makeUpdateChain(null, [])];
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(updates[0])
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(updates[1])
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(updates[2])
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')));

    const res = makeRes();
    await handler(postStatus('delivered'), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal error' });
    expect(updates.every((chain) => chain.update.mock.calls.length === 1)).toBe(true);
    expect(updates.map((chain) => casFilters(chain).status)).toEqual(['sent', 'sent', 'sent']);
    expect(mockSvc.from).toHaveBeenCalledTimes(8);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');
  });

  it('K: erro de banco no UPDATE → 500 sem releitura e sem touch', async () => {
    const update = makeUpdateChain({ message: 'update timeout' });
    const reread = makeMsgSelectChain(trackingRow('sent'));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('accepted')))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(reread);

    const res = makeRes();
    await handler(postStatus('sent'), res);

    expect(res._status).toBe(500);
    expect(update.update).toHaveBeenCalledTimes(1);
    expect(reread.maybeSingle).not.toHaveBeenCalled();
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  it('L: erro de banco na releitura → 500 sem touch', async () => {
    const update = makeUpdateChain(null, []);
    const reread = makeMsgSelectChain(null, { message: 'select timeout' });
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(reread);

    const res = makeRes();
    await handler(postStatus('delivered'), res);

    expect(res._status).toBe(500);
    expect(update.select).toHaveBeenCalledWith('id');
    expect(reread.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');
  });

  it('M: CAS rejeitado não aplica timestamp nem erro do evento perdedor', async () => {
    const update = makeUpdateChain(null, []);
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('read')));

    const res = makeRes();
    await handler(postStatus('failed', { errors: [{ code: 131047, title: 'SHOULD_NOT_PERSIST' }] }), res);

    expect(res._status).toBe(200);
    const payload = expectCas(update, 'sent', ['status', 'failed_at', 'error_code', 'error_subcode', 'updated_at']);
    expect(payload.status).toBe('failed');
    expect(payload.error_code).toBe(131047);
    expect(JSON.stringify(payload)).not.toContain('SHOULD_NOT_PERSIST');
    expect(payload).not.toHaveProperty('read_at');
    expect(payload).not.toHaveProperty('sent_at');
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');
  });

  it('N: failed permanece terminal e delivered não regride para failed', async () => {
    const fromSent = makeUpdateChain();
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(fromSent)
      .mockReturnValueOnce(touch);
    const applied = makeRes();
    await handler(postStatus('failed', { errors: [{ code: 131026 }] }), applied);
    expect(applied._status).toBe(200);
    const payload = expectCas(fromSent, 'sent', ['status', 'failed_at', 'error_code', 'error_subcode', 'updated_at']);
    expect(payload.error_code).toBe(131026);
    expect(touch.update).toHaveBeenCalledTimes(1);

    const callsAfterApplied = mockSvc.from.mock.calls.length;
    const failedTouch = makeChatTouchChain();
    for (const current of ['delivered', 'read', 'failed']) {
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(trackingRow(current)));
      if (current === 'failed') mockSvc.from.mockReturnValueOnce(failedTouch);
      const res = makeRes();
      await handler(postStatus('failed', { errors: [{ code: 1 }] }), res);
      expect(res._status).toBe(200);
    }
    expect(mockSvc.from).toHaveBeenCalledTimes(callsAfterApplied + 7);
    const tail = mockSvc.from.mock.calls.slice(callsAfterApplied).map((call) => call[0]);
    expect(tail.slice(0, 4)).not.toContain('meta_messages');
    expect(tail.slice(4)).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
      'meta_messages',
    ]);
    expect(failedTouch.update).toHaveBeenCalledTimes(1);
  });

  it('O: leitura e CAS ficam na empresa e instância resolvidas', async () => {
    const selectChain = makeMsgSelectChain(trackingRow('sent'));
    const update = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(makeChatTouchChain());
    const ok = makeRes();
    await handler(postStatus('delivered'), ok);
    expect(ok._status).toBe(200);
    expectScopedRead(selectChain);
    expectCas(update, 'sent', ['status', 'delivered_at', 'updated_at']);

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent', { company_id: OTHER_COMPANY_ID })));
    const companyRes = makeRes();
    await handler(postStatus('delivered'), companyRes);
    expect(companyRes._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(6);

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent', { instance_id: OTHER_INSTANCE_ID })));
    const instanceRes = makeRes();
    await handler(postStatus('read'), instanceRes);
    expect(instanceRes._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(8);
    expect(mockSvc.from.mock.calls.slice(-2).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
    ]);
  });

  it('P: tentativa rejeitada e status nulo não tocam o chat', async () => {
    const rejected = makeUpdateChain(null, []);
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('sent')))
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow('read')));
    const rejectedRes = makeRes();
    await handler(postStatus('delivered'), rejectedRes);
    expect(rejectedRes._status).toBe(200);
    expect(rejected.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');

    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(trackingRow(null)));
    const nullRes = makeRes();
    await handler(postStatus('delivered'), nullRes);
    expect(nullRes._status).toBe(200);
    expect(mockSvc.from).toHaveBeenCalledTimes(6);
    expect(mockSvc.from.mock.calls.slice(-2).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
    ]);
  });

  it('Q: wamid desconhecido continua 200, sem INSERT e sem UPDATE', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null));
    const res = makeRes();
    await handler(postStatus('read'), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
  });
});

// =============================================================================
// Credencial de mídia inbound — falha recuperável
// Mocks. Não acessa banco, Meta nem storage.
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — credencial de mídia', () => {
  function postDocument() {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(makeDocumentPayload())));
    return makePostReq();
  }

  function queueCredential(data, error = null) {
    const credential = makeCredentialChain(data, error);
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(credential);
    return credential;
  }

  it('A: credencial válida mantém download e RPC', async () => {
    const credential = queueCredential(FAKE_CREDENTIAL);
    mockSvc.rpc.mockResolvedValueOnce({ data: { created: true }, error: null });
    const res = makeRes();
    await handler(postDocument(), res);

    expect(res._status).toBe(200);
    expect(credential.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
    expect(credential.select).toHaveBeenCalledWith('access_token_enc');
    expect(mockDecryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN_ENC);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].companyId).toBe(FAKE_COMPANY_ID);
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_media_message');
  });

  it('B/C: erro de banco e timeout pedem retry sem download', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      queueCredential(null, { message: 'connection reset' });
      const dbRes = makeRes();
      await handler(postDocument(), dbRes);
      expect(dbRes._status).toBe(500);
      expect(mockDecryptMetaToken).not.toHaveBeenCalled();
      expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();

      queueCredential(null, { code: '57014', message: 'statement timeout' });
      const timeoutRes = makeRes();
      await handler(postDocument(), timeoutRes);
      expect(timeoutRes._status).toBe(500);
      expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        '[meta/webhook] event_type=%s outcome=%s',
        'inbound_document',
        'credential_lookup_failed',
      );
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain('statement timeout');
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain(FAKE_ACCESS_TOKEN_ENC);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('D/E: credencial ausente e token vazio pedem retry sem descarte silencioso', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      queueCredential(null);
      const missing = makeRes();
      await handler(postDocument(), missing);
      expect(missing._status).toBe(500);
      expect(errSpy).toHaveBeenCalledWith(
        '[meta/webhook] event_type=%s outcome=%s',
        'inbound_document',
        'credential_missing',
      );

      for (const accessTokenEnc of ['', '   ', null]) {
        queueCredential({ access_token_enc: accessTokenEnc });
        const absent = makeRes();
        await handler(postDocument(), absent);
        expect(absent._status).toBe(500);
      }
      expect(errSpy).toHaveBeenCalledWith(
        '[meta/webhook] event_type=%s outcome=%s',
        'inbound_document',
        'credential_token_absent',
      );
      expect(mockDecryptMetaToken).not.toHaveBeenCalled();
      expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('F/G/P: descriptografia e erro inesperado não confirmam sucesso nem vazam segredo', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      queueCredential(FAKE_CREDENTIAL);
      mockDecryptMetaToken.mockImplementationOnce(() => {
        throw new Error(FAKE_PLAIN_TOKEN);
      });
      const decryptRes = makeRes();
      await handler(postDocument(), decryptRes);
      expect(decryptRes._status).toBe(500);
      expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        '[meta/webhook] event_type=%s outcome=%s',
        'inbound_document',
        'credential_decrypt_failed',
      );

      const throwing = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockRejectedValue(new Error(FAKE_ACCESS_TOKEN_ENC)),
      };
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeDedupeChain(null))
        .mockReturnValueOnce(throwing);
      const unexpected = makeRes();
      await handler(postDocument(), unexpected);
      expect(unexpected._status).toBe(500);
      expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).not.toContain(FAKE_PLAIN_TOKEN);
      expect(logged).not.toContain(FAKE_ACCESS_TOKEN_ENC);
      expect(JSON.stringify(decryptRes._body)).not.toContain(FAKE_PLAIN_TOKEN);
      expect(JSON.stringify(unexpected._body)).not.toContain(FAKE_ACCESS_TOKEN_ENC);
    } finally {
      errSpy.mockRestore();
    }
  });

  it.each([
    ['document', () => makeDocumentPayload(), 'inbound_document'],
    ['image', () => makeImagePayload(), 'inbound_image'],
    ['video', () => makeVideoPayload(), 'inbound_video'],
    ['audio', () => makeAudioPayload(), 'inbound_audio'],
  ])('H: %s com falha de credencial não baixa nem envia', async (_type, buildPayload, logEvent) => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(buildPayload())));
    queueCredential(null, { message: 'unavailable' });
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(logEvent.startsWith('inbound_')).toBe(true);
  });

  it('I: falha de credencial não impede a mídia seguinte do lote', async () => {
    const first = makeDocumentMessage({ id: 'wamid_cred_fail', documentId: FAKE_MEDIA_ID });
    const second = makeDocumentMessage({ id: 'wamid_cred_ok', documentId: '999888777666' });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(
      makeDocumentPayload({ messages: [first, second] }),
    )));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(null, { message: 'unavailable' }))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockSvc.rpc.mockResolvedValueOnce({ data: { created: true }, error: null });

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].wamid).toBe('wamid_cred_ok');
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_media_message');
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe('wamid_cred_ok');
  });

  it('J: retry após a credencial voltar persiste a mídia uma vez', async () => {
    queueCredential(null, { message: 'unavailable' });
    const first = makeRes();
    await handler(postDocument(), first);
    expect(first._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();

    queueCredential(FAKE_CREDENTIAL);
    mockSvc.rpc.mockResolvedValueOnce({ data: { created: true }, error: null });
    const second = makeRes();
    await handler(postDocument(), second);
    expect(second._status).toBe(200);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
  });

  it('K/L: mídia já persistida resolve o lead e não consulta credencial nem baixa de novo', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(makeDocumentPayload())));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain({ id: FAKE_MSG_ID, conversation_id: FAKE_CONV_ID }));
    mockSvc.rpc.mockResolvedValueOnce({ data: 'linked_existing', error: null });

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_messages',
    ]);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).toHaveBeenCalledWith('resolve_meta_conversation_lead', expect.objectContaining({
      p_company_id: FAKE_COMPANY_ID,
      p_instance_id: FAKE_INSTANCE_ID,
      p_conversation_id: FAKE_CONV_ID,
    }));
  });

  it('M/N: credencial fica na instância resolvida e HMAC inválido não processa', async () => {
    const credential = queueCredential(FAKE_CREDENTIAL);
    mockSvc.rpc.mockResolvedValueOnce({ data: { created: true }, error: null });
    const ok = makeRes();
    await handler(postDocument(), ok);
    expect(credential.eq.mock.calls).toEqual([['instance_id', FAKE_INSTANCE_ID]]);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].companyId).toBe(FAKE_COMPANY_ID);
    expect(mockDownloadAndStoreInboundMedia.mock.calls[0][0].token).toBe(FAKE_PLAIN_TOKEN);

    mockVerifyMetaWebhookSignature.mockReturnValue(false);
    const denied = makeRes();
    await handler(postDocument(), denied);
    expect(denied._status).toBe(401);
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
  });

  it('O: compare-and-swap de status continua exigindo o status lido', async () => {
    const payload = makePayload({
      statuses: [{ id: FAKE_WAMID, status: 'delivered', timestamp: FAKE_TIMESTAMP }],
    });
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const update = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({
        id: FAKE_MSG_ID,
        company_id: FAKE_COMPANY_ID,
        instance_id: FAKE_INSTANCE_ID,
        status: 'sent',
      }))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(makePostReq(), res);

    expect(res._status).toBe(200);
    expect(Object.fromEntries(update.eq.mock.calls)).toEqual({
      id: FAKE_MSG_ID,
      company_id: FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      status: 'sent',
    });
    expect(update.update.mock.calls[0][0].status).toBe('delivered');
  });
});

// =============================================================================
// Lote inbound — falha de texto não interrompe os eventos seguintes.
// Mocks. A unicidade real do PostgreSQL não é exercitada aqui.
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — continuidade do lote inbound', () => {
  const OTHER_COMPANY_ID  = 'ffff0000-0000-0000-0000-000000000099';
  const OTHER_INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000098';
  const OTHER_PHONE_ID    = '199988877766';
  const OLD_TIMESTAMP     = '1739320000';

  function rpcOk(created = true) {
    return { data: { created, conversation_id: FAKE_CONV_ID, message_id: FAKE_MSG_ID }, error: null };
  }

  function rpcFail(error = { code: 'XX000' }) {
    return { data: null, error };
  }

  function valueWith(messages, phoneId = FAKE_PHONE_NUM_ID) {
    return {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
      contacts: [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
      messages,
    };
  }

  function postEntries(entries) {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: entries,
    })));
    return makePostReq();
  }

  function text(id, timestamp = FAKE_TIMESTAMP, body = FAKE_BODY) {
    return makeInboundMessage({ id, timestamp, body });
  }

  function wamids() {
    return mockSvc.rpc.mock.calls.map((call) => call[1].p_meta_message_id);
  }

  it('A: lote válido permanece HTTP 200 na ordem original', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcOk()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
  });

  it('B/N: a primeira falha não impede a segunda e o sucesso não apaga o 500', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
    expect(mockSvc.rpc.mock.calls[1][1].p_company_id).toBe(FAKE_COMPANY_ID);
  });

  it('C: falha intermediária ainda processa a mensagem seguinte', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcOk()).mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b'), text('wamid.c')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b', 'wamid.c']);
  });

  it('D: falha na última mensagem responde 500 depois de persistir as anteriores', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcOk()).mockResolvedValueOnce(rpcFail());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
  });

  it('E: todas as mensagens com falha respondem 500 e todas são tentadas', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcFail());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
  });

  it('F/H: erro retornado e timeout não interrompem a mensagem seguinte', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc
      .mockResolvedValueOnce(rpcFail({ code: '57014', message: 'statement timeout' }))
      .mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
    expect(JSON.stringify(res._body)).not.toContain('timeout');
  });

  it('G/X: exceção da RPC não vaza corpo nem telefone e o lote continua', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
      mockSvc.rpc
        .mockRejectedValueOnce(new Error(`${FAKE_BODY} ${FAKE_WA_ID}`))
        .mockResolvedValueOnce(rpcOk());
      const res = makeRes();
      await handler(postEntries([{
        changes: [{ field: 'messages', value: valueWith([text('wamid.a', FAKE_TIMESTAMP, FAKE_BODY), text('wamid.b')]) }],
      }]), res);
      expect(res._status).toBe(500);
      expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain('rpc_error=true');
      expect(logged).not.toContain(FAKE_BODY);
      expect(logged).not.toContain(FAKE_WA_ID);
      expect(JSON.stringify(res._body)).not.toContain(FAKE_BODY);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('I: texto com falha não impede a mídia seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([
        text('wamid.text'),
        makeDocumentMessage({ id: 'wamid.doc' }),
      ]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[1][0]).toBe('process_meta_inbound_media_message');
    expect(mockSvc.rpc.mock.calls[1][1].p_meta_message_id).toBe('wamid.doc');
  });

  it('J: mídia com falha de credencial não impede o texto seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(null, { message: 'unavailable' }));
    mockSvc.rpc.mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([
        makeDocumentMessage({ id: 'wamid.doc' }),
        text('wamid.text'),
      ]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe('wamid.text');
  });

  it('K: falha em um change não impede o change seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [
        { field: 'messages', value: valueWith([text('wamid.a')]) },
        { field: 'messages', value: valueWith([text('wamid.b')]) },
      ],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });

  it('L: falha em um entry não impede o entry seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([
      { changes: [{ field: 'messages', value: valueWith([text('wamid.a')]) }] },
      { changes: [{ field: 'messages', value: valueWith([text('wamid.b')]) }] },
    ]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
  });

  it('M: entries de instâncias diferentes mantêm company_id e instance_id próprios', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeInstChain({ id: OTHER_INSTANCE_ID, company_id: OTHER_COMPANY_ID }));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([
      { changes: [{ field: 'messages', value: valueWith([text('wamid.a')], FAKE_PHONE_NUM_ID) }] },
      { changes: [{ field: 'messages', value: valueWith([text('wamid.b')], OTHER_PHONE_ID) }] },
    ]), res);
    expect(res._status).toBe(500);
    expect(mockSvc.rpc.mock.calls[0][1]).toMatchObject({
      p_company_id: FAKE_COMPANY_ID,
      p_instance_id: FAKE_INSTANCE_ID,
      p_meta_message_id: 'wamid.a',
    });
    expect(mockSvc.rpc.mock.calls[1][1]).toMatchObject({
      p_company_id: OTHER_COMPANY_ID,
      p_instance_id: OTHER_INSTANCE_ID,
      p_meta_message_id: 'wamid.b',
    });
  });

  it('O/P/R: retry reenvia os timestamps originais e a mensagem antiga recuperada não troca de empresa', async () => {
    const messages = [
      text('wamid.old', OLD_TIMESTAMP),
      text('wamid.new', FAKE_TIMESTAMP),
    ];
    const entries = [{ changes: [{ field: 'messages', value: valueWith(messages) }] }];
    const oldIso = new Date(Number(OLD_TIMESTAMP) * 1000).toISOString();
    const newIso = new Date(Number(FAKE_TIMESTAMP) * 1000).toISOString();

    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const first = makeRes();
    await handler(postEntries(entries), first);
    expect(first._status).toBe(500);
    expect(mockSvc.rpc.mock.calls[0][1].p_provider_timestamp).toBe(oldIso);
    expect(mockSvc.rpc.mock.calls[1][1].p_provider_timestamp).toBe(newIso);

    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcOk(false)).mockResolvedValueOnce(rpcOk());
    const second = makeRes();
    await handler(postEntries(entries), second);
    expect(second._status).toBe(200);
    expect(mockSvc.rpc.mock.calls.slice(2).map((call) => call[1].p_meta_message_id)).toEqual([
      'wamid.old',
      'wamid.new',
    ]);
    expect(mockSvc.rpc.mock.calls[2][1].p_provider_timestamp).toBe(oldIso);
    expect(mockSvc.rpc.mock.calls[2][1].p_company_id).toBe(FAKE_COMPANY_ID);
    expect(mockSvc.rpc.mock.calls[3][1].p_provider_timestamp).toBe(newIso);
  });

  it('Q: botão e interativo com falha de RPC deixam a mensagem seguinte seguir', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const buttonRes = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([
        makeButtonMessage({ id: 'wamid.button' }),
        text('wamid.after-button'),
      ]) }],
    }]), buttonRes);
    expect(buttonRes._status).toBe(500);
    expect(mockSvc.rpc.mock.calls[0][1].p_body).toBe(FAKE_BUTTON_TEXT);
    expect(mockSvc.rpc.mock.calls[1][1].p_meta_message_id).toBe('wamid.after-button');

    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockResolvedValueOnce(rpcOk());
    const interactiveRes = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([
        makeInteractiveMessage({ id: 'wamid.interactive' }),
        text('wamid.after-interactive'),
      ]) }],
    }]), interactiveRes);
    expect(interactiveRes._status).toBe(500);
    expect(mockSvc.rpc.mock.calls[2][1].p_body).toBe(FAKE_INTERACTIVE_BUTTON_TITLE);
    expect(mockSvc.rpc.mock.calls[3][1].p_meta_message_id).toBe('wamid.after-interactive');
  });

  it('S/T: assinatura inválida e JSON inválido continuam antes de qualquer lote', async () => {
    mockVerifyMetaWebhookSignature.mockReturnValueOnce(false);
    const denied = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a')]) }],
    }]), denied);
    expect(denied._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    mockReadRawBody.mockResolvedValue(Buffer.from('{'));
    const invalid = makeRes();
    await handler(makePostReq(), invalid);
    expect(invalid._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('U: compare-and-swap de status permanece condicional', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(makePayload({
      statuses: [{ id: FAKE_WAMID, status: 'read', timestamp: FAKE_TIMESTAMP }],
    }))));
    const update = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain({
        id: FAKE_MSG_ID,
        company_id: FAKE_COMPANY_ID,
        instance_id: FAKE_INSTANCE_ID,
        status: 'delivered',
      }))
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(makeChatTouchChain());
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(200);
    expect(Object.fromEntries(update.eq.mock.calls).status).toBe('delivered');
    expect(update.update.mock.calls[0][0].status).toBe('read');
  });

  it('V: credencial ausente de mídia continua pedindo retry sem download', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(makeDocumentPayload())));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(null));
    const res = makeRes();
    await handler(makePostReq(), res);
    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  });

  it('W: a resposta espera a RPC ainda pendente do evento seguinte', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = () => resolve(rpcOk());
    });
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(rpcFail()).mockImplementationOnce(() => pending);
    const res = makeRes();
    const done = handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.a'), text('wamid.b')]) }],
    }]), res);
    await vi.waitFor(() => expect(mockSvc.rpc).toHaveBeenCalledTimes(2));
    expect(res._status).toBeNull();
    release();
    await done;
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.a', 'wamid.b']);
  });

  it('retorno null da RPC é falha recuperável e a mensagem seguinte segue', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
      mockSvc.rpc.mockResolvedValueOnce(null).mockResolvedValueOnce(rpcOk());
      const res = makeRes();
      await handler(postEntries([{
        changes: [{ field: 'messages', value: valueWith([text('wamid.null'), text('wamid.next')]) }],
      }]), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'Internal error' });
      expect(wamids()).toEqual(['wamid.null', 'wamid.next']);
      expect(mockSvc.rpc.mock.calls[1][1]).toMatchObject({
        p_company_id: FAKE_COMPANY_ID,
        p_instance_id: FAKE_INSTANCE_ID,
        p_meta_message_id: 'wamid.next',
      });
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain('rpc_error=true');
      expect(logged).not.toContain(FAKE_BODY);
      expect(logged).not.toContain(FAKE_WA_ID);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('retorno undefined da RPC é falha recuperável e a mensagem seguinte segue', async () => {
    mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
    mockSvc.rpc.mockResolvedValueOnce(undefined).mockResolvedValueOnce(rpcOk());
    const res = makeRes();
    await handler(postEntries([{
      changes: [{ field: 'messages', value: valueWith([text('wamid.undefined'), text('wamid.next')]) }],
    }]), res);
    expect(res._status).toBe(500);
    expect(wamids()).toEqual(['wamid.undefined', 'wamid.next']);
  });

  it('created false permanece HTTP 200', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
      mockSvc.rpc.mockResolvedValueOnce(rpcOk(false));
      const res = makeRes();
      await handler(postEntries([{
        changes: [{ field: 'messages', value: valueWith([text('wamid.dup')]) }],
      }]), res);
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ received: true });
      expect(wamids()).toEqual(['wamid.dup']);
      expect(logSpy.mock.calls.some((call) => call[0].includes('created=%s') && call[1] === false)).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('data null e error null permanece sucesso', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockSvc.from.mockReturnValueOnce(makeInstChain(FAKE_INSTANCE));
      mockSvc.rpc.mockResolvedValueOnce({ data: null, error: null });
      const res = makeRes();
      await handler(postEntries([{
        changes: [{ field: 'messages', value: valueWith([text('wamid.empty')]) }],
      }]), res);
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ received: true });
      expect(wamids()).toEqual(['wamid.empty']);
      expect(logSpy.mock.calls.some((call) => call[0].includes('created=%s') && call[1] === false)).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// =============================================================================
// Lote de status — falha recuperável não interrompe os eventos seguintes.
// Mocks. O compare-and-swap real do PostgreSQL não é exercitado aqui.
// A, R, S, T, U, V, W, X e Y permanecem nos testes já existentes.
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — continuidade do lote de status', () => {
  const OTHER_COMPANY_ID  = 'ffff0000-0000-0000-0000-000000000099';
  const OTHER_INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000098';
  const OTHER_PHONE_ID    = '199988877766';

  function row(status, id = FAKE_MSG_ID, companyId = FAKE_COMPANY_ID, instanceId = FAKE_INSTANCE_ID) {
    return { id, company_id: companyId, instance_id: instanceId, status };
  }

  function status(id, name) {
    return { id, status: name, timestamp: FAKE_TIMESTAMP };
  }

  function change(statuses, messages, phoneId = FAKE_PHONE_NUM_ID) {
    const value = {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
      contacts: [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
      statuses,
    };
    if (messages) value.messages = messages;
    return { field: 'messages', value };
  }

  function post(entries) {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: entries,
    })));
    return makePostReq();
  }

  it('B/G/N: erro de atualização não impede o status seguinte nem apaga o 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failedUpdate = makeUpdateChain({ message: 'update timeout' });
      const nextUpdate = makeUpdateChain();
      const touch = makeChatTouchChain();
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
        .mockReturnValueOnce(failedUpdate)
        .mockReturnValueOnce(makeMsgSelectChain(row('accepted', 'cccc0000-0000-0000-0000-000000000013')))
        .mockReturnValueOnce(nextUpdate)
        .mockReturnValueOnce(touch);

      const res = makeRes();
      await handler(post([{
        changes: [change([status('wamid.fail', 'sent'), status('wamid.next', 'sent')])],
      }]), res);

      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'Internal error' });
      expect(failedUpdate.update).toHaveBeenCalledTimes(1);
      expect(nextUpdate.update.mock.calls[0][0].status).toBe('sent');
      expect(touch.eq).toHaveBeenCalledWith('meta_message_id', 'wamid.next');
      expect(touch.update).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain('status_persist_failed');
      expect(logged).not.toContain('wamid.fail');
      expect(logged).not.toContain(FAKE_PHONE_NUM_ID);
      expect(logged).not.toContain(FAKE_BODY);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('C: falha intermediária ainda processa o status seguinte', async () => {
    const first = makeUpdateChain();
    const middle = makeUpdateChain({ message: 'update timeout' });
    const last = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', 'cccc0000-0000-0000-0000-000000000011')))
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(makeChatTouchChain())
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', 'cccc0000-0000-0000-0000-000000000012')))
      .mockReturnValueOnce(middle)
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', 'cccc0000-0000-0000-0000-000000000013')))
      .mockReturnValueOnce(last)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(post([{
      changes: [change([
        status('wamid.a', 'sent'),
        status('wamid.b', 'sent'),
        status('wamid.c', 'sent'),
      ])],
    }]), res);

    expect(res._status).toBe(500);
    expect(first.update).toHaveBeenCalledTimes(1);
    expect(middle.update).toHaveBeenCalledTimes(1);
    expect(last.update.mock.calls[0][0].status).toBe('sent');
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_messages')).toHaveLength(2);
  });

  it('D: falha no último status responde 500 depois de aplicar o anterior', async () => {
    const applied = makeUpdateChain();
    const failed = makeUpdateChain({ message: 'update timeout' });
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(applied)
      .mockReturnValueOnce(touch)
      .mockReturnValueOnce(makeMsgSelectChain(row('sent', 'cccc0000-0000-0000-0000-000000000013')))
      .mockReturnValueOnce(failed);

    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.a', 'sent'), status('wamid.b', 'delivered')])],
    }]), res);

    expect(res._status).toBe(500);
    expect(applied.update.mock.calls[0][0].status).toBe('sent');
    expect(failed.update.mock.calls[0][0].status).toBe('delivered');
    expect(touch.update).toHaveBeenCalledTimes(1);
  });

  it('E: todos os status com falha são tentados e o lote responde 500', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }));

    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.a', 'sent'), status('wamid.b', 'delivered')])],
    }]), res);

    expect(res._status).toBe(500);
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
    expect(mockSvc.from.mock.calls.map((call) => call[0])).not.toContain('meta_messages');
  });

  it('F: erro de leitura não impede o status seguinte', async () => {
    const nextUpdate = makeUpdateChain();
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(touch);

    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.fail', 'sent'), status('wamid.next', 'sent')])],
    }]), res);

    expect(res._status).toBe(500);
    expect(nextUpdate.update).toHaveBeenCalledTimes(1);
    expect(touch.eq).toHaveBeenCalledWith('meta_message_id', 'wamid.next');
  });

  it('H: esgotamento do compare-and-swap não impede o status seguinte nem toca o perdedor', async () => {
    const lost = [makeUpdateChain(null, []), makeUpdateChain(null, []), makeUpdateChain(null, [])];
    const nextUpdate = makeUpdateChain();
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[0])
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[1])
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[2])
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', 'cccc0000-0000-0000-0000-000000000013')))
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(touch);

    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.lost', 'delivered'), status('wamid.next', 'sent')])],
    }]), res);

    expect(res._status).toBe(500);
    expect(lost.every((chain) => chain.update.mock.calls.length === 1)).toBe(true);
    expect(nextUpdate.update.mock.calls[0][0].status).toBe('sent');
    expect(touch.eq).toHaveBeenCalledWith('meta_message_id', 'wamid.next');
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_messages')).toHaveLength(1);
  });

  it('I: falha de status não impede o texto inbound seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }));
    mockSvc.rpc.mockResolvedValueOnce(makeRpcResult());

    const res = makeRes();
    await handler(post([{
      changes: [change(
        [status('wamid.status', 'sent')],
        [makeInboundMessage({ id: 'wamid.text' })],
      )],
    }]), res);

    expect(res._status).toBe(500);
    expect(mockSvc.rpc).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_message');
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe('wamid.text');
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).toBe(FAKE_COMPANY_ID);
  });

  it('J: falha de status não impede a mídia seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(makeDedupeChain(null))
      .mockReturnValueOnce(makeCredentialChain(FAKE_CREDENTIAL));
    mockSvc.rpc.mockResolvedValueOnce(makeRpcResult());

    const res = makeRes();
    await handler(post([{
      changes: [change(
        [status('wamid.status', 'sent')],
        [makeDocumentMessage({ id: 'wamid.doc' })],
      )],
    }]), res);

    expect(res._status).toBe(500);
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce();
    expect(mockSvc.rpc.mock.calls[0][0]).toBe('process_meta_inbound_media_message');
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe('wamid.doc');
  });

  it('K: falha em um change não impede o change seguinte', async () => {
    const nextUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(post([{
      changes: [
        change([status('wamid.a', 'sent')]),
        change([status('wamid.b', 'sent')]),
      ],
    }]), res);

    expect(res._status).toBe(500);
    expect(nextUpdate.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_whatsapp_instances')).toHaveLength(2);
  });

  it('L: falha em um entry não impede o entry seguinte', async () => {
    const nextUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(post([
      { changes: [change([status('wamid.a', 'sent')])] },
      { changes: [change([status('wamid.b', 'sent')])] },
    ]), res);

    expect(res._status).toBe(500);
    expect(nextUpdate.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(nextUpdate.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
  });

  it('M: falha de uma instância não reutiliza o contexto da outra', async () => {
    const otherUpdate = makeUpdateChain();
    const firstInst = makeInstChain(FAKE_INSTANCE);
    const otherInst = makeInstChain({ id: OTHER_INSTANCE_ID, company_id: OTHER_COMPANY_ID });
    mockSvc.from
      .mockReturnValueOnce(firstInst)
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(otherInst)
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', FAKE_MSG_ID, OTHER_COMPANY_ID, OTHER_INSTANCE_ID)))
      .mockReturnValueOnce(otherUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(post([
      { changes: [change([status('wamid.a', 'sent')], undefined, FAKE_PHONE_NUM_ID)] },
      { changes: [change([status('wamid.b', 'sent')], undefined, OTHER_PHONE_ID)] },
    ]), res);

    expect(res._status).toBe(500);
    expect(firstInst.eq).toHaveBeenCalledWith('phone_number_id', FAKE_PHONE_NUM_ID);
    expect(otherInst.eq).toHaveBeenCalledWith('phone_number_id', OTHER_PHONE_ID);
    expect(otherUpdate.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(otherUpdate.eq).toHaveBeenCalledWith('instance_id', OTHER_INSTANCE_ID);
    expect(otherUpdate.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });

  it('O: delivered com falha e read seguinte não regridem no retry', async () => {
    const deliveredUpdate = makeUpdateChain({ message: 'update timeout' });
    const readUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(deliveredUpdate)
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(readUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const first = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered'), status('wamid.same', 'read')])],
    }]), first);

    expect(first._status).toBe(500);
    expect(deliveredUpdate.update.mock.calls[0][0].status).toBe('delivered');
    expect(readUpdate.update.mock.calls[0][0].status).toBe('read');
    expect(readUpdate.eq).toHaveBeenCalledWith('status', 'sent');

    const callsAfterFirst = mockSvc.from.mock.calls.length;
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('read')));
    const second = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), second);

    expect(second._status).toBe(200);
    expect(mockSvc.from.mock.calls.slice(callsAfterFirst).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
    ]);
  });

  it('P: read com falha deixa delivered seguir e o retry aplica read', async () => {
    const lostRead = makeUpdateChain({ message: 'update timeout' });
    const deliveredUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lostRead)
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(deliveredUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const first = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'read'), status('wamid.same', 'delivered')])],
    }]), first);
    expect(first._status).toBe(500);
    expect(deliveredUpdate.update.mock.calls[0][0].status).toBe('delivered');
    expect(deliveredUpdate.eq).toHaveBeenCalledWith('status', 'sent');

    const retryRead = makeUpdateChain();
    const retryTouch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
      .mockReturnValueOnce(retryRead)
      .mockReturnValueOnce(retryTouch);
    const second = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'read')])],
    }]), second);

    expect(second._status).toBe(200);
    expect(retryRead.update.mock.calls[0][0].status).toBe('read');
    expect(retryRead.eq).toHaveBeenCalledWith('status', 'delivered');
    expect(retryTouch.update).toHaveBeenCalledTimes(1);
  });

  it('Q: retry depois de erro de atualização respeita o status já gravado', async () => {
    const lost = makeUpdateChain({ message: 'update timeout' });
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost);
    const first = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), first);
    expect(first._status).toBe(500);
    expect(lost.update).toHaveBeenCalledTimes(1);

    const callsAfterFirst = mockSvc.from.mock.calls.length;
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
      .mockReturnValueOnce(touch);
    const second = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), second);

    expect(second._status).toBe(200);
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.slice(callsAfterFirst).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
      'meta_messages',
    ]);
  });

  it('Z: a resposta espera o status seguinte ainda pendente', async () => {
    const pending = makeMsgSelectChain(row('accepted'));
    let release;
    pending.maybeSingle.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ data: row('accepted'), error: null });
    }));
    const nextUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(null, { message: 'select error' }))
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    const done = handler(post([{
      changes: [change([status('wamid.a', 'sent'), status('wamid.b', 'sent')])],
    }]), res);
    await vi.waitFor(() => expect(pending.maybeSingle).toHaveBeenCalledTimes(1));
    expect(res._status).toBeNull();
    release();
    await done;
    expect(res._status).toBe(500);
    expect(nextUpdate.update).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Toque Realtime — duplicata exata recupera a notificação.
// Mocks. Não publica Realtime nem exercita concorrência no PostgreSQL.
// =============================================================================

describe('POST /api/whatsapp/meta/webhook — recuperação do toque Realtime', () => {
  const OTHER_COMPANY_ID  = 'ffff0000-0000-0000-0000-000000000099';
  const OTHER_INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000098';
  const OTHER_PHONE_ID    = '199988877766';

  function row(status, companyId = FAKE_COMPANY_ID, instanceId = FAKE_INSTANCE_ID) {
    return { id: FAKE_MSG_ID, company_id: companyId, instance_id: instanceId, status };
  }

  function status(id, name) {
    return { id, status: name, timestamp: FAKE_TIMESTAMP };
  }

  function change(statuses, messages, phoneId = FAKE_PHONE_NUM_ID) {
    const value = {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: phoneId },
      contacts: [{ wa_id: FAKE_WA_ID, profile: { name: FAKE_CONTACT_NAME } }],
      statuses,
    };
    if (messages) value.messages = messages;
    return { field: 'messages', value };
  }

  function post(entries) {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: entries,
    })));
    return makePostReq();
  }

  it('falha do toque não impede o status seguinte e o 500 permanece', async () => {
    const failedTouch = makeChatTouchChain([], { message: 'query timeout' });
    const okTouch = makeChatTouchChain();
    const firstUpdate = makeUpdateChain();
    const secondUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(firstUpdate)
      .mockReturnValueOnce(failedTouch)
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted', FAKE_COMPANY_ID, FAKE_INSTANCE_ID)))
      .mockReturnValueOnce(secondUpdate)
      .mockReturnValueOnce(okTouch);

    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.a', 'delivered'), status('wamid.b', 'sent')])],
    }]), res);

    expect(res._status).toBe(500);
    expect(firstUpdate.update.mock.calls[0][0].status).toBe('delivered');
    expect(secondUpdate.update.mock.calls[0][0].status).toBe('sent');
    expect(failedTouch.update).toHaveBeenCalledTimes(1);
    expect(okTouch.eq).toHaveBeenCalledWith('meta_message_id', 'wamid.b');
  });

  it('falha do toque não impede o texto inbound seguinte', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain([], { message: 'query timeout' }));
    mockSvc.rpc.mockResolvedValueOnce(makeRpcResult());

    const res = makeRes();
    await handler(post([{
      changes: [change(
        [status('wamid.status', 'delivered')],
        [makeInboundMessage({ id: 'wamid.text' })],
      )],
    }]), res);

    expect(res._status).toBe(500);
    expect(mockSvc.rpc.mock.calls[0][1].p_meta_message_id).toBe('wamid.text');
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).toBe(FAKE_COMPANY_ID);
  });

  it('falha do toque em um change não impede o change seguinte', async () => {
    const nextUpdate = makeUpdateChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain([], { message: 'query timeout' }))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(nextUpdate)
      .mockReturnValueOnce(makeChatTouchChain());

    const res = makeRes();
    await handler(post([{
      changes: [
        change([status('wamid.a', 'delivered')]),
        change([status('wamid.b', 'sent')]),
      ],
    }]), res);

    expect(res._status).toBe(500);
    expect(nextUpdate.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_whatsapp_instances')).toHaveLength(2);
  });

  it('falha do toque em um entry não impede o entry seguinte', async () => {
    const nextTouch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeChatTouchChain([], { message: 'query timeout' }))
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('accepted')))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(nextTouch);

    const res = makeRes();
    await handler(post([
      { changes: [change([status('wamid.a', 'delivered')])] },
      { changes: [change([status('wamid.b', 'sent')])] },
    ]), res);

    expect(res._status).toBe(500);
    expect(nextTouch.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(nextTouch.eq).toHaveBeenCalledWith('direction', 'outbound');
  });

  it('duplicata exata com erro de toque responde 500 sem novo tracking e sem dado sensível', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const touch = makeChatTouchChain([], { message: `${FAKE_BODY} ${FAKE_WA_ID}` });
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
        .mockReturnValueOnce(touch);
      const res = makeRes();
      await handler(post([{
        changes: [change([status('wamid.same', 'delivered')])],
      }]), res);
      expect(res._status).toBe(500);
      expect(touch.update).toHaveBeenCalledTimes(1);
      expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_whatsapp_messages')).toHaveLength(1);
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain('chat_touch_failed');
      expect(logged).not.toContain(FAKE_BODY);
      expect(logged).not.toContain(FAKE_WA_ID);
      expect(logged).not.toContain('wamid.same');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('duplicata exata com mensagem de chat ausente permanece HTTP 200', async () => {
    const touch = makeChatTouchChain([]);
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('read')))
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(post([{
      changes: [change([status(FAKE_WAMID, 'read')])],
    }]), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true });
    expect(touch.update).toHaveBeenCalledTimes(1);
  });

  it('duplicata de outra instância toca somente o contexto resolvido', async () => {
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain({ id: OTHER_INSTANCE_ID, company_id: OTHER_COMPANY_ID }))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent', OTHER_COMPANY_ID, OTHER_INSTANCE_ID)))
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.other', 'sent')], undefined, OTHER_PHONE_ID)],
    }]), res);
    expect(res._status).toBe(200);
    expect(touch.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(touch.eq).toHaveBeenCalledWith('instance_id', OTHER_INSTANCE_ID);
    expect(touch.eq).toHaveBeenCalledWith('direction', 'outbound');
    expect(touch.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });

  it('releitura com o mesmo status recupera o toque sem novo update', async () => {
    const lost = makeUpdateChain(null, []);
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost)
      .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), res);
    expect(res._status).toBe(200);
    expect(lost.update).toHaveBeenCalledTimes(1);
    expect(lost.update.mock.calls[0][0].status).toBe('delivered');
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_whatsapp_messages')).toHaveLength(3);
  });

  it('última releitura com o status recebido recupera o toque sem quarta gravação', async () => {
    const lost = [makeUpdateChain(null, []), makeUpdateChain(null, []), makeUpdateChain(null, [])];
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[0])
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[1])
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost[2])
      .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
      .mockReturnValueOnce(touch);
    const res = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), res);
    expect(res._status).toBe(200);
    expect(lost.every((chain) => chain.update.mock.calls.length === 1)).toBe(true);
    expect(touch.update).toHaveBeenCalledTimes(1);
    expect(mockSvc.from).toHaveBeenCalledTimes(9);
  });

  it('erro de update seguido de retry no mesmo status toca sem regravar', async () => {
    const lost = makeUpdateChain({ message: 'update timeout' });
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(lost);
    const first = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), first);
    expect(first._status).toBe(500);
    expect(lost.update).toHaveBeenCalledTimes(1);
    expect(lost.update.mock.calls[0][0]).not.toHaveProperty('read_at');
    expect(lost.update.mock.calls[0][0]).not.toHaveProperty('error_code');

    const callsAfterFirst = mockSvc.from.mock.calls.length;
    const touch = makeChatTouchChain();
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
      .mockReturnValueOnce(touch);
    const second = makeRes();
    await handler(post([{
      changes: [change([status('wamid.same', 'delivered')])],
    }]), second);
    expect(second._status).toBe(200);
    expect(touch.update.mock.calls[0][0]).toEqual({ updated_at: expect.any(String) });
    expect(mockSvc.from.mock.calls.slice(callsAfterFirst).map((call) => call[0])).toEqual([
      'meta_whatsapp_instances',
      'meta_whatsapp_messages',
      'meta_messages',
    ]);
  });

  it('a resposta espera o toque ainda pendente', async () => {
    const touch = makeChatTouchChain();
    let release;
    touch.select.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ data: [{ id: 'chat-touch-row' }], error: null });
    }));
    mockSvc.from
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeMsgSelectChain(row('sent')))
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(touch);
    const res = makeRes();
    const done = handler(post([{
      changes: [change([status('wamid.a', 'delivered')])],
    }]), res);
    await vi.waitFor(() => expect(touch.select).toHaveBeenCalledTimes(1));
    expect(res._status).toBeNull();
    release();
    await done;
    expect(res._status).toBe(200);
  });

  it('falha persistente do toque tenta uma vez por reenvio', async () => {
    async function once() {
      const touch = makeChatTouchChain([], { message: 'query timeout' });
      mockSvc.from
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeMsgSelectChain(row('delivered')))
        .mockReturnValueOnce(touch);
      const res = makeRes();
      await handler(post([{
        changes: [change([status('wamid.same', 'delivered')])],
      }]), res);
      expect(res._status).toBe(500);
      expect(touch.update).toHaveBeenCalledTimes(1);
    }
    await once();
    await once();
    expect(mockSvc.from.mock.calls.filter((call) => call[0] === 'meta_whatsapp_messages')).toHaveLength(2);
  });
});

// =============================================================================
// send-audio.test.js
//
// B3.2-C.1 — POST /api/whatsapp/meta/messages/send-audio
// Mocks de auth e banco. Multipart real via formidable.
// Sem Graph, S3, decrypt, INSERT de mensagens ou rede.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as customerServiceWindow from '../../../../lib/meta-whatsapp/customerServiceWindow.js';
import { META_OUTBOUND_AUDIO_MAX_BYTES } from '../../../../lib/meta-whatsapp/audioBytes.js';

const fsState = vi.hoisted(() => ({
  failRead: false,
  unlinkCalls: [],
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: async (...args) => {
      if (fsState.failRead) {
        throw new Error('ENOENT');
      }
      return actual.readFile(...args);
    },
    unlink: async (filepath) => {
      fsState.unlinkCalls.push(filepath);
      return actual.unlink(filepath);
    },
  };
});

const mockSvc = { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_SEND_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_VIEW_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockUploadMedia = vi.fn();
const mockSendAudioMessage = vi.fn();
const mockSendTextMessage = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  uploadMedia: (...args) => mockUploadMedia(...args),
  sendAudioMessage: (...args) => mockSendAudioMessage(...args),
  sendTextMessage: (...args) => mockSendTextMessage(...args),
}));

const mockUploadMetaInboundAudio = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/awsUpload.js', () => ({
  uploadMetaInboundAudio: (...args) => mockUploadMetaInboundAudio(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const orchestratorState = vi.hoisted(() => ({
  mock: vi.fn(),
  actual: null,
}));

vi.mock('../../../../lib/meta-whatsapp/outboundAudioSendOrchestrator.js', async (importOriginal) => {
  const actual = await importOriginal();
  orchestratorState.actual = actual.orchestrateOutboundAudioSend;
  orchestratorState.mock.mockImplementation((input) => orchestratorState.actual(input));
  return {
    ...actual,
    orchestrateOutboundAudioSend: (...args) => orchestratorState.mock(...args),
  };
});

const persistState = vi.hoisted(() => ({
  mock: vi.fn(),
}));

vi.mock('../../../../lib/meta-whatsapp/outboundAudioPersistenceOrchestrator.js', () => ({
  completeMetaOutboundAudioPersistence: (...args) => persistState.mock(...args),
}));

const s3State = vi.hoisted(() => ({
  S3Client: vi.fn(function MockS3Client(config) {
    this.config = config;
    this.send = vi.fn();
  }),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: s3State.S3Client,
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

const persistStoreState = vi.hoisted(() => ({
  upload: vi.fn(),
  library: vi.fn(),
  tracking: vi.fn(),
  chat: vi.fn(),
  markCompleted: vi.fn(),
  claim: vi.fn(),
  markUnknown: vi.fn(),
  markGraphAccepted: vi.fn(),
}));

vi.mock('../../../../lib/meta-whatsapp/awsOutboundAudio.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    uploadMetaOutboundAudio: (...args) => persistStoreState.upload(...args),
  };
});

vi.mock('../../../../lib/meta-whatsapp/outboundAudioMediaLibraryStore.js', () => ({
  persistOutboundAudioMediaLibrary: (...args) => persistStoreState.library(...args),
}));

vi.mock('../../../../lib/meta-whatsapp/outboundAudioTrackingStore.js', () => ({
  persistOutboundAudioTracking: (...args) => persistStoreState.tracking(...args),
}));

vi.mock('../../../../lib/meta-whatsapp/outboundAudioChatStore.js', () => ({
  persistOutboundAudioChat: (...args) => persistStoreState.chat(...args),
}));

vi.mock('../../../../lib/meta-whatsapp/outboundAudioOperationStore.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    claimCreatedToGraphInFlight: (...args) => persistStoreState.claim(...args),
    markUnknown: (...args) => persistStoreState.markUnknown(...args),
    markGraphAccepted: (...args) => persistStoreState.markGraphAccepted(...args),
    markCompleted: (...args) => persistStoreState.markCompleted(...args),
  };
});

import * as outboundStatusTracking from '../../../../lib/meta-whatsapp/outboundStatusTracking.js';
import handler, {
  META_AUDIO_FUNCTION_BUDGET_MS,
  META_AUDIO_PLATFORM_MARGIN_MS,
  META_AUDIO_PERSIST_MIN_REMAINING_MS,
  GRAPH_NEED_BEFORE_CLAIM_MS,
  buildCreatedOutboundAudioContext,
  computeOutboundAudioDeadline,
} from '../send-audio.js';
import { META_SEND_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';

const FAKE_COMPANY_ID = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const OTHER_COMPANY_ID = 'eeee0000-0000-0000-0000-000000000005';
const FAKE_PHONE_NUM_ID = '106540352242922';
const FAKE_WA_ID = '5511987654321';

const FAKE_INSTANCE = {
  id: FAKE_INSTANCE_ID,
  company_id: FAKE_COMPANY_ID,
  phone_number_id: FAKE_PHONE_NUM_ID,
  status: 'connected',
};

const FAKE_CONVERSATION = {
  id: FAKE_CONVERSATION_ID,
  wa_id: FAKE_WA_ID,
  company_id: FAKE_COMPANY_ID,
  instance_id: FAKE_INSTANCE_ID,
};

const OPEN_INBOUND_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const GRAPH_STARTED_AT = '2026-11-18T12:00:00.000Z';
const FAKE_WAMID = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABEYEj';
const FAKE_AWS_CREDS = Object.freeze({
  access_key_id: 'AKIATESTFAKE',
  secret_access_key: 'secret-test-fixture',
  region: 'sa-east-1',
  bucket: 'lovoo-tenant-bucket',
});
const EXPECTED_S3_KEY =
  `clientes/${FAKE_COMPANY_ID}/meta-outbound/${FAKE_OPERATION_ID}/audio.m4a`;
const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function fourcc(type) {
  return Buffer.from(type, 'ascii');
}

function box(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), fourcc(type), body]);
}

function hdlr(handlerName) {
  return box('hdlr', [
    Buffer.alloc(8),
    fourcc(handlerName),
    Buffer.alloc(12),
    Buffer.from([0x00]),
  ]);
}

function mp4aPayload(extra) {
  const fields = Buffer.alloc(28);
  fields[7] = 0x01;
  fields[17] = 0x02;
  fields[19] = 0x10;
  fields.writeUInt32BE((44100 * 65536) >>> 0, 24);
  return extra ? Buffer.concat([fields, extra]) : fields;
}

function esdsAacLc() {
  return box('esds', Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x19,
    0x00, 0x00,
    0x00,
    0x04, 0x11,
    0x40,
    0x15,
    0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02,
    0x12, 0x10,
    0x06, 0x01,
    0x02,
  ]));
}

function stsdWith(sampleEntry) {
  return box('stsd', [Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), sampleEntry]);
}

function audioTrack(withEsds) {
  const extra = withEsds ? esdsAacLc() : null;
  const sample = box('mp4a', mp4aPayload(extra));
  return box('trak', [
    box('mdia', [
      hdlr('soun'),
      box('minf', [box('stbl', [stsdWith(sample)])]),
    ]),
  ]);
}

function ftypBox() {
  return box('ftyp', [fourcc('isom'), u32(0), fourcc('isom'), fourcc('iso2'), fourcc('mp41')]);
}

function buildAudioMp4(withEsds = false) {
  return Buffer.concat([ftypBox(), box('moov', [audioTrack(withEsds)])]);
}

function webmBytes() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);
}

function makeInstChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeConvChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeWindowChain({ data = { provider_timestamp: OPEN_INBOUND_ISO }, error = null } = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeReconcilePendingChain(data = [], error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeReconcileMarkerChain(data = null, error = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  chain.then = (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return chain;
}

function makeOpSelectChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeOpInsertChain(data, error = null) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function audioSha256(buffer = buildAudioMp4(true)) {
  return createHash('sha256').update(buffer).digest('hex');
}

function operationRow(overrides = {}) {
  return {
    company_id: FAKE_COMPANY_ID,
    operation_id: FAKE_OPERATION_ID,
    user_id: FAKE_USER_ID,
    instance_id: FAKE_INSTANCE_ID,
    conversation_id: FAKE_CONVERSATION_ID,
    audio_sha256: audioSha256(),
    status: 'created',
    wamid: null,
    s3_key: null,
    graph_started_at: null,
    error_code: null,
    ...overrides,
  };
}

function makeRes() {
  return {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

function defaultFields(overrides = {}) {
  return {
    company_id: FAKE_COMPANY_ID,
    instance_id: FAKE_INSTANCE_ID,
    conversation_id: FAKE_CONVERSATION_ID,
    operation_id: FAKE_OPERATION_ID,
    ...overrides,
  };
}

function makeMultipartReq({
  fields = defaultFields(),
  file = { buffer: buildAudioMp4(true), filename: 'clip.mp4', mime: 'video/webm', fieldName: 'file' },
  extraFile = null,
  headers = {},
} = {}) {
  const boundary = '----B32C1FormBoundary7d4';
  const chunks = [];
  const push = (part) => { chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part)); };

  const appendField = (key, value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) appendField(key, item);
      return;
    }
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  };

  for (const [key, value] of Object.entries(fields)) {
    appendField(key, value);
  }

  const addFile = (part) => {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.fieldName}"; filename="${part.filename}"\r\nContent-Type: ${part.mime}\r\n\r\n`,
    );
    push(part.buffer);
    push('\r\n');
  };
  if (file) addFile(file);
  if (extraFile) addFile(extraFile);
  push(`--${boundary}--\r\n`);

  const body = Buffer.concat(chunks);
  const req = Readable.from([body]);
  req.method = 'POST';
  req.headers = {
    authorization: 'Bearer fake-jwt-fixture',
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
    ...headers,
  };
  return req;
}

function setupGuardOk(companyId = FAKE_COMPANY_ID, role = 'admin') {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId, role, accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

function setupGetUserOk() {
  mockSvc.auth.getUser.mockResolvedValue({
    data: { user: { id: FAKE_USER_ID } },
    error: null,
  });
}

function setupGetUserFail() {
  mockSvc.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'invalid jwt fixture' },
  });
}

function expectNoMultipartParsed() {
  expect(fsState.unlinkCalls).toEqual([]);
  expect(mockValidateMetaCaller).not.toHaveBeenCalled();
}

function setupHappyLookups({ instance = FAKE_INSTANCE, conversation = FAKE_CONVERSATION, window } = {}) {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(instance))
    .mockReturnValueOnce(makeConvChain(conversation))
    .mockReturnValueOnce(window ?? makeWindowChain());
}

function setupNewSendLookups({
  operation = null,
  operationError = null,
  insert = operationRow(),
  insertError = null,
  window,
  extraChains = [],
  instance = FAKE_INSTANCE,
} = {}) {
  setupGuardOk();
  const selectChain = makeOpSelectChain(operation, operationError);
  const insertChain = makeOpInsertChain(insertError ? null : insert, insertError);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(instance))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(selectChain)
    .mockReturnValueOnce(window ?? makeWindowChain())
    .mockReturnValueOnce(insertChain);
  extraChains.forEach((chain) => {
    mockSvc.from.mockReturnValueOnce(chain);
  });
  return { selectChain, insertChain };
}

function expectNoExternalSideEffects() {
  expect(mockUploadMedia).not.toHaveBeenCalled();
  expect(mockSendAudioMessage).not.toHaveBeenCalled();
  expect(mockSendTextMessage).not.toHaveBeenCalled();
  expect(mockUploadMetaInboundAudio).not.toHaveBeenCalled();
  expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  expect(mockSvc.rpc).not.toHaveBeenCalled();
  expect(persistState.mock).not.toHaveBeenCalled();
  expect(s3State.S3Client).not.toHaveBeenCalled();
  expect(persistStoreState.upload).not.toHaveBeenCalled();
  expect(persistStoreState.library).not.toHaveBeenCalled();
  expect(persistStoreState.tracking).not.toHaveBeenCalled();
  expect(persistStoreState.chat).not.toHaveBeenCalled();
  expect(persistStoreState.markCompleted).not.toHaveBeenCalled();
  expect(persistStoreState.claim).not.toHaveBeenCalled();
  expect(persistStoreState.markUnknown).not.toHaveBeenCalled();
  expect(persistStoreState.markGraphAccepted).not.toHaveBeenCalled();
  const tables = mockSvc.from.mock.calls.map(([table]) => table);
  expect(tables).not.toContain('meta_whatsapp_messages');
  expect(tables).not.toContain('meta_whatsapp_credentials');
  expect(tables.filter((table) => table === 'meta_messages')).toEqual(
    tables.includes('meta_messages') ? ['meta_messages'] : [],
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(orchestratorState.mock).not.toHaveBeenCalled();
}

function graphAcceptedRow(overrides = {}) {
  return operationRow({
    status: 'graph_accepted',
    wamid: FAKE_WAMID,
    graph_started_at: GRAPH_STARTED_AT,
    ...overrides,
  });
}

function setupGraphAcceptedLookups(rowOverrides = {}) {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(makeOpSelectChain(graphAcceptedRow(rowOverrides)));
}

function setupAwsRpcOk(creds = FAKE_AWS_CREDS) {
  mockSvc.rpc.mockResolvedValue({ data: [creds], error: null });
}

function expectNoGraphOrClaim() {
  expect(mockUploadMedia).not.toHaveBeenCalled();
  expect(mockSendAudioMessage).not.toHaveBeenCalled();
  expect(mockSendTextMessage).not.toHaveBeenCalled();
  expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  expect(mockUploadMetaInboundAudio).not.toHaveBeenCalled();
  expect(orchestratorState.mock).not.toHaveBeenCalled();
  expect(persistStoreState.claim).not.toHaveBeenCalled();
  expect(HANDLER_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
}

function expectPersistSuccessHttp(res) {
  expect(res._status).toBe(200);
  expect(res._body).toEqual({ ok: true });
  expect(JSON.stringify(res._body)).not.toContain(FAKE_AWS_CREDS.access_key_id);
  expect(JSON.stringify(res._body)).not.toContain(FAKE_AWS_CREDS.secret_access_key);
  expect(JSON.stringify(res._body)).not.toContain(EXPECTED_S3_KEY);
  expect(JSON.stringify(res._body)).not.toContain(FAKE_WAMID);
  expect(res._body).not.toHaveProperty('s3Key');
  expect(res._body).not.toHaveProperty('wamid');
  expect(res._body).not.toHaveProperty('operationId');
  expect(res._body).not.toHaveProperty('audioSha256');
}

function lastPersistInput() {
  expect(persistState.mock).toHaveBeenCalledTimes(1);
  return persistState.mock.mock.calls[0][0];
}

async function mockPersistPipelineOk(input = {}) {
  const deps = input.dependencies || {};
  if (typeof deps.persistOutboundAudioTracking === 'function') {
    const tracking = await deps.persistOutboundAudioTracking({
      companyId: input.context?.companyId,
      instanceId: input.context?.instanceId,
      wamid: FAKE_WAMID,
    });
    if (tracking && tracking.ok === false) {
      return { ok: false, error: 'tracking_persistence_failed' };
    }
  }
  if (typeof deps.uploadMetaOutboundAudio === 'function') {
    const uploaded = await deps.uploadMetaOutboundAudio({
      companyId: input.context?.companyId,
    });
    if (uploaded && uploaded.ok === false) {
      return { ok: false, error: 's3_confirmation_failed' };
    }
  }
  return { ok: true };
}

function expectOrchestratorEnabledGraph() {
  expect(orchestratorState.mock).toHaveBeenCalled();
  for (const [input] of orchestratorState.mock.mock.calls) {
    expect(input.enabled).toBe(true);
    expect(input.context).toEqual(expect.objectContaining({
      companyId: expect.any(String),
      operationId: expect.any(String),
    }));
    expect(input.deps).toEqual(expect.any(Object));
  }
}

function expectOrchestratorNotCalled() {
  expect(orchestratorState.mock).not.toHaveBeenCalled();
}

const HANDLER_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../send-audio.js'),
  'utf8',
);

function expectCreatedGraphSuccess(res) {
  expectPersistSuccessHttp(res);
  expectOrchestratorEnabledGraph();
  expect(persistStoreState.claim).toHaveBeenCalledTimes(1);
  expect(mockUploadMedia).toHaveBeenCalledTimes(1);
  expect(mockSendAudioMessage).toHaveBeenCalledTimes(1);
  expect(mockDecryptMetaToken).toHaveBeenCalledTimes(1);
}

function makeCredChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.META_OUTBOUND_AUDIO_GRAPH_ENABLED;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  fsState.failRead = false;
  fsState.unlinkCalls = [];
  mockSvc.rpc = vi.fn();
  persistState.mock.mockImplementation(mockPersistPipelineOk);
  persistStoreState.upload.mockResolvedValue({ ok: true });
  persistStoreState.library.mockResolvedValue({ ok: true, mediaAssetId: FAKE_INSTANCE_ID });
  persistStoreState.tracking.mockResolvedValue({ ok: true, trackingId: FAKE_INSTANCE_ID });
  persistStoreState.chat.mockResolvedValue({ ok: true, chatMessageId: FAKE_CONVERSATION_ID });
  persistStoreState.markCompleted.mockResolvedValue({ ok: true });
  persistStoreState.claim.mockResolvedValue({
    ok: true,
    row: operationRow({ status: 'graph_in_flight', graph_started_at: GRAPH_STARTED_AT }),
  });
  persistStoreState.markUnknown.mockResolvedValue({ ok: true });
  persistStoreState.markGraphAccepted.mockResolvedValue({ ok: true, row: graphAcceptedRow() });
  setupGetUserOk();
  orchestratorState.mock.mockImplementation((input) => orchestratorState.actual(input));
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in send-audio tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/whatsapp/meta/messages/send-audio — B3.2-C.1', () => {
  it('GET retorna 405 e Allow: POST', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
    expect(mockSvc.auth.getUser).not.toHaveBeenCalled();
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('POST sem Bearer retorna 401 antes de formidable.parse', async () => {
    const res = makeRes();
    await handler(makeMultipartReq({ headers: { authorization: '' } }), res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Autenticação necessária' });
    expect(mockSvc.auth.getUser).not.toHaveBeenCalled();
    expect(mockSvc.from).not.toHaveBeenCalled();
    expectNoMultipartParsed();
    expectNoExternalSideEffects();
  });

  it('JWT inválido retorna 401 antes de formidable.parse', async () => {
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Sessão inválida ou expirada' });
    expect(mockSvc.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expectNoMultipartParsed();
    expectNoExternalSideEffects();
  });

  it('JWT válido continua sujeito ao guard completo', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(mockSvc.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      expect.anything(),
      mockSvc,
      FAKE_COMPANY_ID,
      { roles: META_SEND_ROLES },
    );
    expect(mockSvc.auth.getUser.mock.invocationCallOrder[0])
      .toBeLessThan(mockValidateMetaCaller.mock.invocationCallOrder[0]);
    expect(res._status).toBe(403);
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
  });

  it('usuário inativo não passa', async () => {
    setupGuardFail(403, 'Acesso negado a esta empresa');
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('role sem permissão não passa e usa META_SEND_ROLES', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(403);
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      expect.anything(),
      mockSvc,
      FAKE_COMPANY_ID,
      { roles: META_SEND_ROLES },
    );
  });

  it('partner sem atribuição não passa', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Partner sem assignment ativo para esta empresa' });
  });

  it('company_id divergente não autoriza lookup na empresa do formulário', async () => {
    setupGuardOk(FAKE_COMPANY_ID);
    const instChain = makeInstChain(null);
    mockSvc.from = vi.fn().mockReturnValueOnce(instChain);
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ company_id: OTHER_COMPANY_ID }),
    }), res);
    expect(mockValidateMetaCaller.mock.calls[0][2]).toBe(OTHER_COMPANY_ID);
    expect(instChain.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(instChain.eq).not.toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'instance_not_found' });
  });

  it('instância de outra empresa não passa', async () => {
    setupHappyLookups({ instance: null });
    mockSvc.from = vi.fn().mockReturnValueOnce(makeInstChain(null));
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'instance_not_found' });
    expectNoExternalSideEffects();
  });

  it('conversa de outra empresa não passa', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(null));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'conversation_not_found' });
  });

  it('instância desconectada não passa', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValueOnce(makeInstChain({
      ...FAKE_INSTANCE,
      status: 'disconnected',
    }));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'instance_not_connected' });
  });

  it('janela fechada não passa', async () => {
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      }),
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_closed' });
    expectNoExternalSideEffects();
  });

  it('janela inconclusiva não passa', async () => {
    setupNewSendLookups({
      window: makeWindowChain({ data: null }),
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_unproven' });
    expect(customerServiceWindow.CUSTOMER_SERVICE_WINDOW_MS).toBe(86_400_000);
  });

  it('multipart inválido não passa', async () => {
    setupGuardOk();
    const req = Readable.from([Buffer.from('{"company_id":"x"}')]);
    req.method = 'POST';
    req.headers = {
      authorization: 'Bearer fake-jwt-fixture',
      'content-type': 'application/json',
    };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });

  it('arquivo ausente não passa', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({ file: null }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
  });

  it('arquivos duplicados não passam', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      extraFile: {
        fieldName: 'file',
        filename: 'other.mp4',
        mime: 'audio/mp4',
        buffer: buildAudioMp4(true),
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });

  it('campo instance_id ausente não passa', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ instance_id: '' }),
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('campos excessivos retornam 400', async () => {
    setupGuardOk();
    const extra = {};
    for (let i = 0; i < 6; i += 1) extra[`extra_${i}`] = 'x';
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields(extra),
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('campos acima do limite de tamanho retornam 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ conversation_id: 'y'.repeat(4100) }),
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('arquivo maior que 4 MiB não passa', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'huge.mp4',
        mime: 'audio/mp4',
        buffer: Buffer.alloc(META_OUTBOUND_AUDIO_MAX_BYTES + 1, 1),
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'audio_too_large' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });

  it('fMP4 AAC-LC é rejeitado antes do Graph e do S3', async () => {
    setupHappyLookups();
    const res = makeRes();
    const fragmented = Buffer.concat([
      ftypBox(),
      box('moov', [
        audioTrack(true),
        box('mvex', [box('trex', Buffer.alloc(24))]),
      ]),
      box('moof', Buffer.alloc(16)),
      box('mdat', Buffer.from([0x00, 0x00, 0x00, 0x00])),
    ]);
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'audio.m4a',
        mime: 'audio/mp4',
        buffer: fragmented,
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_audio' });
    expectNoExternalSideEffects();
  });

  it('WebM rejeitado mesmo com MIME de MP4', async () => {
    setupHappyLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'audio.m4a',
        mime: 'audio/mp4',
        buffer: webmBytes(),
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_audio' });
    expectNoExternalSideEffects();
  });

  it('MP4 sem AAC-LC confirmado rejeitado', async () => {
    setupHappyLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'audio.mp4',
        mime: 'audio/mp4',
        buffer: buildAudioMp4(false),
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_audio' });
  });

  it('MP4/AAC-LC sintético válido envia Graph mockado e persiste', async () => {
    const { insertChain } = setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'voice.webm',
        mime: 'audio/webm',
        buffer: buildAudioMp4(true),
      },
    }), res);
    expectCreatedGraphSuccess(res);
    expect(mockSvc.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockValidateMetaCaller).toHaveBeenCalledTimes(1);
    expect(mockSvc.auth.getUser.mock.invocationCallOrder[0])
      .toBeLessThan(mockValidateMetaCaller.mock.invocationCallOrder[0]);
    expect(res._body).not.toHaveProperty('message_id');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WA_ID);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PHONE_NUM_ID);
    expect(insertChain.insert.mock.calls[0][0].audio_sha256).toBe(audioSha256());
    expect(insertChain.insert.mock.calls[0][0].company_id).toBe(FAKE_COMPANY_ID);
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables[0]).toBe('meta_whatsapp_instances');
    expect(tables[1]).toBe('meta_conversations');
    expect(tables).toContain('meta_whatsapp_credentials');
  });

  it('fonte HTTP não usa env, host ou 501 de gate', () => {
    const executable = HANDLER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toMatch(/\bsendTextMessage\s*\(/);
    expect(executable).not.toContain('uploadMetaInboundAudio');
    expect(executable).not.toContain('markFailedBeforeClaim');
    expect(executable).not.toContain('awsUpload');
    expect(executable).not.toContain('randomUUID');
    expect(executable).toContain('enabled: true');
    expect(executable).not.toContain('req.headers.host');
    expect(HANDLER_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
    expect(HANDLER_SRC).not.toContain("error: 'audio_send_not_enabled'");
    expect(HANDLER_SRC).toContain('orchestrateOutboundAudioSend');
    expect(HANDLER_SRC).toContain('insertCreated');
    expect(HANDLER_SRC).toContain('selectByCompanyOperation');
    expect(HANDLER_SRC).toContain('markCompleted');
    expect(HANDLER_SRC).toContain('completeMetaOutboundAudioPersistence');
    expect(HANDLER_SRC).toContain('claimCreatedToGraphInFlight');
    expect(HANDLER_SRC).toContain('decryptMetaToken');
    expect(HANDLER_SRC).toContain('uploadMedia');
    expect(HANDLER_SRC).toContain('sendAudioMessage');
    expect(HANDLER_SRC).toContain('resumeGraphAcceptedPersistence');
    expect(HANDLER_SRC).toContain("createHash('sha256')");
    expect(HANDLER_SRC).toContain('parseOperationId');
    expect(HANDLER_SRC).toContain('const operationId = parsedOperationId.operationId');
    expect(HANDLER_SRC).toContain('maxFields: 8');
    expect(HANDLER_SRC).toContain('maxFieldsSize: 4096');
    expect(HANDLER_SRC).toContain('auth.getUser');
  });

  it('arquivos temporários são removidos após envio persistido', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
    for (const filepath of fsState.unlinkCalls) {
      expect(existsSync(filepath)).toBe(false);
    }
  });

  it('arquivos temporários são removidos após rejeição de áudio', async () => {
    setupHappyLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'a.webm',
        mime: 'audio/webm',
        buffer: webmBytes(),
      },
    }), res);
    expect(res._status).toBe(400);
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
    for (const filepath of fsState.unlinkCalls) {
      expect(existsSync(filepath)).toBe(false);
    }
  });

  it('erro de leitura do arquivo temporário retorna invalid_audio e limpa temp', async () => {
    setupHappyLookups();
    fsState.failRead = true;
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_audio' });
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
  });

  it('operation_id ausente retorna 400 invalid_operation_id', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: {
        company_id: FAKE_COMPANY_ID,
        instance_id: FAKE_INSTANCE_ID,
        conversation_id: FAKE_CONVERSATION_ID,
      },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ ok: false, error: 'invalid_operation_id' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expect(mockSvc.from).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('operation_id inválido retorna 400 invalid_operation_id', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ operation_id: UUID_V1 }),
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ ok: false, error: 'invalid_operation_id' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('operation_id repetido no multipart retorna 400 invalid_operation_id', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({
        operation_id: [FAKE_OPERATION_ID, FAKE_OPERATION_ID],
      }),
    }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ ok: false, error: 'invalid_operation_id' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('operation_id em query string ou header não substitui o multipart', async () => {
    setupGuardOk();
    const req = makeMultipartReq({
      fields: {
        company_id: FAKE_COMPANY_ID,
        instance_id: FAKE_INSTANCE_ID,
        conversation_id: FAKE_CONVERSATION_ID,
      },
      headers: { 'x-operation-id': FAKE_OPERATION_ID },
    });
    req.url = `/api/whatsapp/meta/messages/send-audio?operation_id=${FAKE_OPERATION_ID}`;
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ ok: false, error: 'invalid_operation_id' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expectNoExternalSideEffects();
  });

  it('JWT inválido continua rejeitado antes do parse mesmo com operation_id', async () => {
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Sessão inválida ou expirada' });
    expect(mockSvc.auth.getUser).toHaveBeenCalledTimes(1);
    expect(mockSvc.from).not.toHaveBeenCalled();
    expectNoMultipartParsed();
    expectNoExternalSideEffects();
  });

  it('payload válido com operation_id v4 envia Graph uma vez e persiste', async () => {
    const { insertChain } = setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(mockValidateMetaCaller).toHaveBeenCalledTimes(1);
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(persistStoreState.claim).toHaveBeenCalledTimes(1);
    expect(mockUploadMedia).toHaveBeenCalledTimes(1);
  });

  it('UUID v4 em maiúsculas é aceito, canonicalizado e reutilizado no Graph', async () => {
    const canonical = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
    persistStoreState.claim.mockResolvedValue({
      ok: true,
      row: operationRow({
        operation_id: canonical,
        status: 'graph_in_flight',
        graph_started_at: GRAPH_STARTED_AT,
      }),
    });
    const { insertChain } = setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({
        operation_id: 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC',
      }),
    }), res);
    expectCreatedGraphSuccess(res);
    expect(insertChain.insert.mock.calls[0][0].operation_id).toBe(canonical);
    expect(orchestratorState.mock.mock.calls[0][0].context.operationId).toBe(canonical);
  });

  it('SELECT existente created com identidade igual recupera sem INSERT extra', async () => {
    const insertChain = makeOpInsertChain(operationRow());
    setupExistingCreatedGraphLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it('mesmo operation_id e áudio diferente retorna 409 operation_conflict', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ audio_sha256: 'b'.repeat(64) })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('graph_in_flight retorna 409 operation_in_progress sem claim', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'graph_in_flight' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_in_progress' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('failed retorna 409 operation_failed', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'failed' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_failed' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('unknown retorna 409 operation_unknown', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'unknown' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_unknown' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('completed com identidade igual retorna 200 mesmo com janela fechada', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'completed' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables).toEqual([
      'meta_whatsapp_instances',
      'meta_conversations',
      'meta_outbound_audio_operations',
    ]);
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('graph_accepted válido retorna 200 via persistência local sem Graph', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectPersistSuccessHttp(res);
    expectNoGraphOrClaim();
    expect(persistState.mock).toHaveBeenCalledTimes(1);
  });

  it('INSERT 23505 com SELECT posterior created recupera a mesma operação', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
    mockSendAudioMessage.mockResolvedValue({ messageId: FAKE_WAMID });
    setupAwsRpcOk();
    setupGuardOk();
    const insertChain = makeOpInsertChain(null, { code: '23505', message: 'duplicate key' });
    const racedSelect = makeOpSelectChain(operationRow());
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(null))
      .mockReturnValueOnce(makeWindowChain())
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(racedSelect)
      .mockReturnValueOnce(makeCredChain({ access_token_enc: 'v1:enc-fixture' }))
      .mockReturnValueOnce(makeOpSelectChain(graphAcceptedRow()));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(racedSelect.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });

  it('INSERT 23505 sem linha recuperável retorna 500', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(null))
      .mockReturnValueOnce(makeWindowChain())
      .mockReturnValueOnce(makeOpInsertChain(null, { code: '23505' }))
      .mockReturnValueOnce(makeOpSelectChain(null));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('23505');
  });

  it('SELECT com erro não insere e retorna 500', async () => {
    const { insertChain } = setupNewSendLookups({
      operationError: { code: 'PGRST301' },
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it('mesmo operation_id em outra empresa filtra pelo company_id autorizado', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
    mockSendAudioMessage.mockResolvedValue({ messageId: FAKE_WAMID });
    persistStoreState.claim.mockResolvedValue({
      ok: true,
      row: operationRow({
        company_id: OTHER_COMPANY_ID,
        status: 'graph_in_flight',
        graph_started_at: GRAPH_STARTED_AT,
      }),
    });
    setupAwsRpcOk();
    setupGuardOk(OTHER_COMPANY_ID);
    const selectChain = makeOpSelectChain(null);
    const insertChain = makeOpInsertChain(operationRow({ company_id: OTHER_COMPANY_ID }));
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain({ ...FAKE_INSTANCE, company_id: OTHER_COMPANY_ID }))
      .mockReturnValueOnce(makeConvChain({ ...FAKE_CONVERSATION, company_id: OTHER_COMPANY_ID }))
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(makeWindowChain())
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(makeCredChain({ access_token_enc: 'v1:enc-fixture' }))
      .mockReturnValueOnce(makeOpSelectChain(graphAcceptedRow({ company_id: OTHER_COMPANY_ID })));
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ company_id: OTHER_COMPANY_ID }),
    }), res);
    expectPersistSuccessHttp(res);
    expect(selectChain.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(selectChain.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(insertChain.insert.mock.calls[0][0].company_id).toBe(OTHER_COMPANY_ID);
    expect(orchestratorState.mock.mock.calls[0][0].context.companyId).toBe(OTHER_COMPANY_ID);
  });

  it('completed com identidade divergente retorna 409 sem orquestrador', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({
        status: 'completed',
        audio_sha256: 'b'.repeat(64),
      })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('query, header e campo multipart não substituem a autorização', async () => {
    setupGraphCreatedLookups();
    const req = makeMultipartReq({
      fields: defaultFields({ enabled: 'true' }),
      headers: { 'x-meta-outbound-audio-graph-enabled': 'true' },
    });
    req.url = '/api/whatsapp/meta/messages/send-audio?enabled=true';
    const res = makeRes();
    await handler(req, res);
    expectCreatedGraphSuccess(res);
    expect(orchestratorState.mock.mock.calls[0][0].enabled).toBe(true);
    expect(HANDLER_SRC).not.toContain("fieldValue(fields, 'enabled')");
  });

  it('JWT inválido não chama o orquestrador', async () => {
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(401);
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('RBAC negado não chama o orquestrador', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(403);
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('áudio inválido não chama o orquestrador', async () => {
    setupHappyLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'a.webm',
        mime: 'audio/webm',
        buffer: webmBytes(),
      },
    }), res);
    expect(res._status).toBe(400);
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('janela fechada para operação nova não chama o orquestrador', async () => {
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      }),
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_closed' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });
});

function validCreatedContextInput(overrides = {}) {
  return {
    companyId: FAKE_COMPANY_ID,
    userId: FAKE_USER_ID,
    instanceId: FAKE_INSTANCE_ID,
    conversationId: FAKE_CONVERSATION_ID,
    operationId: FAKE_OPERATION_ID,
    audioSha256: audioSha256(),
    phoneNumberId: FAKE_PHONE_NUM_ID,
    recipientWaId: FAKE_WA_ID,
    audioBytes: buildAudioMp4(true),
    deadlineAtMs: 1_737_000_057_000,
    ...overrides,
  };
}

function expectBodyHasNoSecrets(res) {
  const serialized = JSON.stringify(res._body);
  expect(serialized).not.toContain('accessToken');
  expect(serialized).not.toContain('access_token');
  expect(serialized).not.toContain('Bearer fake-jwt-fixture');
  expect(serialized).not.toContain('fake-jwt-fixture');
  expect(serialized).not.toContain('audioBytes');
  expect(serialized).not.toContain(buildAudioMp4(true).toString('hex'));
  expect(serialized).not.toContain(buildAudioMp4(true).toString('base64'));
  expect(res._body).not.toHaveProperty('deadlineAtMs');
  expect(res._body).not.toHaveProperty('startedAtMs');
  expect(res._body).not.toHaveProperty('phoneNumberId');
  expect(res._body).not.toHaveProperty('recipientWaId');
}

describe('POST /api/whatsapp/meta/messages/send-audio — B3.2-C.3-D.3-E.2-A deadline', () => {
  it('helper de deadline usa budget 60000 e margem 3000', () => {
    expect(META_AUDIO_FUNCTION_BUDGET_MS).toBe(60_000);
    expect(META_AUDIO_PLATFORM_MARGIN_MS).toBe(3_000);
    expect(computeOutboundAudioDeadline(1_000_000)).toBe(1_057_000);
    expect(computeOutboundAudioDeadline(0)).toBe(57_000);
    expect(computeOutboundAudioDeadline(1.5)).toBeNull();
    expect(computeOutboundAudioDeadline('1000')).toBeNull();
  });

  it('duas origens produzem deadlines independentes', () => {
    expect(computeOutboundAudioDeadline(10)).toBe(57_010);
    expect(computeOutboundAudioDeadline(99)).toBe(57_099);
    expect(computeOutboundAudioDeadline(10)).not.toBe(computeOutboundAudioDeadline(99));
  });

  it('startedAtMs é capturado antes do JWT', async () => {
    const origin = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(nowSpy.mock.invocationCallOrder[0])
      .toBeLessThan(mockSvc.auth.getUser.mock.invocationCallOrder[0]);
    expect(res._status).toBe(401);
    expectNoMultipartParsed();
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('startedAtMs é capturado antes do multipart', async () => {
    const origin = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(nowSpy).toHaveBeenCalled();
    expect(nowSpy.mock.invocationCallOrder[0])
      .toBeLessThan(mockSvc.auth.getUser.mock.invocationCallOrder[0]);
    expect(res._status).toBe(401);
    expectNoMultipartParsed();
    expect(fsState.unlinkCalls).toEqual([]);
  });

  it('deadline absoluto é startedAtMs + 57000 e não depende do tempo das validações', async () => {
    const origin = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(orchestratorState.mock.mock.calls[0][0].deadlineAtMs).toBe(origin + 57_000);
    expect(computeOutboundAudioDeadline(origin)).toBe(origin + 57_000);
  });

  it('duas requisições possuem tempos independentes', async () => {
    const t1 = Date.now();
    const t2 = t1 + 12_345;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t1);
    setupGraphCreatedLookups();
    const res1 = makeRes();
    await handler(makeMultipartReq(), res1);
    expectCreatedGraphSuccess(res1);
    expect(orchestratorState.mock.mock.calls[0][0].deadlineAtMs).toBe(t1 + 57_000);
    orchestratorState.mock.mockClear();
    persistStoreState.claim.mockClear();
    mockUploadMedia.mockClear();
    mockSendAudioMessage.mockClear();
    mockDecryptMetaToken.mockClear();
    persistState.mock.mockClear();
    nowSpy.mockReturnValue(t2);
    setupGraphCreatedLookups();
    const res2 = makeRes();
    await handler(makeMultipartReq(), res2);
    expectCreatedGraphSuccess(res2);
    expect(orchestratorState.mock.mock.calls[0][0].deadlineAtMs).toBe(t2 + 57_000);
    expect(computeOutboundAudioDeadline(t1)).not.toBe(computeOutboundAudioDeadline(t2));
  });

  it('cliente não consegue alterar deadline por query, header ou multipart', async () => {
    const origin = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGraphCreatedLookups();
    const req = makeMultipartReq({
      fields: defaultFields({
        deadlineAtMs: '1',
        startedAtMs: '1',
        deadline: '1',
        META_AUDIO_FUNCTION_BUDGET_MS: '1',
      }),
      headers: {
        'x-deadline-at-ms': '1',
        'x-started-at-ms': '1',
      },
    });
    req.url = '/api/whatsapp/meta/messages/send-audio?deadlineAtMs=1&startedAtMs=1';
    const res = makeRes();
    await handler(req, res);
    expectCreatedGraphSuccess(res);
    expect(orchestratorState.mock.mock.calls[0][0].deadlineAtMs).toBe(origin + 57_000);
    const executable = HANDLER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain("fieldValue(fields, 'deadlineAtMs')");
    expect(executable).not.toContain("fieldValue(fields, 'startedAtMs')");
    expect(executable).not.toContain('req.query');
    expect(executable).not.toContain('AWS_ACCESS_KEY_ID');
    expect(executable).not.toContain('req.headers.host');
  });

  it('handler passa enabled true após JWT/RBAC e não lê env de Graph', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(orchestratorState.mock.mock.calls[0][0].enabled).toBe(true);
    expect(HANDLER_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
    expect(HANDLER_SRC).not.toContain('process.env');
  });

  it('credencial ausente bloqueia Graph após INSERT created', async () => {
    setupNewSendLookups({ extraChains: [makeCredChain(null)] });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'credential_unavailable' });
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expectBodyHasNoSecrets(res);
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables).toContain('meta_whatsapp_credentials');
  });

  it('HTTP created persiste 200 e completed permanece 200', async () => {
    setupGraphCreatedLookups();
    const createdRes = makeRes();
    await handler(makeMultipartReq(), createdRes);
    expectCreatedGraphSuccess(createdRes);
    expectBodyHasNoSecrets(createdRes);

    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'completed' })));
    const completedRes = makeRes();
    await handler(makeMultipartReq(), completedRes);
    expect(completedRes._status).toBe(200);
    expect(completedRes._body).toEqual({ ok: true });
    expectBodyHasNoSecrets(completedRes);
  });

  it('estados de conflito permanecem 409', async () => {
    const cases = [
      { status: 'graph_in_flight', error: 'operation_in_progress' },
      { status: 'unknown', error: 'operation_unknown' },
      { status: 'failed', error: 'operation_failed' },
    ];
    for (const item of cases) {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
        .mockReturnValueOnce(makeOpSelectChain(operationRow({
          status: item.status,
          wamid: item.wamid ?? null,
        })));
      const res = makeRes();
      await handler(makeMultipartReq(), res);
      expect(res._status).toBe(409);
      expect(res._body).toEqual({ ok: false, error: item.error });
      expectOrchestratorNotCalled();
      expectNoExternalSideEffects();
      orchestratorState.mock.mockClear();
    }
  });

  it('JWT inválido retorna 401 antes do parse', async () => {
    setupGetUserFail();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(401);
    expectNoMultipartParsed();
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('multi-tenant, partner e Trilha 2 permanecem protegidos', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const partnerRes = makeRes();
    await handler(makeMultipartReq(), partnerRes);
    expect(partnerRes._status).toBe(403);
    expectOrchestratorNotCalled();

    mockValidateMetaCaller.mockClear();
    setupGuardOk(FAKE_COMPANY_ID);
    const instChain = makeInstChain(null);
    mockSvc.from = vi.fn().mockReturnValueOnce(instChain);
    const tenantRes = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ company_id: OTHER_COMPANY_ID }),
    }), tenantRes);
    expect(mockValidateMetaCaller.mock.calls[0][2]).toBe(OTHER_COMPANY_ID);
    expect(instChain.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(instChain.eq).not.toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(tenantRes._status).toBe(404);
    expect(tenantRes._body).toEqual({ error: 'instance_not_found' });
    expectOrchestratorNotCalled();
  });

  it('cleanup dos arquivos temporários permanece no created persistido', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
    for (const filepath of fsState.unlinkCalls) {
      expect(existsSync(filepath)).toBe(false);
    }
  });

  it('captura de startedAtMs fica imediatamente após o guard POST e antes do admin/JWT/parse', () => {
    const handlerStart = HANDLER_SRC.indexOf('export default async function handler');
    const postGuard = HANDLER_SRC.indexOf("req.method !== 'POST'", handlerStart);
    const startedAt = HANDLER_SRC.indexOf('const startedAtMs = Date.now();', handlerStart);
    const deadline = HANDLER_SRC.indexOf('computeOutboundAudioDeadline(startedAtMs)', handlerStart);
    const admin = HANDLER_SRC.indexOf('svc = getSupabaseAdmin()', handlerStart);
    const jwt = HANDLER_SRC.indexOf('requireValidJwtUser(req, svc)', handlerStart);
    const parse = HANDLER_SRC.indexOf('parseMultipart(req)', handlerStart);
    expect(postGuard).toBeGreaterThan(handlerStart);
    expect(startedAt).toBeGreaterThan(postGuard);
    expect(deadline).toBeGreaterThan(startedAt);
    expect(admin).toBeGreaterThan(deadline);
    expect(jwt).toBeGreaterThan(admin);
    expect(parse).toBeGreaterThan(jwt);
  });
});

describe('POST /api/whatsapp/meta/messages/send-audio — B3.2-C.3-D.3-E.2-A.1 HTTP', () => {
  it('instância connected com phone_number_id válido envia Graph mockado', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expectBodyHasNoSecrets(res);
  });

  it('instância connected sem phone_number_id retorna 500 sem Graph', async () => {
    const { insertChain } = setupNewSendLookups({
      instance: { ...FAKE_INSTANCE, phone_number_id: null },
    });
    const res = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ phone_number_id: '999999999999' }),
    }), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(insertChain.insert.mock.calls[0][0]).not.toHaveProperty('phone_number_id');
    expect(JSON.stringify(res._body)).not.toContain('999999999999');
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PHONE_NUM_ID);
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain('meta_whatsapp_credentials');
    expectBodyHasNoSecrets(res);
    expectOrchestratorNotCalled();
    expect(fsState.unlinkCalls.length).toBeGreaterThan(0);
    for (const filepath of fsState.unlinkCalls) {
      expect(existsSync(filepath)).toBe(false);
    }
  });

  it('instância connected com phone_number_id vazio retorna 500 sem Graph', async () => {
    setupNewSendLookups({
      instance: { ...FAKE_INSTANCE, phone_number_id: '' },
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(res._body).not.toHaveProperty('phoneNumberId');
    expectOrchestratorNotCalled();
  });

  it('sendContext nulo é recusado antes do Graph', () => {
    const fnStart = HANDLER_SRC.indexOf('async function respondCreatedGraphSend');
    const fnEnd = HANDLER_SRC.indexOf('async function gateCustomerServiceWindow', fnStart);
    const fnBody = HANDLER_SRC.slice(fnStart, fnEnd);
    expect(fnStart).toBeGreaterThan(0);
    expect(fnBody).toContain('!svc || !instance || !auth || !sendContext');
    expect(fnBody).toContain('enabled: true');
    expect(HANDLER_SRC).toContain('buildCreatedOutboundAudioContext');
    expect(HANDLER_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
  });

  it('completed idêntico permanece 200 e conflitos permanecem 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'completed' })));
    const completedRes = makeRes();
    await handler(makeMultipartReq(), completedRes);
    expect(completedRes._status).toBe(200);
    expect(completedRes._body).toEqual({ ok: true });
    expectBodyHasNoSecrets(completedRes);
    expectOrchestratorNotCalled();

    const conflicts = [
      { status: 'graph_in_flight', error: 'operation_in_progress' },
      { status: 'unknown', error: 'operation_unknown' },
      { status: 'failed', error: 'operation_failed' },
    ];
    for (const item of conflicts) {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
        .mockReturnValueOnce(makeOpSelectChain(operationRow({
          status: item.status,
          wamid: item.wamid ?? null,
        })));
      const res = makeRes();
      await handler(makeMultipartReq(), res);
      expect(res._status).toBe(409);
      expect(res._body).toEqual({ ok: false, error: item.error });
      expectOrchestratorNotCalled();
      orchestratorState.mock.mockClear();
    }
  });

  it('janela fechada para operação nova permanece 409', async () => {
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      }),
    });
    const windowRes = makeRes();
    await handler(makeMultipartReq(), windowRes);
    expect(windowRes._status).toBe(409);
    expect(windowRes._body).toEqual({ error: 'customer_service_window_closed' });
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('JWT inválido permanece 401 antes do parse', async () => {
    setupGetUserFail();
    const jwtRes = makeRes();
    await handler(makeMultipartReq(), jwtRes);
    expect(jwtRes._status).toBe(401);
    expectNoMultipartParsed();
    expectOrchestratorNotCalled();
    expectNoExternalSideEffects();
  });

  it('deadline continua baseado no início da requisição', async () => {
    const origin = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(orchestratorState.mock.mock.calls[0][0].deadlineAtMs).toBe(origin + 57_000);
    expect(HANDLER_SRC).toContain('computeOutboundAudioDeadline(startedAtMs)');
  });

  it('isolamento por company_id, partner e Trilha 2 permanece', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const partnerRes = makeRes();
    await handler(makeMultipartReq(), partnerRes);
    expect(partnerRes._status).toBe(403);
    expectOrchestratorNotCalled();

    mockValidateMetaCaller.mockClear();
    setupGuardOk(FAKE_COMPANY_ID);
    const instChain = makeInstChain(null);
    mockSvc.from = vi.fn().mockReturnValueOnce(instChain);
    const tenantRes = makeRes();
    await handler(makeMultipartReq({
      fields: defaultFields({ company_id: OTHER_COMPANY_ID }),
    }), tenantRes);
    expect(mockValidateMetaCaller.mock.calls[0][2]).toBe(OTHER_COMPANY_ID);
    expect(instChain.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(instChain.eq).not.toHaveBeenCalledWith('company_id', OTHER_COMPANY_ID);
    expect(tenantRes._status).toBe(404);
  });
});

describe('buildCreatedOutboundAudioContext — contrato isolado', () => {
  it('monta contexto não sensível a partir dos dados autorizados', () => {
    const audioBytes = buildAudioMp4(true);
    const ctx = buildCreatedOutboundAudioContext(validCreatedContextInput({ audioBytes }));
    expect(ctx).toEqual({
      companyId: FAKE_COMPANY_ID,
      userId: FAKE_USER_ID,
      instanceId: FAKE_INSTANCE_ID,
      conversationId: FAKE_CONVERSATION_ID,
      operationId: FAKE_OPERATION_ID,
      audioSha256: audioSha256(audioBytes),
      operationStatus: 'created',
      customerServiceWindowOpen: true,
      phoneNumberId: FAKE_PHONE_NUM_ID,
      recipientWaId: FAKE_WA_ID,
      audioBytes,
      deadlineAtMs: 1_737_000_057_000,
    });
    expect(ctx).not.toHaveProperty('accessToken');
    expect(Object.keys(ctx).sort()).toEqual([
      'audioBytes',
      'audioSha256',
      'companyId',
      'conversationId',
      'customerServiceWindowOpen',
      'deadlineAtMs',
      'instanceId',
      'operationId',
      'operationStatus',
      'phoneNumberId',
      'recipientWaId',
      'userId',
    ]);
  });

  it('não copia token, status ou deadline fornecidos pelo cliente', () => {
    const ctx = buildCreatedOutboundAudioContext(validCreatedContextInput({
      accessToken: 'EAA-forbidden',
      operationStatus: 'completed',
      customerServiceWindowOpen: false,
    }));
    expect(ctx.operationStatus).toBe('created');
    expect(ctx.customerServiceWindowOpen).toBe(true);
    expect(ctx).not.toHaveProperty('accessToken');
    expect(JSON.stringify(ctx)).not.toContain('EAA-forbidden');
  });

  it('retorna null quando um campo autorizado está ausente', () => {
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ phoneNumberId: '' }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ recipientWaId: '' }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ audioBytes: Buffer.alloc(0) }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ deadlineAtMs: 1.5 }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(null)).toBeNull();
  });

  it('helper puro aceita phoneNumberId válido e rejeita inválido sem inventar valor', () => {
    const accepted = buildCreatedOutboundAudioContext(validCreatedContextInput());
    expect(accepted).not.toBeNull();
    expect(accepted.phoneNumberId).toBe(FAKE_PHONE_NUM_ID);

    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ phoneNumberId: '' }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ phoneNumberId: null }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ phoneNumberId: undefined }))).toBeNull();
    expect(buildCreatedOutboundAudioContext(validCreatedContextInput({ phoneNumberId: 106540352242922 }))).toBeNull();

    const missingPhone = validCreatedContextInput();
    delete missingPhone.phoneNumberId;
    const rejected = buildCreatedOutboundAudioContext(missingPhone);
    expect(rejected).toBeNull();
    expect(rejected).not.toEqual(expect.objectContaining({ phoneNumberId: FAKE_PHONE_NUM_ID }));
    expect(rejected).not.toEqual(expect.objectContaining({ phoneNumberId: '0' }));
  });
});

describe('POST /api/whatsapp/meta/messages/send-audio — B3.2-C.3-D.3-E.2-B.7-B graph_accepted', () => {
  async function runGraphAccepted(req = makeMultipartReq()) {
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  it('JWT inválido bloqueia AWS e B.6', async () => {
    setupGetUserFail();
    const res = await runGraphAccepted();
    expect(res._status).toBe(401);
    expectNoMultipartParsed();
    expectNoExternalSideEffects();
  });

  it('usuário inativo bloqueia AWS e B.6', async () => {
    setupGuardFail(403, 'Acesso negado a esta empresa');
    const res = await runGraphAccepted();
    expect(res._status).toBe(403);
    expectNoExternalSideEffects();
  });

  it('role não autorizada bloqueia AWS e B.6', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = await runGraphAccepted();
    expect(res._status).toBe(403);
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      expect.anything(),
      mockSvc,
      FAKE_COMPANY_ID,
      { roles: META_SEND_ROLES },
    );
    expectNoExternalSideEffects();
  });

  it('partner sem assignment bloqueia AWS e B.6', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const res = await runGraphAccepted();
    expect(res._status).toBe(403);
    expectNoExternalSideEffects();
  });

  it('parent sem permissão sobre client bloqueia AWS e B.6', async () => {
    setupGuardFail(403, 'Acesso negado a esta empresa');
    const res = await runGraphAccepted();
    expect(res._status).toBe(403);
    expectNoExternalSideEffects();
  });

  it('instância de outra empresa bloqueia AWS e B.6', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValueOnce(makeInstChain(null));
    const res = await runGraphAccepted();
    expect(res._status).toBe(404);
    expectNoExternalSideEffects();
  });

  it('conversa de outra empresa bloqueia AWS e B.6', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(null));
    const res = await runGraphAccepted();
    expect(res._status).toBe(404);
    expectNoExternalSideEffects();
  });

  it('SHA divergente bloqueia AWS e B.6', async () => {
    setupGraphAcceptedLookups({ audio_sha256: 'b'.repeat(64) });
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
    expectNoExternalSideEffects();
  });

  it('áudio inválido bloqueia AWS e B.6', async () => {
    setupHappyLookups();
    const res = await runGraphAccepted(makeMultipartReq({
      file: {
        fieldName: 'file',
        filename: 'a.webm',
        mime: 'audio/webm',
        buffer: webmBytes(),
      },
    }));
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_audio' });
    expectNoExternalSideEffects();
  });

  it('graph_accepted válido retorna 200 { ok: true }', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expectNoGraphOrClaim();
  });

  it('graph_accepted com janela 24h fechada retorna 200 sem consultar meta_messages', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    mockSvc.from
      .mockReturnValueOnce(makeReconcilePendingChain())
      .mockReturnValueOnce(makeReconcileMarkerChain());
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables).toEqual([
      'meta_whatsapp_instances',
      'meta_conversations',
      'meta_outbound_audio_operations',
      'meta_early_status_pendings',
      'meta_whatsapp_messages',
    ]);
    expect(tables).not.toContain('meta_messages');
    expectNoGraphOrClaim();
  });

  it('created com janela aberta envia Graph mockado', async () => {
    setupGraphCreatedLookups();
    const res = await runGraphAccepted();
    expectCreatedGraphSuccess(res);
  });

  it('created com janela fechada permanece 409', async () => {
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      }),
    });
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_closed' });
    expectNoExternalSideEffects();
  });

  it('completed idêntico retorna 200 sem AWS', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'completed' })));
    const res = await runGraphAccepted();
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expectNoExternalSideEffects();
  });

  it('completed divergente retorna 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({
        status: 'completed',
        audio_sha256: 'b'.repeat(64),
      })));
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
    expectNoExternalSideEffects();
  });

  it('graph_in_flight retorna 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'graph_in_flight' })));
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_in_progress' });
    expectNoExternalSideEffects();
  });

  it('unknown retorna 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'unknown' })));
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_unknown' });
    expectNoExternalSideEffects();
  });

  it('failed retorna 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'failed' })));
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_failed' });
    expectNoExternalSideEffects();
  });

  it('graph_accepted no reselect pós-23505 usa a mesma função de recuperação', async () => {
    setupGuardOk();
    setupAwsRpcOk();
    const insertChain = makeOpInsertChain(null, { code: '23505', message: 'duplicate key' });
    const racedSelect = makeOpSelectChain(graphAcceptedRow());
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(null))
      .mockReturnValueOnce(makeWindowChain())
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(racedSelect);
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(racedSelect.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(racedSelect.eq).toHaveBeenCalledWith('operation_id', FAKE_OPERATION_ID);
    expectNoGraphOrClaim();
    const resumeCalls = HANDLER_SRC.match(/resumeGraphAcceptedPersistence\(/g) ?? [];
    expect(resumeCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('tempo suficiente segue para AWS e B.6', async () => {
    const origin = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(origin);
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expect(META_AUDIO_PERSIST_MIN_REMAINING_MS).toBe(30_000);
    expect(computeOutboundAudioDeadline(origin) - origin).toBe(57_000);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(persistState.mock).toHaveBeenCalledTimes(1);
  });

  it('tempo insuficiente retorna 503 persist_deadline_insufficient', async () => {
    const origin = 1_700_000_000_000;
    let calls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? origin : origin + 40_000;
    });
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'persist_deadline_insufficient' });
    expect(computeOutboundAudioDeadline(origin) - (origin + 40_000)).toBe(17_000);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(persistState.mock).not.toHaveBeenCalled();
    expect(s3State.S3Client).not.toHaveBeenCalled();
    expect(persistStoreState.upload).not.toHaveBeenCalled();
    expect(persistStoreState.library).not.toHaveBeenCalled();
    expect(persistStoreState.tracking).not.toHaveBeenCalled();
    expect(persistStoreState.chat).not.toHaveBeenCalled();
    expect(persistStoreState.markCompleted).not.toHaveBeenCalled();
    expectNoGraphOrClaim();
  });

  it('deadline insuficiente não chama RPC AWS', async () => {
    const origin = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => origin + 40_000);
    Date.now.mockReturnValueOnce(origin);
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expect(res._status).toBe(503);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('deadline insuficiente não chama S3 nem INSERT de persistência', async () => {
    const origin = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => origin + 40_000);
    Date.now.mockReturnValueOnce(origin);
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(s3State.S3Client).not.toHaveBeenCalled();
    expect(persistStoreState.upload).not.toHaveBeenCalled();
    expect(persistStoreState.library).not.toHaveBeenCalled();
    expect(persistStoreState.markCompleted).not.toHaveBeenCalled();
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables.filter((table) => table === 'meta_outbound_audio_operations')).toEqual([
      'meta_outbound_audio_operations',
    ]);
  });

  it('gate temporal ocorre antes da RPC AWS', async () => {
    const origin = 1_700_000_000_000;
    let rpcOrder = null;
    vi.spyOn(Date, 'now').mockImplementation(() => origin + 40_000);
    Date.now.mockReturnValueOnce(origin);
    setupGraphAcceptedLookups();
    mockSvc.rpc.mockImplementation(() => {
      rpcOrder = Date.now.mock.invocationCallOrder[Date.now.mock.calls.length - 1];
      return Promise.resolve({ data: [FAKE_AWS_CREDS], error: null });
    });
    const res = await runGraphAccepted();
    expect(res._status).toBe(503);
    expect(rpcOrder).toBeNull();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(HANDLER_SRC).toContain('remainingMs < META_AUDIO_PERSIST_MIN_REMAINING_MS');
    expect(HANDLER_SRC).toContain("webhook_resolve_aws_credentials");
    const resumeStart = HANDLER_SRC.indexOf('async function resumeGraphAcceptedPersistence');
    const remainingIdx = HANDLER_SRC.indexOf('deadlineAtMs - Date.now()', resumeStart);
    const awsCallIdx = HANDLER_SRC.indexOf('resolveOutboundAwsClient(svc, auth.companyId)', resumeStart);
    expect(remainingIdx).toBeGreaterThan(resumeStart);
    expect(awsCallIdx).toBeGreaterThan(remainingIdx);
  });

  it('RPC AWS usa auth.companyId', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(mockSvc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', {
      p_company_id: FAKE_COMPANY_ID,
    });
    expect(mockSvc.rpc.mock.calls[0][1].p_company_id).not.toBe(OTHER_COMPANY_ID);
  });

  it('RPC AWS só ocorre após autorização e identidade', async () => {
    setupGetUserFail();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(mockSvc.rpc).not.toHaveBeenCalled();

    setupGetUserOk();
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    await runGraphAccepted();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('RPC com credenciais válidas constrói S3Client', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expect(s3State.S3Client).toHaveBeenCalledTimes(1);
    expect(s3State.S3Client).toHaveBeenCalledWith({
      region: FAKE_AWS_CREDS.region,
      credentials: {
        accessKeyId: FAKE_AWS_CREDS.access_key_id,
        secretAccessKey: FAKE_AWS_CREDS.secret_access_key,
      },
      maxAttempts: 1,
    });
  });

  it('RPC com credenciais ausentes retorna 500 send_persistence_failed', async () => {
    setupGraphAcceptedLookups();
    mockSvc.rpc.mockResolvedValue({ data: [], error: null });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(persistState.mock).toHaveBeenCalledTimes(1);
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
    expect(s3State.S3Client).not.toHaveBeenCalled();
  });

  it('RPC com credenciais incompletas retorna 500 send_persistence_failed', async () => {
    setupGraphAcceptedLookups();
    mockSvc.rpc.mockResolvedValue({
      data: [{ region: 'sa-east-1', bucket: 'lovoo-tenant-bucket' }],
      error: null,
    });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(persistState.mock).toHaveBeenCalledTimes(1);
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
    expect(s3State.S3Client).not.toHaveBeenCalled();
  });

  it('RPC com erro retorna 500 send_persistence_failed', async () => {
    setupGraphAcceptedLookups();
    mockSvc.rpc.mockResolvedValue({ data: null, error: { message: 'rpc fail' } });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(JSON.stringify(res._body)).not.toContain('rpc fail');
    expect(persistState.mock).toHaveBeenCalledTimes(1);
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
  });

  it('RPC com exceção retorna 500 send_persistence_failed', async () => {
    setupGraphAcceptedLookups();
    mockSvc.rpc.mockRejectedValue(new Error('aws rpc exploded'));
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(JSON.stringify(res._body)).not.toContain('aws rpc exploded');
    expect(persistState.mock).toHaveBeenCalledTimes(1);
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
  });

  it('S3Client usa maxAttempts 1', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(s3State.S3Client.mock.calls[0][0].maxAttempts).toBe(1);
  });

  it('tracking é criado antes da RPC AWS e do upload S3', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
    expect(persistStoreState.upload).toHaveBeenCalledTimes(1);
    expect(persistStoreState.tracking.mock.invocationCallOrder[0])
      .toBeLessThan(mockSvc.rpc.mock.invocationCallOrder[0]);
    expect(persistStoreState.tracking.mock.invocationCallOrder[0])
      .toBeLessThan(persistStoreState.upload.mock.invocationCallOrder[0]);
    expect(persistStoreState.tracking).toHaveBeenCalledWith({
      supabase: mockSvc,
      context: {
        companyId: FAKE_COMPANY_ID,
        instanceId: FAKE_INSTANCE_ID,
        wamid: FAKE_WAMID,
      },
    });
    const trackingIdx = HANDLER_SRC.indexOf('persistOutboundAudioTracking: (context)');
    const uploadIdx = HANDLER_SRC.indexOf('uploadMetaOutboundAudio: async (args)');
    expect(trackingIdx).toBeGreaterThan(0);
    expect(uploadIdx).toBeGreaterThan(trackingIdx);
  });

  it('falha de tracking não inicia AWS/S3 nem Graph', async () => {
    persistStoreState.tracking.mockResolvedValue({ ok: false, error: 'tracking_conflict' });
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(persistStoreState.tracking).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(persistStoreState.upload).not.toHaveBeenCalled();
    expect(s3State.S3Client).not.toHaveBeenCalled();
    expectNoGraphOrClaim();
  });

  it('não faz fallback para process.env AWS', async () => {
    const previousKey = process.env.AWS_ACCESS_KEY_ID;
    const previousSecret = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'GLOBALKEY';
    process.env.AWS_SECRET_ACCESS_KEY = 'GLOBALSECRET';
    try {
      setupGraphAcceptedLookups();
      setupAwsRpcOk();
      const res = await runGraphAccepted();
      expectPersistSuccessHttp(res);
      expect(s3State.S3Client.mock.calls[0][0].credentials.accessKeyId)
        .toBe(FAKE_AWS_CREDS.access_key_id);
      expect(s3State.S3Client.mock.calls[0][0].credentials.accessKeyId)
        .not.toBe('GLOBALKEY');
      expect(HANDLER_SRC).not.toContain('AWS_ACCESS_KEY_ID');
      expect(HANDLER_SRC).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(JSON.stringify(res._body)).not.toContain('GLOBALKEY');
      expect(JSON.stringify(res._body)).not.toContain('GLOBALSECRET');
    } finally {
      if (previousKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = previousKey;
      if (previousSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previousSecret;
    }
  });

  it('nenhum segredo AWS, SHA, wamid ou s3Key no corpo HTTP', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
    expectBodyHasNoSecrets(res);
  });

  it('injeta adaptadores B.6 no formato real', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    const { dependencies } = lastPersistInput();
    expect(Object.keys(dependencies).sort()).toEqual([
      'markCompleted',
      'persistOutboundAudioChat',
      'persistOutboundAudioMediaLibrary',
      'persistOutboundAudioTracking',
      'selectByCompanyOperation',
      'uploadMetaOutboundAudio',
    ]);
    await dependencies.uploadMetaOutboundAudio({ companyId: FAKE_COMPANY_ID });
    expect(persistStoreState.upload).toHaveBeenCalledWith({
      companyId: FAKE_COMPANY_ID,
      s3Client: expect.any(Object),
      bucket: FAKE_AWS_CREDS.bucket,
    });
    await dependencies.persistOutboundAudioMediaLibrary({ companyId: FAKE_COMPANY_ID });
    expect(persistStoreState.library).toHaveBeenCalledWith({
      supabase: mockSvc,
      context: { companyId: FAKE_COMPANY_ID },
    });
    await dependencies.persistOutboundAudioTracking({ companyId: FAKE_COMPANY_ID });
    expect(persistStoreState.tracking).toHaveBeenCalledWith({
      supabase: mockSvc,
      context: { companyId: FAKE_COMPANY_ID },
    });
    await dependencies.persistOutboundAudioChat({ companyId: FAKE_COMPANY_ID });
    expect(persistStoreState.chat).toHaveBeenCalledWith({
      supabase: mockSvc,
      context: { companyId: FAKE_COMPANY_ID },
    });
    await dependencies.markCompleted({ companyId: FAKE_COMPANY_ID, operationId: FAKE_OPERATION_ID });
    expect(persistStoreState.markCompleted).toHaveBeenCalledWith(mockSvc, {
      companyId: FAKE_COMPANY_ID,
      operationId: FAKE_OPERATION_ID,
    });
  });

  it('contexto B.6 usa dados autorizados e s3Key determinística', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    const { context } = lastPersistInput();
    expect(context.companyId).toBe(FAKE_COMPANY_ID);
    expect(context.userId).toBe(FAKE_USER_ID);
    expect(context.instanceId).toBe(FAKE_INSTANCE_ID);
    expect(context.conversationId).toBe(FAKE_CONVERSATION_ID);
    expect(context.operationId).toBe(FAKE_OPERATION_ID);
    expect(context.audioSha256).toBe(audioSha256());
    expect(Buffer.isBuffer(context.audioBytes)).toBe(true);
    expect(context.audioSizeBytes).toBe(context.audioBytes.length);
    expect(context.s3Key).toBe(EXPECTED_S3_KEY);
  });

  it('wamid não vem do multipart', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted(makeMultipartReq({
      fields: defaultFields({ wamid: 'wamid.FROM_CLIENT' }),
    }));
    const { context } = lastPersistInput();
    expect(context).not.toHaveProperty('wamid');
    expect(JSON.stringify(context)).not.toContain('wamid.FROM_CLIENT');
  });

  it('providerTimestamp = graph_started_at interno estável', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    const { context } = lastPersistInput();
    expect(context.providerTimestamp).toBe(GRAPH_STARTED_AT);
    expect(HANDLER_SRC).toContain('providerTimestamp: stored.graph_started_at');
    expect(HANDLER_SRC).toContain('NÃO é o horário Graph');
  });

  it('completedAt é ISO gerado no caller', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    const { context } = lastPersistInput();
    expect(context.completedAt).toMatch(ISO_TZ_RE);
    expect(Number.isFinite(Date.parse(context.completedAt))).toBe(true);
    expect(HANDLER_SRC).toContain('completedAt: new Date().toISOString()');
  });

  it('sucesso B.6 retorna HTTP 200', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: true, wamid: FAKE_WAMID, s3Key: EXPECTED_S3_KEY });
    const res = await runGraphAccepted();
    expectPersistSuccessHttp(res);
  });

  it('falha S3 retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 's3_confirmation_failed' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('falha da biblioteca retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'media_library_persistence_failed' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('falha de tracking retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'tracking_persistence_failed' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('falha de chat retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'chat_persistence_failed' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('CAS indeterminado retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'completion_indeterminate' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('identidade divergente em B.6 retorna HTTP 409', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'operation_identity_conflict' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
  });

  it('exceção B.6 retorna HTTP 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockRejectedValue(new Error('persist exploded'));
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(JSON.stringify(res._body)).not.toContain('persist exploded');
  });

  it('nenhum Graph uploadMedia', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('nenhum Graph sendAudioMessage', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
  });

  it('nenhum claim', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(orchestratorState.mock).not.toHaveBeenCalled();
  });

  it('graph_accepted resume B.6 sem Graph mesmo sem env de gate', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(HANDLER_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('fluxo Uazapi permanece intacto na fonte HTTP Meta', () => {
    expect(HANDLER_SRC.toLowerCase()).not.toContain('uazapi');
  });

  it('multipart 4 MiB permanece', () => {
    expect(HANDLER_SRC).toContain('maxFileSize: META_OUTBOUND_AUDIO_MAX_BYTES');
    expect(META_OUTBOUND_AUDIO_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it('JWT antes do multipart permanece', () => {
    const handlerStart = HANDLER_SRC.indexOf('export default async function handler');
    const jwt = HANDLER_SRC.indexOf('requireValidJwtUser(req, svc)', handlerStart);
    const parse = HANDLER_SRC.indexOf('parseMultipart(req)', handlerStart);
    expect(jwt).toBeGreaterThan(handlerStart);
    expect(parse).toBeGreaterThan(jwt);
  });

  it('fonte HTTP não altera migrations, RLS, vercel ou frontend', () => {
    expect(HANDLER_SRC).not.toContain('supabase/migrations');
    expect(HANDLER_SRC).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(HANDLER_SRC).not.toContain("from '../../../src/");
    expect(HANDLER_SRC).not.toMatch(/from\s+['"][^'"]*vercel\.json['"]/);
  });

  it('nenhuma credencial Meta é lida ou descriptografada', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    await runGraphAccepted();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    const tables = mockSvc.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain('meta_whatsapp_credentials');
  });

  it('completion_conflict de B.6 mapeia para 409 operation_conflict', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'completion_conflict' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
  });

  it('SELECT B.6 indeterminado retorna 500', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'operation_indeterminate' });
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
  });

  it('graph_started_at inválido não chama AWS', async () => {
    setupGraphAcceptedLookups({ graph_started_at: 'not-iso' });
    setupAwsRpcOk();
    const res = await runGraphAccepted();
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    expect(persistState.mock).not.toHaveBeenCalled();
  });
});

function setupGraphCreatedLookups(overrides = {}) {
  mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
  mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
  mockSendAudioMessage.mockResolvedValue({ messageId: FAKE_WAMID });
  setupAwsRpcOk();
  const extraChains = [
    makeCredChain({ access_token_enc: 'v1:enc-fixture' }),
    makeOpSelectChain(graphAcceptedRow()),
    ...(overrides.extraChains ?? []),
  ];
  return setupNewSendLookups({ ...overrides, extraChains });
}

function setupExistingCreatedGraphLookups(rowOverrides = {}) {
  mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
  mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
  mockSendAudioMessage.mockResolvedValue({ messageId: FAKE_WAMID });
  setupAwsRpcOk();
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
    .mockReturnValueOnce(makeOpSelectChain(operationRow(rowOverrides)))
    .mockReturnValueOnce(makeWindowChain())
    .mockReturnValueOnce(makeCredChain({ access_token_enc: 'v1:enc-fixture' }))
    .mockReturnValueOnce(makeOpSelectChain(graphAcceptedRow()));
}

describe('POST /api/whatsapp/meta/messages/send-audio — Graph após validações reais', () => {
  it('created válido percorre claim + Graph + B.6 sem env', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
    expect(persistStoreState.markGraphAccepted).toHaveBeenCalledTimes(1);
    expect(mockSendAudioMessage.mock.calls[0][4]).toEqual({ timeoutMs: 10_000 });
    expect(JSON.stringify(res._body)).not.toContain('plain-token-fixture');
    expect(JSON.stringify(res._body)).not.toContain('v1:enc-fixture');
  });

  it('env antiga e host de produção não bloqueiam nem autorizam o Graph', async () => {
    process.env.META_OUTBOUND_AUDIO_GRAPH_ENABLED = 'false';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'app.lovoocrm.com';
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectCreatedGraphSuccess(res);
  });

  it('Host header não substitui JWT nem credencial', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq({
      headers: { host: 'lovoo-dev.vercel.app' },
    }), res);
    expectCreatedGraphSuccess(res);
    expect(HANDLER_SRC).not.toContain('req.headers.host');
  });

  it('JWT/RBAC/tenant antes de credenciais e Graph', async () => {
    setupGetUserFail();
    const unauthorized = makeRes();
    await handler(makeMultipartReq(), unauthorized);
    expect(unauthorized._status).toBe(401);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();

    setupGetUserOk();
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const forbidden = makeRes();
    await handler(makeMultipartReq(), forbidden);
    expect(forbidden._status).toBe(403);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
  });

  it('created com janela fechada não chama Graph', async () => {
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      }),
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_closed' });
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('claim CAS vencedor chama Graph uma vez', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(persistStoreState.claim).toHaveBeenCalledTimes(1);
    expect(mockUploadMedia).toHaveBeenCalledTimes(1);
    expect(mockSendAudioMessage).toHaveBeenCalledTimes(1);
    expectPersistSuccessHttp(res);
  });

  it('claim perdedor não chama Graph', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    persistStoreState.claim.mockResolvedValue({ ok: false, reason: 'not_claimed' });
    setupNewSendLookups({
      extraChains: [makeCredChain({ access_token_enc: 'v1:enc-fixture' })],
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_in_progress' });
    expect(persistStoreState.claim).toHaveBeenCalledTimes(1);
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(persistState.mock).not.toHaveBeenCalled();
  });

  it('upload falha após claim → unknown sem retry', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    mockUploadMedia.mockRejectedValue(Object.assign(new Error('upload timeout'), {
      code: 'upload_media_timeout',
    }));
    setupNewSendLookups({
      extraChains: [makeCredChain({ access_token_enc: 'v1:enc-fixture' })],
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_unknown' });
    expect(persistStoreState.claim).toHaveBeenCalledTimes(1);
    expect(mockUploadMedia).toHaveBeenCalledTimes(1);
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(persistStoreState.markUnknown).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('Graph 131047 após claim → 409 janela fechada, unknown persistido, sem retry', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
    mockSendAudioMessage.mockRejectedValue(Object.assign(new Error('reengagement'), {
      code: 'send_audio_failed',
      graphStatus: 400,
      metaErrorCode: 131047,
    }));
    setupNewSendLookups({
      extraChains: [makeCredChain({ access_token_enc: 'v1:enc-fixture' })],
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'customer_service_window_closed' });
    expect(mockSendAudioMessage).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markUnknown).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('send timeout → unknown sem retry', async () => {
    mockDecryptMetaToken.mockReturnValue('plain-token-fixture');
    mockUploadMedia.mockResolvedValue({ mediaId: '123456789' });
    mockSendAudioMessage.mockRejectedValue(Object.assign(new Error('send timeout'), {
      code: 'send_audio_timeout',
    }));
    setupNewSendLookups({
      extraChains: [makeCredChain({ access_token_enc: 'v1:enc-fixture' })],
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_unknown' });
    expect(mockSendAudioMessage).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markUnknown).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('wamid válido → markGraphAccepted', async () => {
    setupGraphCreatedLookups();
    await handler(makeMultipartReq(), makeRes());
    expect(persistStoreState.markGraphAccepted).toHaveBeenCalledWith(mockSvc, {
      companyId: FAKE_COMPANY_ID,
      operationId: FAKE_OPERATION_ID,
      wamid: FAKE_WAMID,
    });
  });

  it('falha de persistência B.6 não reenvia Graph', async () => {
    setupGraphCreatedLookups();
    persistState.mock.mockResolvedValue({ ok: false, error: 's3_confirmation_failed' });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'send_persistence_failed' });
    expect(mockUploadMedia).toHaveBeenCalledTimes(1);
    expect(mockSendAudioMessage).toHaveBeenCalledTimes(1);
    expect(persistStoreState.markGraphAccepted).toHaveBeenCalledTimes(1);
  });

  it('completed → 200 sem Graph', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'completed' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('graph_accepted → somente B.6', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectPersistSuccessHttp(res);
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(persistState.mock).toHaveBeenCalledTimes(1);
  });

  it('unknown → 409 sem Graph', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({ status: 'unknown' })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_unknown' });
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('identidade divergente → 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({
        audio_sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      })));
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ ok: false, error: 'operation_conflict' });
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('23505 → releitura segura sem Graph se completed', async () => {
    setupNewSendLookups({
      insertError: { code: '23505', message: 'duplicate' },
      extraChains: [makeOpSelectChain(operationRow({ status: 'completed' }))],
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('deadline insuficiente → sem Graph', async () => {
    const origin = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => origin + 40_000);
    Date.now.mockReturnValueOnce(origin);
    setupNewSendLookups({
      window: makeWindowChain({
        data: { provider_timestamp: new Date(origin - 60 * 60 * 1000).toISOString() },
      }),
    });
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(GRAPH_NEED_BEFORE_CLAIM_MS).toBe(33_000);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'graph_deadline_insufficient' });
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    expect(persistStoreState.claim).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('nenhum token ou segredo no HTTP', async () => {
    setupGraphCreatedLookups();
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectPersistSuccessHttp(res);
    expect(JSON.stringify(res._body)).not.toContain('plain-token-fixture');
    expect(JSON.stringify(res._body)).not.toContain('Bearer');
    expect(JSON.stringify(res._body)).not.toContain('AKIATESTFAKE');
  });

  it('regressão Uazapi inexistente', () => {
    expect(HANDLER_SRC.toLowerCase()).not.toContain('uazapi');
  });
});

describe('POST /api/whatsapp/meta/messages/send-audio — reconciliação posterior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('graph_accepted concluído reconcilia o wamid gravado sem novo Graph', async () => {
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const pending = makeReconcilePendingChain();
    mockSvc.from
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(makeReconcileMarkerChain());
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expectPersistSuccessHttp(res);
    expectNoGraphOrClaim();
    expect(pending.eq).toHaveBeenCalledWith('meta_message_id', FAKE_WAMID);
    expect(pending.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(pending.eq).toHaveBeenCalledWith('instance_id', FAKE_INSTANCE_ID);
    const rpcNames = mockSvc.rpc.mock.calls.map(([name]) => name);
    expect(rpcNames).not.toContain('list_meta_early_status_pendings');
    expect(rpcNames).not.toContain('delete_expired_meta_early_status_pendings');
  });

  it('operação completed reconcilia pendência e marcador sem reabrir a cadeia', async () => {
    setupGuardOk();
    const pending = makeReconcilePendingChain();
    const marker = makeReconcileMarkerChain({
      id: FAKE_INSTANCE_ID,
      company_id: FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      status: 'delivered',
      realtime_notify_pending: true,
    });
    const touch = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 'chat-1' }], error: null }),
    };
    const clear = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: FAKE_INSTANCE_ID }], error: null }),
    };
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({
        status: 'completed',
        wamid: FAKE_WAMID,
        s3_key: EXPECTED_S3_KEY,
        completed_at: GRAPH_STARTED_AT,
      })))
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(marker)
      .mockReturnValueOnce(touch)
      .mockReturnValueOnce(clear);
    const res = makeRes();
    await handler(makeMultipartReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expect(persistState.mock).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(touch.update).toHaveBeenCalled();
    expect(clear.update).toHaveBeenCalledWith({ realtime_notify_pending: false });
    expect(pending.eq).toHaveBeenCalledWith('meta_message_id', FAKE_WAMID);
  });

  it('falha ou exceção da reconciliação preserva 200 sem novo Graph', async () => {
    const spy = vi.spyOn(outboundStatusTracking, 'reconcilePersistedOutboundStatus')
      .mockResolvedValue({ ok: false, reason: 'db_error' });
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const failure = makeRes();
    await handler(makeMultipartReq(), failure);
    expect(failure._status).toBe(200);
    expect(failure._body).toEqual({ ok: true });
    spy.mockRejectedValue(new Error('reconcile exploded'));
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    const exploded = makeRes();
    await handler(makeMultipartReq(), exploded);
    expect(exploded._status).toBe(200);
    expect(exploded._body).toEqual({ ok: true });
    expect(JSON.stringify(exploded._body)).not.toContain('reconcile exploded');
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  it('falha obrigatória e estados não concluídos não reconciliam', async () => {
    const spy = vi.spyOn(outboundStatusTracking, 'reconcilePersistedOutboundStatus');
    setupGraphAcceptedLookups();
    setupAwsRpcOk();
    persistState.mock.mockResolvedValue({ ok: false, error: 'chat_persistence_failed' });
    const failed = makeRes();
    await handler(makeMultipartReq(), failed);
    expect(failed._status).toBe(500);
    expect(failed._body).toEqual({ error: 'send_persistence_failed' });

    for (const status of ['graph_in_flight', 'failed', 'unknown']) {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
        .mockReturnValueOnce(makeOpSelectChain(operationRow({ status })));
      const res = makeRes();
      await handler(makeMultipartReq(), res);
      expect(res._status).toBe(409);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
  });

  it('aguarda a reconciliação antes do 200 de completed', async () => {
    let entered;
    const enteredGate = new Promise((resolve) => { entered = resolve; });
    let release;
    const block = new Promise((resolve) => { release = resolve; });
    vi.spyOn(outboundStatusTracking, 'reconcilePersistedOutboundStatus')
      .mockImplementation(() => {
        entered();
        return block.then(() => ({ ok: true, notified: false }));
      });
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeConvChain(FAKE_CONVERSATION))
      .mockReturnValueOnce(makeOpSelectChain(operationRow({
        status: 'completed',
        wamid: FAKE_WAMID,
      })));
    const res = makeRes();
    const pending = handler(makeMultipartReq(), res);
    await enteredGate;
    expect(res._status).toBeNull();
    release();
    await pending;
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expect(mockSendAudioMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// disconnect-invariants.test.js
//
// Confirma que a desconexão NÃO exige alteração de envio, GET, webhook ou Uazapi.
// Mocks apenas — zero Graph real, zero SQL WRITE, zero mensagem enviada.
//
// DC-17  envio texto e template bloqueados quando status=disconnected
// DC-18  GET /instances ainda lista instância disconnected
// DC-19  webhook resolve tenant por phone_number_id + deleted_at IS NULL
// DC-20  Uazapi permanece fora do fluxo Meta
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockSvc = { from: vi.fn(), rpc: vi.fn() };
vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockSendTextMessage     = vi.fn();
const mockSendTemplateMessage = vi.fn();
const mockListTemplates       = vi.fn();
const mockUploadMedia         = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  sendTextMessage:      (...args) => mockSendTextMessage(...args),
  sendTemplateMessage:  (...args) => mockSendTemplateMessage(...args),
  listMessageTemplates: (...args) => mockListTemplates(...args),
  uploadMedia:          (...args) => mockUploadMedia(...args),
}));

import sendHandler from '../../messages/send.js';
import sendTemplateHandler from '../../messages/send-template.js';
import listHandler from '../../instances.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBHOOK_SRC = readFileSync(join(HERE, '../../webhook.js'), 'utf8');
const SEND_SRC = readFileSync(join(HERE, '../../messages/send.js'), 'utf8');
const SEND_TPL_SRC = readFileSync(join(HERE, '../../messages/send-template.js'), 'utf8');
const LIST_SRC = readFileSync(join(HERE, '../../instances.js'), 'utf8');
const DISCONNECT_SRC = readFileSync(join(HERE, '../disconnect.js'), 'utf8');

const FAKE_COMPANY_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID         = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID     = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_PHONE_ID        = '106540352242922';
const FAKE_WABA_ID         = '1993847387980529';

const DISCONNECTED_INSTANCE = {
  id:              FAKE_INSTANCE_ID,
  company_id:      FAKE_COMPANY_ID,
  phone_number_id: FAKE_PHONE_ID,
  waba_id:         FAKE_WABA_ID,
  status:          'disconnected',
};

function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    order:       vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeRes() {
  return {
    _status: null, _body: null, _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

function setupGuardOk() {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId: FAKE_COMPANY_ID, role: 'admin', accessPath: 'direct',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupGuardOk();
});

describe('DC-17: envio bloqueado após desconexão', () => {
  it('texto: status disconnected → 409 instance_not_connected, zero Graph', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(DISCONNECTED_INSTANCE));
    const res = makeRes();
    await sendHandler({
      method:  'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body:    {
        company_id:      FAKE_COMPANY_ID,
        instance_id:     FAKE_INSTANCE_ID,
        conversation_id: FAKE_CONVERSATION_ID,
        message:         { type: 'text', text: { body: 'hello' } },
      },
    }, res);

    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'instance_not_connected' });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  });

  it('template: status disconnected → 409 instance_not_connected, zero Graph', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(DISCONNECTED_INSTANCE));
    const res = makeRes();
    await sendTemplateHandler({
      method:  'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body:    {
        company_id:        FAKE_COMPANY_ID,
        instance_id:       FAKE_INSTANCE_ID,
        conversation_id:   FAKE_CONVERSATION_ID,
        template_name:     'hello_world',
        template_language: 'pt_BR',
        parameter_values:  { body: {} },
      },
    }, res);

    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'instance_not_connected' });
    expect(mockSendTemplateMessage).not.toHaveBeenCalled();
    expect(mockListTemplates).not.toHaveBeenCalled();
    expect(mockUploadMedia).not.toHaveBeenCalled();
  });

  it('send.js e send-template.js ainda exigem status connected', () => {
    expect(SEND_SRC).toContain("instance.status !== 'connected'");
    expect(SEND_TPL_SRC).toContain("instance.status !== 'connected'");
  });
});

describe('DC-18: GET ainda lista instância desconectada', () => {
  it('instância disconnected aparece no GET sem filtro de status', async () => {
    const listed = {
      id:              FAKE_INSTANCE_ID,
      phone_number_id: FAKE_PHONE_ID,
      waba_id:         FAKE_WABA_ID,
      display_name:    null,
      phone_number:    '+55 11 90000-0000',
      verified_name:   'Empresa Fake',
      status:          'disconnected',
      created_at:      '2026-09-14T12:00:00.000Z',
      updated_at:      '2026-10-23T12:00:00.000Z',
    };
    const chain = makeSelectChain([listed]);
    mockSvc.from = vi.fn().mockReturnValue(chain);

    const res = makeRes();
    await listHandler({
      method:  'GET',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      query:   { company_id: FAKE_COMPANY_ID },
    }, res);

    expect(res._status).toBe(200);
    expect(res._body.instances).toHaveLength(1);
    expect(res._body.instances[0].status).toBe('disconnected');
    expect(res._body.instances[0].id).toBe(FAKE_INSTANCE_ID);
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(chain.eq).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'connected');
  });

  it('GET não filtra status no código', () => {
    expect(LIST_SRC).toContain(".is('deleted_at', null)");
    expect(LIST_SRC).toMatch(/'status'/);
    expect(LIST_SRC).not.toMatch(/\.eq\(\s*['"]status['"]/);
  });
});

describe('DC-19: webhook sem alteração de comportamento', () => {
  it('lookup continua por phone_number_id + deleted_at IS NULL, sem status', () => {
    const start = WEBHOOK_SRC.indexOf('Tenant resolution');
    const end = WEBHOOK_SRC.indexOf('Ramo A');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const lookup = WEBHOOK_SRC.slice(start, end);
    expect(lookup).toContain(".eq('phone_number_id', phoneNumberId)");
    expect(lookup).toContain(".is('deleted_at', null)");
    expect(lookup).not.toMatch(/\.eq\(\s*['"]status['"]/);
    expect(lookup).toContain(".select('id, company_id')");
  });
});

describe('DC-20: Uazapi intocada', () => {
  it('disconnect, send, GET e webhook não importam Uazapi nem whatsapp_life', () => {
    for (const src of [DISCONNECT_SRC, SEND_SRC, SEND_TPL_SRC, LIST_SRC, WEBHOOK_SRC]) {
      expect(src).not.toMatch(/from ['"][^'"]*uazapi/i);
      expect(src).not.toMatch(/whatsapp_life_instances/);
    }
  });
});

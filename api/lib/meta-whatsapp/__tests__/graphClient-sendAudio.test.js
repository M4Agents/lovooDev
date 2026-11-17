// =============================================================================
// graphClient-sendAudio.test.js
//
// Testes unitários para sendAudioMessage (primitiva Graph).
// Mocks apenas — sem secrets reais, sem rede, sem banco, sem Graph real.
//
// Não cobre endpoint HTTP, S3, gravador ou MetaChatArea.
// =============================================================================

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  getMetaServerConfig: vi.fn(),
}));

import { getMetaServerConfig } from '../config.js';
import {
  sendAudioMessage,
  sendTextMessage,
  sendTemplateMessage,
  uploadMedia,
} from '../graphClient.js';

const FAKE_APP_ID    = '111111111111111';
const FAKE_SECRET    = 'fake_app_secret_fixture_not_real';
const FAKE_CONFIG_ID = '222222222222222';
const FAKE_VERSION   = 'v26.0';

const FAKE_CONFIG = {
  appId:        FAKE_APP_ID,
  appSecret:    FAKE_SECRET,
  configId:     FAKE_CONFIG_ID,
  graphVersion: FAKE_VERSION,
};

const FAKE_TOKEN           = 'EAAAN_fake_business_token_not_real_XYZ789';
const FAKE_PHONE_NUMBER_ID = '106540352242922';
const FAKE_TO              = '5511987654321';
const FAKE_MEDIA_ID        = '1013859600285441';
const FAKE_WAMID           = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const FAKE_TEXT            = 'Olá, regressão de texto B1.';

function makeOkResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status) {
  return { ok: false, status, json: async () => ({ error: { code: 190, message: 'Fake error' } }) };
}

function makeJsonErrorResponse() {
  return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token')) };
}

function makeSendOkResponse(wamid = FAKE_WAMID) {
  return makeOkResponse({
    messaging_product: 'whatsapp',
    contacts: [{ input: FAKE_TO, wa_id: FAKE_TO }],
    messages: [{ id: wamid }],
  });
}

function makeAbortError() {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

function makeErrorStreamBody(chunks) {
  let idx = 0;
  return {
    getReader() {
      return {
        async read() {
          if (idx >= chunks.length) return { done: true, value: undefined };
          const value = chunks[idx];
          idx += 1;
          return { done: false, value };
        },
        cancel() { return Promise.resolve(); },
        releaseLock() {},
      };
    },
  };
}

function makeStreamErrorResponse({ status = 400, json } = {}) {
  const rawStr = JSON.stringify(json ?? {});
  const chunks = rawStr.length === 0 ? [] : [utf8(rawStr)];
  const byteLen = chunks.reduce((n, c) => n + c.byteLength, 0);
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-length') return String(byteLen);
        return null;
      },
    },
    body: makeErrorStreamBody(chunks),
  };
}

beforeEach(() => {
  getMetaServerConfig.mockReturnValue(FAKE_CONFIG);
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('sendAudioMessage', () => {
  it('SA-01: sucesso → { messageId: wamid }', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const result = await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    expect(result).toEqual({ messageId: FAKE_WAMID });
  });

  it('SA-02: retorna somente { messageId }', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const result = await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    expect(Object.keys(result)).toEqual(['messageId']);
  });

  it('SA-03: URL usa graphVersion e phoneNumberId /messages', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).toBe(
      `https://graph.facebook.com/${FAKE_VERSION}/${FAKE_PHONE_NUMBER_ID}/messages`,
    );
  });

  it('SA-04: graphVersion vem de getMetaServerConfig', async () => {
    getMetaServerConfig.mockReturnValue({ ...FAKE_CONFIG, graphVersion: 'v99.0' });
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    expect(fetch.mock.calls[0][0].toString()).toContain('/v99.0/');
  });

  it('SA-05: Authorization Bearer + Content-Type JSON', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    const [, callOpts] = fetch.mock.calls[0];
    expect(callOpts.method).toBe('POST');
    expect(callOpts.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(callOpts.headers['Content-Type']).toBe('application/json');
  });

  it('SA-06: payload type=audio, messaging_product=whatsapp, to e mediaId', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                FAKE_TO,
      type:              'audio',
      audio:             { id: FAKE_MEDIA_ID },
    });
  });

  it('SA-07: voice: true explícito inclui audio.voice=true', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID, { voice: true });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.audio).toEqual({ id: FAKE_MEDIA_ID, voice: true });
  });

  it('SA-08: áudio básico omite voice (options ausente)', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.audio).toEqual({ id: FAKE_MEDIA_ID });
    expect(body.audio).not.toHaveProperty('voice');
  });

  it('SA-09: voice: false omite o campo voice', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID, { voice: false });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.audio).not.toHaveProperty('voice');
  });

  it('SA-10: campos extras de options não vazam para o Graph', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID, {
      voice: true,
      link: 'https://evil.example/audio.ogg',
      to: '000',
      type: 'text',
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                FAKE_TO,
      type:              'audio',
      audio:             { id: FAKE_MEDIA_ID, voice: true },
    });
  });

  it('SA-11: exatamente uma chamada fetch no sucesso', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-12: token vazio → send_audio_invalid_input sem fetch', async () => {
    await expect(sendAudioMessage('', FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-13: phoneNumberId não numérico → invalid_input sem fetch', async () => {
    await expect(sendAudioMessage(FAKE_TOKEN, 'abc123', FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-14: to com + → invalid_input sem fetch', async () => {
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, '+5511987654321', FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-15: mediaId vazio → invalid_input sem fetch', async () => {
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, ''))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-16: mediaId não numérico → invalid_input sem fetch', async () => {
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, 'wamid.xxx'))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-17: options array → invalid_input sem fetch', async () => {
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID, []))
      .rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-18: voice string "true" → invalid_input sem fetch', async () => {
    await expect(
      sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID, { voice: 'true' }),
    ).rejects.toMatchObject({ code: 'send_audio_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SA-19: HTTP 400 → send_audio_failed, uma tentativa', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-20: HTTP 500 → send_audio_failed, uma tentativa', async () => {
    fetch.mockResolvedValue(makeErrorResponse(500));
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-21: erro Graph 131047 anexa metaErrorCode numérico', async () => {
    fetch.mockResolvedValue(makeStreamErrorResponse({
      json: {
        error: {
          code: 131047,
          message: 'META_RAW_MESSAGE_SENTINEL',
          type: 'OAuthException',
          fbtrace_id: 'FAKE_FBTRACE_NOT_REAL',
          error_subcode: 2494010,
        },
      },
    }));
    const err = await sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID)
      .then(() => null, (e) => e);
    expect(err.code).toBe('send_audio_failed');
    expect(err.metaErrorCode).toBe(131047);
    expect(err.metaSubcode).toBe(2494010);
    expect(err.message).not.toContain('META_RAW_MESSAGE_SENTINEL');
    expect(err.message).not.toContain('FAKE_FBTRACE_NOT_REAL');
    expect(err.message).not.toContain(FAKE_TOKEN);
    expect(err.message).not.toContain(FAKE_TO);
    expect(err.message).not.toContain(FAKE_MEDIA_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-22: AbortError → send_audio_timeout, uma tentativa', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_timeout' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-23: TypeError de rede → send_audio_network_error, uma tentativa', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_network_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-24: HTTP 200 sem messages → send_audio_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ messaging_product: 'whatsapp' }));
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_response' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-25: HTTP 200 com id vazio → send_audio_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ messages: [{ id: '' }] }));
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_response' });
  });

  it('SA-26: JSON inválido no 200 → send_audio_invalid_response', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse());
    await expect(sendAudioMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'send_audio_invalid_response' });
  });
});

describe('sendAudioMessage — regressão das primitivas existentes', () => {
  it('SA-R01: sendTextMessage continua type=text e sem audio', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const result = await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    expect(result).toEqual({ messageId: FAKE_WAMID });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.type).toBe('text');
    expect(body.text).toEqual({ body: FAKE_TEXT });
    expect(body).not.toHaveProperty('audio');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SA-R02: sendTemplateMessage continua type=template', async () => {
    const tpl = { name: 'hello_world', language: { code: 'pt_BR' } };
    fetch.mockResolvedValue(makeSendOkResponse('wamid.TEMPLATE_REGRESSION_FAKE=='));
    const result = await sendTemplateMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, tpl);
    expect(result).toEqual({ messageId: 'wamid.TEMPLATE_REGRESSION_FAKE==' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.type).toBe('template');
    expect(body.template).toEqual({ name: 'hello_world', language: { code: 'pt_BR' } });
    expect(body).not.toHaveProperty('audio');
  });

  it('SA-R03: uploadMedia continua POST /media multipart, não /messages', async () => {
    fetch.mockResolvedValue(makeOkResponse({ id: FAKE_MEDIA_ID }));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await uploadMedia(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, bytes, 'image/jpeg', 'pic.jpg');
    expect(result).toEqual({ mediaId: FAKE_MEDIA_ID });
    const [callUrl, callOpts] = fetch.mock.calls[0];
    expect(callUrl.toString()).toContain(`/${FAKE_PHONE_NUMBER_ID}/media`);
    expect(callUrl.toString()).not.toContain('/messages');
    expect(callOpts.body).toBeInstanceOf(FormData);
    expect(callOpts.headers['Content-Type']).toBeUndefined();
  });
});

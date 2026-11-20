import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  getMetaServerConfig: vi.fn(),
}));

import { getMetaServerConfig } from '../config.js';
import { createMessageTemplate } from '../graphClient.js';

const FAKE_TOKEN = 'EAAAN_fake_business_token_not_real_XYZ789';
const FAKE_WABA = '102290129340398';
const FAKE_CONFIG = {
  appId: '111111111111111',
  appSecret: 'fake_app_secret_fixture_not_real',
  configId: '222222222222222',
  graphVersion: 'v26.0',
};

const PAYLOAD = {
  name: 'pedido_enviado',
  language: 'pt_BR',
  category: 'UTILITY',
  parameter_format: 'POSITIONAL',
  components: [{ type: 'BODY', text: 'Olá {{1}}', example: { body_text: [['João']] } }],
};

beforeEach(() => {
  getMetaServerConfig.mockReturnValue(FAKE_CONFIG);
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('createMessageTemplate', () => {
  it('CRT-01: POST v26 WABA/message_templates e devolve id/status/category', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '594425479261596', status: 'PENDING', category: 'UTILITY' }),
    });
    const result = await createMessageTemplate(FAKE_TOKEN, FAKE_WABA, PAYLOAD);
    expect(result).toEqual({ id: '594425479261596', status: 'PENDING', category: 'UTILITY' });
    const [url, options] = fetch.mock.calls[0];
    expect(url.toString()).toBe(`https://graph.facebook.com/v26.0/${FAKE_WABA}/message_templates`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    const sent = JSON.parse(options.body);
    expect(sent.allow_category_change).toBe(true);
    expect(sent.waba_id).toBeUndefined();
    expect(sent.access_token).toBeUndefined();
  });

  it('CRT-02: token/waba inválidos não disparam fetch', async () => {
    await expect(createMessageTemplate('', FAKE_WABA, PAYLOAD))
      .rejects.toMatchObject({ code: 'graph_templates_invalid_input' });
    await expect(createMessageTemplate(FAKE_TOKEN, 'https://evil.test', PAYLOAD))
      .rejects.toMatchObject({ code: 'graph_templates_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('CRT-03: HTTP não-2xx → graph_template_create_failed sem message Graph', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'EAA secret leak', code: 100 } }),
    });
    await expect(createMessageTemplate(FAKE_TOKEN, FAKE_WABA, PAYLOAD))
      .rejects.toMatchObject({ code: 'graph_template_create_failed' });
    try {
      await createMessageTemplate(FAKE_TOKEN, FAKE_WABA, PAYLOAD);
    } catch (err) {
      expect(err.message).not.toContain('EAA');
      expect(err.message).not.toContain('secret leak');
    }
  });

  it('CRT-04: timeout e rede', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetch.mockRejectedValueOnce(abort);
    await expect(createMessageTemplate(FAKE_TOKEN, FAKE_WABA, PAYLOAD))
      .rejects.toMatchObject({ code: 'graph_timeout' });
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(createMessageTemplate(FAKE_TOKEN, FAKE_WABA, PAYLOAD))
      .rejects.toMatchObject({ code: 'graph_network_error' });
  });
});

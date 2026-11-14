import { describe, expect, it } from 'vitest';
import handler from '../welcome-popup/public.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('cadastro público', () => {
  it('recusa GET e POST sem gravar, mesmo com corpo pedindo ativação', async () => {
    const get = response();
    const post = response();

    await handler({ method: 'GET', query: { store_id: '7680914', enabled: 'true' } }, get);
    await handler({
      method: 'POST',
      body: { store_id: '7680914', enabled: true, email: 'teste@valleron.store' },
    }, post);

    expect(get.statusCode).toBe(409);
    expect(post.statusCode).toBe(409);
    expect(get.body.code).toBe('publication_blocked');
    expect(post.body.code).toBe('publication_blocked');
    expect(JSON.stringify(post.body)).not.toMatch(/BEMVINDO10|company_id/);
  });
});

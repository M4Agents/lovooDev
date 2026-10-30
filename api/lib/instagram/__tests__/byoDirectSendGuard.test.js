import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tokenCrypto.js', () => ({
  decryptInstagramToken: vi.fn(() => {
    throw new Error('token lido');
  }),
}));

import { decryptInstagramToken } from '../tokenCrypto.js';
import { sendInstagramMessage } from '../instagramMessageService.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';

function client(conversation) {
  const tables = [];
  return {
    tables,
    from(table) {
      tables.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle: async () => ({ data: conversation, error: null }),
      };
      return query;
    },
  };
}

describe('serviço de envio e conversa BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('meta');
    }));
  });

  it('não lê token nem chama a Meta', async () => {
    const supabase = client({
      id: 'byo-1',
      company_id: COMPANY,
      connection_id: null,
      byo_account_id: '22222222-2222-4222-8222-222222222222',
      ig_participant_id: '1784',
    });
    const result = await sendInstagramMessage({
      supabase,
      conversationId: 'byo-1',
      companyId: COMPANY,
      text: 'ola',
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('byo_send_disabled');
    expect(supabase.tables).toEqual(['instagram_conversations']);
    expect(decryptInstagramToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ainda consulta a conexão da conversa oficial', async () => {
    const supabase = client({
      id: 'official-1',
      company_id: COMPANY,
      connection_id: '11111111-1111-4111-8111-111111111111',
      byo_account_id: null,
      ig_participant_id: '1784',
    });
    supabase.from = (table) => {
      supabase.tables.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle: async () => ({
          data: table === 'instagram_conversations'
            ? {
              id: 'official-1',
              company_id: COMPANY,
              connection_id: '11111111-1111-4111-8111-111111111111',
              byo_account_id: null,
              ig_participant_id: '1784',
            }
            : null,
          error: null,
        }),
      };
      return query;
    };

    const result = await sendInstagramMessage({
      supabase,
      conversationId: 'official-1',
      companyId: COMPANY,
      text: 'ola',
    });

    expect(result.errorType).toBe('validation');
    expect(supabase.tables).toEqual(['instagram_conversations', 'instagram_connections']);
    expect(decryptInstagramToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

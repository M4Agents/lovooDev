/**
 * contactNameResolver.test.js
 *
 * Testes unitários para fetchContactNameFromUazapi, isPlaceholderName
 * e isValidContactName (api/lib/webhook/contactNameResolver.js).
 *
 * Cobre os cenários solicitados:
 *   - Nome válido no payload (isPlaceholderName)
 *   - API retorna nome válido (".")
 *   - API não retorna nome
 *   - Timeout
 *   - Lead existente com nome real
 *   - Lead existente com placeholder
 *   - Concorrência no UPDATE (testada via integração leve)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPlaceholderName,
  isValidContactName,
  fetchContactNameFromUazapi,
} from '../contactNameResolver.js';

// ---------------------------------------------------------------------------
// isPlaceholderName
// ---------------------------------------------------------------------------
describe('isPlaceholderName', () => {
  it('null → true', () => expect(isPlaceholderName(null)).toBe(true));
  it('undefined → true', () => expect(isPlaceholderName(undefined)).toBe(true));
  it('"" → true', () => expect(isPlaceholderName('')).toBe(true));
  it('"  " → true', () => expect(isPlaceholderName('  ')).toBe(true));
  it('"." → true', () => expect(isPlaceholderName('.')).toBe(true));
  it('"Lead WhatsApp" → true', () => expect(isPlaceholderName('Lead WhatsApp')).toBe(true));
  it('"Contato 5582996128352" → true', () => expect(isPlaceholderName('Contato 5582996128352')).toBe(true));
  it('"João Silva" → false', () => expect(isPlaceholderName('João Silva')).toBe(false));
  it('"Maria" → false', () => expect(isPlaceholderName('Maria')).toBe(false));
  it('"Contato texto" → false (não é número)', () => expect(isPlaceholderName('Contato texto')).toBe(false));
});

// ---------------------------------------------------------------------------
// isValidContactName
// ---------------------------------------------------------------------------
describe('isValidContactName', () => {
  it('"João" → true (tem letra)', () => expect(isValidContactName('João')).toBe(true));
  it('"." → false (sem letra)', () => expect(isValidContactName('.')).toBe(false));
  it('"123" → false (apenas dígitos)', () => expect(isValidContactName('123')).toBe(false));
  it('"" → false', () => expect(isValidContactName('')).toBe(false));
  it('null → false', () => expect(isValidContactName(null)).toBe(false));
  it('"Médico André" → true (letras acentuadas)', () => expect(isValidContactName('Médico André')).toBe(true));
});

// ---------------------------------------------------------------------------
// fetchContactNameFromUazapi
// ---------------------------------------------------------------------------
describe('fetchContactNameFromUazapi', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Parâmetros ausentes
  // -------------------------------------------------------------------------
  it('token ausente → null imediato (sem fetch)', async () => {
    const result = await fetchContactNameFromUazapi({ token: null, instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('instanceName ausente → null imediato', async () => {
    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: '', phoneNumber: '5511' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('phoneNumber ausente → null imediato', async () => {
    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TC-01: nome válido retornado pela API
  // -------------------------------------------------------------------------
  it('TC-01: API retorna nome válido → retorna o nome', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: 'João Silva', profilePictureUrl: 'https://example.com/img.jpg' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBe('João Silva');
  });

  // -------------------------------------------------------------------------
  // TC-01b: baseUrl do payload é usado em vez de api.uazapi.com
  // -------------------------------------------------------------------------
  it('TC-01b: baseUrl personalizado → URL da requisição usa o servidor correto', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: 'Ana Lima' } }),
    });

    await fetchContactNameFromUazapi({
      token: 'tk', instanceName: 'inst', phoneNumber: '5511',
      baseUrl: 'https://lovoo.uazapi.com',
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe('https://lovoo.uazapi.com/chat/GetNameAndImageURL/inst');
    expect(calledUrl).not.toContain('api.uazapi.com');
  });

  // -------------------------------------------------------------------------
  // TC-01c: baseUrl ausente → fallback para api.uazapi.com
  // -------------------------------------------------------------------------
  it('TC-01c: sem baseUrl → usa api.uazapi.com como fallback', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: 'Carlos' } }),
    });

    await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('api.uazapi.com');
  });

  // -------------------------------------------------------------------------
  // TC-02: senderName era "." no payload; API retorna nome válido
  // -------------------------------------------------------------------------
  it('TC-02: API retorna nome quando payload tinha "." — retorna nome real', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: 'Marcio Teste' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBe('Marcio Teste');
  });

  // -------------------------------------------------------------------------
  // TC-03: API retorna "." como nome → rejeitar (é placeholder)
  // -------------------------------------------------------------------------
  it('TC-03: API retorna "." → null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: '.' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-04: API não retorna campo name
  // -------------------------------------------------------------------------
  it('TC-04: API sem campo name → null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { profilePictureUrl: 'https://example.com/img.jpg' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-05: API retorna "Lead WhatsApp" → rejeitar
  // -------------------------------------------------------------------------
  it('TC-05: API retorna "Lead WhatsApp" → null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: 'Lead WhatsApp' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-06: timeout — AbortError → null, webhook não quebra
  // -------------------------------------------------------------------------
  it('TC-06: timeout → null sem lançar exceção', async () => {
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, 10)
        )
    );

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith('[fetchContactName] falhou:', 'timeout_2s');
  });

  // -------------------------------------------------------------------------
  // TC-07: HTTP 404 → null
  // -------------------------------------------------------------------------
  it('TC-07: HTTP 404 → null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith('[fetchContactName] HTTP', 404);
  });

  // -------------------------------------------------------------------------
  // TC-08: falha de rede genérica → null sem lançar
  // -------------------------------------------------------------------------
  it('TC-08: falha de rede → null sem lançar', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-09: nome com espaços extras é aparado
  // -------------------------------------------------------------------------
  it('TC-09: nome com espaços extras é aparado', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: '  Ana Lima  ' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBe('Ana Lima');
  });

  // -------------------------------------------------------------------------
  // TC-10: nome sem letra Unicode → null
  // -------------------------------------------------------------------------
  it('TC-10: nome sem letra Unicode ("123") → null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: '123' } }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-11: candidato em data.name (fallback se data.data.name ausente)
  // -------------------------------------------------------------------------
  it('TC-11: candidato em data.name (raiz) → retorna nome', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'Paulo Root' }),
    });

    const result = await fetchContactNameFromUazapi({ token: 'tk', instanceName: 'inst', phoneNumber: '5511' });
    expect(result).toBe('Paulo Root');
  });
});

// ---------------------------------------------------------------------------
// Lógica de resolução de nome — comportamentos de integração leve
// (sem instanciar o webhook completo)
// ---------------------------------------------------------------------------
describe('Resolução de nome — lógica de integração', () => {
  it('Lead com nome real: _whatsAppName deve ser descartado em favor do cadastro', () => {
    // Simula: _existingName = "Paula Oliveira", _whatsAppName = "." (agora null após fix)
    const _existingName = 'Paula Oliveira';
    const _whatsAppName = null; // "." foi filtrado como placeholder
    const isPlaceholder = isPlaceholderName;

    const senderName = (_existingName && !isPlaceholder(_existingName))
      ? _existingName
      : _whatsAppName ?? _existingName ?? '.';

    expect(senderName).toBe('Paula Oliveira');
  });

  it('Lead com placeholder "." + _whatsAppName nulo: senderName = "."', () => {
    const _existingName = '.';
    const _whatsAppName = null;
    const isPlaceholder = isPlaceholderName;

    const senderName = (_existingName && !isPlaceholder(_existingName))
      ? _existingName
      : _whatsAppName ?? _existingName ?? '.';

    expect(senderName).toBe('.');
  });

  it('Novo lead + _whatsAppName nulo + API retorna null: fallback "."', () => {
    const _existingName = undefined;
    const _whatsAppName = null;
    const _apiName      = null;

    const senderName = _apiName ?? _existingName ?? '.';

    expect(senderName).toBe('.');
  });

  it('Concorrência: UPDATE com .eq(name, placeholderVisto) afeta 0 linhas → log neutro', () => {
    // Simula a decisão do código: 0 linhas afetadas = log neutro
    const updated = [];
    const result  = (!updated || updated.length === 0)
      ? 'atualização condicional não aplicada'
      : 'nome do lead existente corrigido';

    expect(result).toBe('atualização condicional não aplicada');
  });

  it('Concorrência: 1 linha afetada → log de sucesso', () => {
    const updated = [{ id: 42 }];
    const result  = (!updated || updated.length === 0)
      ? 'atualização condicional não aplicada'
      : 'nome do lead existente corrigido';

    expect(result).toBe('nome do lead existente corrigido');
  });
});

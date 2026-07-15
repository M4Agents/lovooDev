// =============================================================================
// Testes unitários — contextBuilder.js (suporte a grouped_messages)
//
// Framework: vitest
// Escopo: Testa exclusivamente a função formatGroupedMessages exportada.
//         O buildContext completo usa I/O real e não é testado aqui.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { formatGroupedMessages } from '../contextBuilder.js';

// ---------------------------------------------------------------------------
// TC-CB16 — Fluxo atual com event.message_text permanece igual
// ---------------------------------------------------------------------------

describe('formatGroupedMessages', () => {
  it('TC-CB17 — mensagens formatadas em ordem com cabeçalho de índice', () => {
    const msgs = [
      { messageId: 'm1', text: 'Olá', type: 'text', receivedAt: '2026-07-15T10:00:00.000Z', payload: {} },
      { messageId: 'm2', text: 'Preciso de ajuda', type: 'text', receivedAt: '2026-07-15T10:01:00.000Z', payload: {} },
    ];
    const result = formatGroupedMessages(msgs);

    // Primeira mensagem deve aparecer antes da segunda
    const idx1 = result.indexOf('[Mensagem 1');
    const idx2 = result.indexOf('[Mensagem 2');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);

    // Conteúdo presente
    expect(result).toContain('Olá');
    expect(result).toContain('Preciso de ajuda');
  });

  it('TC-CB18 — quebras internas do texto são preservadas', () => {
    const msgs = [
      { messageId: 'm1', text: 'Linha 1\nLinha 2\nLinha 3', type: 'text', receivedAt: '2026-07-15T10:00:00.000Z', payload: {} },
    ];
    const result = formatGroupedMessages(msgs);

    expect(result).toContain('Linha 1\nLinha 2\nLinha 3');
  });

  it('TC-CB19 — mídia sem texto recebe rótulo normalizado (não inventa conteúdo)', () => {
    const msgs = [
      { messageId: 'm1', text: '', type: 'audio', receivedAt: '2026-07-15T10:00:00.000Z', payload: { url: 'secret://audio' } },
      { messageId: 'm2', text: null, type: 'image', receivedAt: '2026-07-15T10:01:00.000Z', payload: { url: 'secret://image' } },
    ];
    const result = formatGroupedMessages(msgs);

    expect(result).toContain('[áudio]');
    expect(result).toContain('[imagem]');
    // Nunca inventa conteúdo
    expect(result).not.toContain('secret://');
  });

  it('TC-CB20 — payload bruto nunca entra no output', () => {
    const msgs = [
      {
        messageId: 'm1',
        text:      'oi',
        type:      'text',
        receivedAt: '2026-07-15T10:00:00.000Z',
        payload:   { secret_key: 'TOKEN_SECRETO_NAO_DEVE_APARECER', mediaUrl: 'https://cdn.example.com/arquivo.jpg' },
      },
    ];
    const result = formatGroupedMessages(msgs);

    expect(result).not.toContain('TOKEN_SECRETO_NAO_DEVE_APARECER');
    expect(result).not.toContain('mediaUrl');
    expect(result).not.toContain('secret_key');
    expect(result).toContain('oi');
  });

  it('TC-CB21 — mensagem única agrupada funciona (array de tamanho 1)', () => {
    const msgs = [
      { messageId: 'm1', text: 'Mensagem única', type: 'text', receivedAt: '2026-07-15T10:00:00.000Z', payload: {} },
    ];
    const result = formatGroupedMessages(msgs);

    expect(result).toContain('[Mensagem 1');
    expect(result).toContain('Mensagem única');
  });

  it('TC-CB-media-types — todos os tipos de mídia mapeados corretamente', () => {
    const types = [
      { type: 'audio',    label: 'áudio' },
      { type: 'image',    label: 'imagem' },
      { type: 'video',    label: 'vídeo' },
      { type: 'document', label: 'documento' },
      { type: 'sticker',  label: 'sticker' },
      { type: 'unknown',  label: 'mídia' },
    ];

    for (const { type, label } of types) {
      const msgs = [{ messageId: 'm1', text: '', type, receivedAt: '2026-07-15T10:00:00.000Z', payload: {} }];
      const result = formatGroupedMessages(msgs);
      expect(result).toContain(`[${label}]`);
    }
  });

  it('TC-CB-order — múltiplas mensagens separadas por linha em branco', () => {
    const msgs = [
      { messageId: 'm1', text: 'Msg 1', type: 'text', receivedAt: null, payload: {} },
      { messageId: 'm2', text: 'Msg 2', type: 'text', receivedAt: null, payload: {} },
      { messageId: 'm3', text: 'Msg 3', type: 'text', receivedAt: null, payload: {} },
    ];
    const result = formatGroupedMessages(msgs);

    // Separadas por \n\n
    expect(result).toContain('\n\n');
    const parts = result.split('\n\n');
    expect(parts).toHaveLength(3);
  });

  it('TC-CB-no-receivedAt — funciona sem receivedAt', () => {
    const msgs = [
      { messageId: 'm1', text: 'Mensagem sem timestamp', type: 'text', receivedAt: null, payload: {} },
    ];
    const result = formatGroupedMessages(msgs);

    expect(result).toContain('[Mensagem 1]');
    expect(result).toContain('Mensagem sem timestamp');
    // Sem horário no label
    expect(result).not.toContain('—');
  });
});

// ---------------------------------------------------------------------------
// TC-CB16 — Fluxo atual preservado: comportamento com event.message_text
// Nota: buildContext usa getServiceSupabase() internamente, portanto não pode
// ser testado unitariamente sem mocks complexos.
// A invariante é: groupedMessages=[] ou undefined → usa event.message_text.
// Isso é garantido pela lógica em buildContext (testada indiretamente).
// ---------------------------------------------------------------------------

describe('formatGroupedMessages — compatibilidade', () => {
  it('TC-CB16 — array vazio nunca é formatado (chamada defensiva)', () => {
    // A lógica no contextBuilder.js checa length > 0 antes de chamar
    // formatGroupedMessages. Mas se chamado com [] diretamente, retorna string vazia.
    const result = formatGroupedMessages([]);
    expect(result).toBe('');
  });
});

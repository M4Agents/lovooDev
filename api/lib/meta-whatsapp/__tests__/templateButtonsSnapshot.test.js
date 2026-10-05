import { describe, it, expect } from 'vitest';
import {
  buildTemplateButtonsSnapshot,
  sanitizeTemplateButtonsSnapshot,
} from '../templateButtonsSnapshot.js';

function qrAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

function urlAnalysis(overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons: [{
      index: 0,
      type: 'URL',
      text: 'Abrir teste',
      url: 'https://example.com/test/{{1}}',
      url_kind: 'dynamic',
    }],
    ...overrides,
  };
}

describe('buildTemplateButtonsSnapshot — QUICK_REPLY', () => {
  it('1 QR válido → wrapper v1 sem payload', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
      parameterValues: { body: {} },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
  });

  it('múltiplos QR válidos preservam ordem e text original', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: ' Sim ' },
        { index: 1, type: 'QUICK_REPLY', text: 'Não' },
      ]),
    });
    expect(snap.buttons).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: ' Sim ' },
      { type: 'QUICK_REPLY', index: 1, text: 'Não' },
    ]);
  });

  it('não copia payload se o analysis o trouxer', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{
        index: 0, type: 'QUICK_REPLY', text: 'Sim',
        payload: 'lovoo:qr:v1:hello:en:0',
      }]),
    });
    expect(snap.buttons[0]).toEqual({ type: 'QUICK_REPLY', index: 0, text: 'Sim' });
    expect(snap.buttons[0]).not.toHaveProperty('payload');
  });
});

describe('buildTemplateButtonsSnapshot — URL dynamic', () => {
  it('dynamic válido → href = prefix + suffix original', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': '12345' } },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{
        type: 'URL',
        index: 0,
        text: 'Abrir teste',
        href: 'https://example.com/test/12345',
      }],
    });
    expect(JSON.stringify(snap)).not.toContain('{{1}}');
    expect(JSON.stringify(snap)).not.toContain('parameter_values');
    expect(snap.buttons[0]).not.toHaveProperty('url');
    expect(snap.buttons[0]).not.toHaveProperty('url_kind');
  });

  it('suffix com espaços laterais é preservado no href', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': ' 12345 ' } },
    });
    expect(snap.buttons[0].href).toBe('https://example.com/test/ 12345 ');
  });
});

describe('buildTemplateButtonsSnapshot — NULL', () => {
  it.each([
    ['unsupported', { analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }], { supported: false }) }],
    ['empty buttons', { analysis: qrAnalysis([]) }],
    ['missing buttons', { analysis: { supported: true, headerMediaFormat: null, parameter_format: 'POSITIONAL' } }],
    ['>10 QR', {
      analysis: qrAnalysis(
        Array.from({ length: 11 }, (_, i) => ({ index: i, type: 'QUICK_REPLY', text: `B${i}` })),
      ),
    }],
    ['mixed QR/URL', {
      analysis: qrAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'URL', text: 'Site', url: 'https://example.com/test/{{1}}' },
      ]),
    }],
    ['static URL', {
      analysis: urlAnalysis({
        buttons: [{ index: 0, type: 'URL', text: 'Site', url: 'https://example.com/loja', url_kind: 'static' }],
      }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['NAMED', {
      analysis: urlAnalysis({ parameter_format: 'NAMED' }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['URL index != 0', {
      analysis: urlAnalysis({
        buttons: [{
          index: 1, type: 'URL', text: 'Abrir teste',
          url: 'https://example.com/test/{{1}}', url_kind: 'dynamic',
        }],
      }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['placeholder não final', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'https://example.com/{{1}}/path', url_kind: 'dynamic',
        }],
      }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['múltiplos placeholders', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'https://example.com/{{1}}{{1}}', url_kind: 'dynamic',
        }],
      }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['missing suffix', {
      analysis: urlAnalysis(),
      parameterValues: { body: {} },
    }],
    ['whitespace-only suffix', {
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': '   ' } },
    }],
    ['extra key em url', {
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': '12345', '1': 'x' } },
    }],
    ['javascript', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'javascript:alert(1)//{{1}}',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'x' } },
    }],
    ['data', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'data:text/html,hi{{1}}',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'x' } },
    }],
    ['blob', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'blob:https://example.com/{{1}}',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'abc' } },
    }],
    ['credentials', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'https://user:pass@example.com/{{1}}',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'x' } },
    }],
    ['malformed URL', {
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir teste',
          url: 'not a url{{1}}',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'x' } },
    }],
    ['href > 2048', {
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': 'x'.repeat(2100) } },
    }],
    ['invalid QR text', {
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: '   ' }]),
    }],
    ['invalid QR index', {
      analysis: qrAnalysis([{ index: 10, type: 'QUICK_REPLY', text: 'Sim' }]),
    }],
    ['media + URL', {
      analysis: urlAnalysis({ headerMediaFormat: 'IMAGE' }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['PHONE_NUMBER', {
      analysis: {
        supported: true,
        parameter_format: 'POSITIONAL',
        headerMediaFormat: null,
        buttons: [{ index: 0, type: 'PHONE_NUMBER', text: 'Ligar' }],
      },
    }],
  ])('%s → null', (_label, input) => {
    expect(buildTemplateButtonsSnapshot(input)).toBeNull();
  });

  it('não lança com input arbitrário', () => {
    expect(buildTemplateButtonsSnapshot(null)).toBeNull();
    expect(buildTemplateButtonsSnapshot()).toBeNull();
    expect(buildTemplateButtonsSnapshot({ analysis: 'x' })).toBeNull();
  });
});

describe('sanitizeTemplateButtonsSnapshot', () => {
  it('QR v1 válido → array whitelist', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim', extra: 'nope' }],
    })).toEqual([{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }]);
  });

  it('URL v1 válido → array whitelist sem extras', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Abrir teste',
        href: 'https://example.com/test/12345',
        url_kind: 'dynamic',
        suffix: '12345',
      }],
    })).toEqual([{
      type: 'URL', index: 0, text: 'Abrir teste',
      href: 'https://example.com/test/12345',
    }]);
  });

  it.each([
    ['v2', { v: 2, buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }] }],
    ['array cru', [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }]],
    ['null', null],
    ['buttons vazio', { v: 1, buttons: [] }],
    ['>10', {
      v: 1,
      buttons: Array.from({ length: 11 }, (_, i) => ({
        type: 'QUICK_REPLY', index: 0, text: `B${i}`,
      })),
    }],
  ])('%s → null', (_label, raw) => {
    expect(sanitizeTemplateButtonsSnapshot(raw)).toBeNull();
  });

  it('unknown dropped; se restar QR, devolve só o QR', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'FLOW', index: 0, text: 'X' },
        { type: 'QUICK_REPLY', index: 1, text: 'Ok' },
      ],
    })).toEqual([{ type: 'QUICK_REPLY', index: 1, text: 'Ok' }]);
  });

  it('QR com payload → item inteiro dropped', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{
        type: 'QUICK_REPLY', index: 0, text: 'Sim',
        payload: 'lovoo:qr:v1:hello:en:0',
      }],
    })).toBeNull();
  });

  it('unsafe href dropped', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Abrir',
        href: 'javascript:alert(1)',
      }],
    })).toBeNull();
  });

  it('todos dropped → null', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim', payload: 'x' },
        { type: 'URL', index: 0, text: 'A', href: 'data:text/html,x' },
      ],
    })).toBeNull();
  });

  it('não lança com shapes arbitrários', () => {
    expect(() => sanitizeTemplateButtonsSnapshot(undefined)).not.toThrow();
    expect(() => sanitizeTemplateButtonsSnapshot(42)).not.toThrow();
    expect(() => sanitizeTemplateButtonsSnapshot('v1')).not.toThrow();
    expect(sanitizeTemplateButtonsSnapshot(undefined)).toBeNull();
  });
});

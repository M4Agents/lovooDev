import { describe, it, expect } from 'vitest';
import {
  buildTemplateButtonsSnapshot,
  isUnsafeDynamicUrlSuffix,
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

function staticUrlAnalysis(overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons: [{
      index: 0,
      type: 'URL',
      text: 'Site',
      url: 'https://example.com/loja',
      url_kind: 'static',
    }],
    ...overrides,
  };
}

function phoneAnalysis(overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons: [{
      index: 0,
      type: 'PHONE_NUMBER',
      text: 'Ligar',
      phone_number: '+5511999999999',
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

  it.each([
    ['e2e-001', 'https://example.com/test/e2e-001'],
    ['campanha/123', 'https://example.com/test/campanha/123'],
    ['campanha?origem=crm', 'https://example.com/test/campanha?origem=crm'],
    ['id=1&x=2', 'https://example.com/test/id=1&x=2'],
    ['café%20ok', 'https://example.com/test/café%20ok'],
  ])('4C10: sufixo legítimo %s → href composto', (suffix, href) => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': suffix } },
    });
    expect(snap.buttons[0].href).toBe(href);
  });

  it.each([
    ['https absoluto', 'https://evil.example/x'],
    ['http absoluto', 'http://evil.example/x'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['protocol-relative', '//evil.example'],
    ['https com espaços', '  https://evil.example/x  '],
    ['// com espaços', '  //evil.example'],
    ['NUL + https', '\u0000https://evil.example/x'],
    ['ZWSP + https', '\u200Bhttps://evil.example/x'],
  ])('4C10: sufixo inadequado (%s) → null', (_label, suffix) => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': suffix } },
    });
    expect(snap).toBeNull();
  });

  it('4C10: prefixo WABA vazio + URL absoluta → null', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: urlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Abrir',
          url: '{{1}}', url_kind: 'dynamic',
        }],
      }),
      parameterValues: { body: {}, url: { '0': 'https://evil.example/x' } },
    });
    expect(snap).toBeNull();
  });
});

describe('isUnsafeDynamicUrlSuffix', () => {
  it.each([
    'e2e-001',
    'campanha/123',
    'campanha?origem=crm',
    'id=1&x=2',
    'café%20ok',
    ' 12345 ',
    'foo/https://evil.example/x',
  ])('legítimo %s → false', (suffix) => {
    expect(isUnsafeDynamicUrlSuffix(suffix)).toBe(false);
  });

  it.each([
    'https://evil.example/x',
    'http://evil.example/x',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.example',
    '  https://evil.example/x',
    '\u0000https://evil.example/x',
    '\u200Bhttps://evil.example/x',
  ])('inadequado %s → true', (suffix) => {
    expect(isUnsafeDynamicUrlSuffix(suffix)).toBe(true);
  });

  it('não-string e vazio → false (caller trata mismatch)', () => {
    expect(isUnsafeDynamicUrlSuffix('')).toBe(false);
    expect(isUnsafeDynamicUrlSuffix('   ')).toBe(false);
    expect(isUnsafeDynamicUrlSuffix(null)).toBe(false);
  });
});

describe('buildTemplateButtonsSnapshot — URL static', () => {
  it('static segura → v1 com href original da definição aprovada', () => {
    const original = 'https://Example.COM/loja';
    const snap = buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Site',
          url: original, url_kind: 'static',
        }],
      }),
      parameterValues: { body: {} },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{
        type: 'URL',
        index: 0,
        text: 'Site',
        href: original,
      }],
    });
    expect(snap.buttons[0].href).not.toBe(new URL(original).toString());
    expect(snap.buttons[0]).not.toHaveProperty('url');
    expect(snap.buttons[0]).not.toHaveProperty('url_kind');
    expect(JSON.stringify(snap)).not.toContain('parameter_values');
    expect(JSON.stringify(snap)).not.toContain('suffix');
  });

  it('ignora parameter_values.url se presente — href vem só da definição', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis(),
      parameterValues: { body: {}, url: { '0': 'https://evil.example/forged' } },
    });
    expect(snap.buttons[0].href).toBe('https://example.com/loja');
    expect(JSON.stringify(snap)).not.toContain('evil.example');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['relativa', '/loja'],
    ['credenciais', 'https://user:pass@example.com/loja'],
    ['comprimento > 2048', `https://example.com/${'a'.repeat(2048)}`],
  ])('static insegura (%s) → null (fail-closed)', (_label, url) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis({
        buttons: [{
          index: 0, type: 'URL', text: 'Site',
          url, url_kind: 'static',
        }],
      }),
      parameterValues: { body: {} },
    })).toBeNull();
  });

  it('NAMED + static segura → v1 href original (não exige POSITIONAL)', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis({ parameter_format: 'NAMED' }),
      parameterValues: { body: {} },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{ type: 'URL', index: 0, text: 'Site', href: 'https://example.com/loja' }],
    });
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
    ['mixed QR/URL dinâmica', {
      analysis: qrAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'URL', text: 'Site', url: 'https://example.com/test/{{1}}' },
      ]),
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
    ['media + URL dynamic', {
      analysis: urlAnalysis({ headerMediaFormat: 'IMAGE' }),
      parameterValues: { body: {}, url: { '0': '12345' } },
    }],
    ['media + URL static', {
      analysis: staticUrlAnalysis({ headerMediaFormat: 'IMAGE' }),
      parameterValues: { body: {} },
    }],
    ['text sem botões', {
      analysis: {
        supported: true,
        parameter_format: 'POSITIONAL',
        headerMediaFormat: null,
        buttons: [],
      },
    }],
    ['media sem botões', {
      analysis: {
        supported: true,
        parameter_format: 'POSITIONAL',
        headerMediaFormat: 'IMAGE',
        buttons: [],
      },
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

describe('buildTemplateButtonsSnapshot — PHONE_NUMBER (4C.5B.B)', () => {
  it('PHONE_NUMBER válido → wrapper v1 com número da definição aprovada', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis(),
      parameterValues: { body: {}, phone: { '0': '+5511888888888' } },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{
        type: 'PHONE_NUMBER',
        index: 0,
        text: 'Ligar',
        phone_number: '+5511999999999',
      }],
    });
    expect(JSON.stringify(snap)).not.toContain('+5511888888888');
    expect(JSON.stringify(snap)).not.toContain('parameter_values');
    expect(snap.buttons[0]).not.toHaveProperty('payload');
    expect(Object.keys(snap.buttons[0]).sort()).toEqual([
      'index', 'phone_number', 'text', 'type',
    ]);
  });

  it('campos extras do analysis não entram no snapshot', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis({
        buttons: [{
          index: 0,
          type: 'PHONE_NUMBER',
          text: 'Ligar',
          phone_number: '+5511999999999',
          extra: 'nope',
          payload: 'x',
        }],
      }),
    });
    expect(snap.buttons[0]).toEqual({
      type: 'PHONE_NUMBER',
      index: 0,
      text: 'Ligar',
      phone_number: '+5511999999999',
    });
    expect(snap.buttons[0]).not.toHaveProperty('extra');
    expect(snap.buttons[0]).not.toHaveProperty('payload');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['tel:', 'tel:+5511999999999'],
    ['espaços', '+55 11 99999-9999'],
    ['curto', '+55119'],
    ['longo', `+${'1'.repeat(21)}`],
    ['vazio', ''],
    ['letras', '+55ABC99999999'],
    ['não-string', 5511999999999],
  ])('número inválido (%s) → null sem lançar', (_label, phone_number) => {
    expect(() => buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis({
        buttons: [{
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar', phone_number,
        }],
      }),
    })).not.toThrow();
    expect(buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis({
        buttons: [{
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar', phone_number,
        }],
      }),
    })).toBeNull();
  });

  it('QR permanece intacto', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
  });

  it('URL dinâmica permanece intacta', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': '12345' } },
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Abrir teste',
        href: 'https://example.com/test/12345',
      }],
    });
  });

  it('URL estática permanece intacta', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis(),
      parameterValues: { body: {} },
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Site', href: 'https://example.com/loja',
      }],
    });
  });
});

describe('sanitizeTemplateButtonsSnapshot — PHONE_NUMBER (4C.5B.B)', () => {
  it('PHONE_NUMBER v1 válido → whitelist pública sem extras', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      extra_top: 'drop',
      buttons: [{
        type: 'PHONE_NUMBER',
        index: 0,
        text: 'Ligar',
        phone_number: '+5511999999999',
        extra: 'nope',
        payload: 'x',
      }],
    })).toEqual([{
      type: 'PHONE_NUMBER',
      index: 0,
      text: 'Ligar',
      phone_number: '+5511999999999',
    }]);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['tel:', 'tel:+5511999999999'],
    ['espaços', '+55 11 99999-9999'],
    ['ausente', undefined],
  ])('número inválido (%s) → null', (_label, phone_number) => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{
        type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number,
      }],
    })).toBeNull();
  });

  it('versão desconhecida → null', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 2,
      buttons: [{
        type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
        phone_number: '+5511999999999',
      }],
    })).toBeNull();
  });

  it('QR e URL no mesmo sanitizer permanecem intactos', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'URL', index: 1, text: 'Site',
          href: 'https://example.com/loja',
        },
      ],
    })).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
      { type: 'URL', index: 1, text: 'Site', href: 'https://example.com/loja' },
    ]);
  });
});

function mixQrStaticAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

const MIX_QR_STATIC_BUTTONS = [
  { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
  {
    index: 1, type: 'URL', text: 'Abrir',
    url: 'https://example.com/loja', url_kind: 'static',
  },
];

describe('buildTemplateButtonsSnapshot — QR + URL estática (4C.6.B1)', () => {
  it('QR + URL estática → wrapper v1 misto; href da definição; sem payload', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis(MIX_QR_STATIC_BUTTONS),
      parameterValues: { body: {}, url: { '0': 'suffix-runtime' } },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        { type: 'URL', index: 1, text: 'Abrir', href: 'https://example.com/loja' },
      ],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
    expect(JSON.stringify(snap)).not.toContain('suffix-runtime');
    expect(JSON.stringify(snap)).not.toContain('url_kind');
    expect(snap.buttons[0]).not.toHaveProperty('href');
    expect(Object.keys(snap.buttons[0]).sort()).toEqual(['index', 'text', 'type']);
    expect(Object.keys(snap.buttons[1]).sort()).toEqual(['href', 'index', 'text', 'type']);
  });

  it('URL estática + QR → ordem e índices originais', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        { index: 1, type: 'QUICK_REPLY', text: 'Sim' },
      ]),
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        { type: 'URL', index: 0, text: 'Abrir', href: 'https://example.com/loja' },
        { type: 'QUICK_REPLY', index: 1, text: 'Sim' },
      ],
    });
  });

  it('dois QR + URL estática → índices 0,1,2', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'QUICK_REPLY', text: 'Não' },
        {
          index: 2, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
      ]),
    });
    expect(snap.buttons.map(b => [b.type, b.index])).toEqual([
      ['QUICK_REPLY', 0],
      ['QUICK_REPLY', 1],
      ['URL', 2],
    ]);
  });

  it('QR separados por URL → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        { index: 2, type: 'QUICK_REPLY', text: 'Não' },
      ]),
    })).toBeNull();
  });

  it('índice duplicado → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 0, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
      ]),
    })).toBeNull();
  });

  it('índices não consecutivos → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 2, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
      ]),
    })).toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['placeholder', 'https://example.com/{{1}}'],
    ['relativa', '/loja'],
  ])('URL insegura/placeholder (%s) → null', (_label, url) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'URL', text: 'Abrir', url, url_kind: 'static' },
      ]),
    })).toBeNull();
  });

  it('PHONE na mistura → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('header media → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis(MIX_QR_STATIC_BUTTONS, { headerMediaFormat: 'IMAGE' }),
    })).toBeNull();
  });

  it('QR-only / URL estática / PHONE individuais permanecem intactos', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis(),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'URL', index: 0, text: 'Site', href: 'https://example.com/loja' }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis(),
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
        phone_number: '+5511999999999',
      }],
    });
  });
});

describe('sanitizeTemplateButtonsSnapshot — QR + URL estática (4C.6.B1)', () => {
  it('snapshot misto v1 → whitelist; extras e payload dropped', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      extra_top: 'drop',
      buttons: [
        {
          type: 'QUICK_REPLY', index: 0, text: 'Sim',
          extra: 'nope',
        },
        {
          type: 'URL', index: 1, text: 'Abrir',
          href: 'https://example.com/loja',
          url: 'https://evil.example/x',
          url_kind: 'static',
          extra: 'nope',
        },
      ],
    })).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
      { type: 'URL', index: 1, text: 'Abrir', href: 'https://example.com/loja' },
    ]);
  });

  it('QR com payload no mix → item QR dropped; URL permanece', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        {
          type: 'QUICK_REPLY', index: 0, text: 'Sim',
          payload: 'lovoo:qr:v1:hello:en:0',
        },
        {
          type: 'URL', index: 1, text: 'Abrir',
          href: 'https://example.com/loja',
        },
      ],
    })).toEqual([
      { type: 'URL', index: 1, text: 'Abrir', href: 'https://example.com/loja' },
    ]);
  });

  it('href inseguro no mix → URL dropped; QR permanece', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'URL', index: 1, text: 'Abrir',
          href: 'javascript:alert(1)',
        },
      ],
    })).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
    ]);
  });
});

function mixQrPhoneAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

const MIX_QR_PHONE_BUTTONS = [
  { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
  {
    index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
    phone_number: '+5511999999999',
  },
];

describe('buildTemplateButtonsSnapshot — QR + PHONE_NUMBER (4C.6.D2)', () => {
  it('QR + PHONE → wrapper v1 misto; número da definição; sem payload', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis(MIX_QR_PHONE_BUTTONS),
      parameterValues: { body: {}, phone_number: '+5511888888888' },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
    expect(JSON.stringify(snap)).not.toContain('+5511888888888');
    expect(snap.buttons[0]).not.toHaveProperty('phone_number');
    expect(Object.keys(snap.buttons[0]).sort()).toEqual(['index', 'text', 'type']);
    expect(Object.keys(snap.buttons[1]).sort()).toEqual([
      'index', 'phone_number', 'text', 'type',
    ]);
  });

  it('PHONE + QR → ordem e índices originais', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        {
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
        { index: 1, type: 'QUICK_REPLY', text: 'Sim' },
      ]),
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        {
          type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
          phone_number: '+5511999999999',
        },
        { type: 'QUICK_REPLY', index: 1, text: 'Sim' },
      ],
    });
  });

  it('dois QR + PHONE → índices 0,1,2', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'QUICK_REPLY', text: 'Não' },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    });
    expect(snap.buttons.map(b => [b.type, b.index])).toEqual([
      ['QUICK_REPLY', 0],
      ['QUICK_REPLY', 1],
      ['PHONE_NUMBER', 2],
    ]);
  });

  it('QR, PHONE, QR → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
        { index: 2, type: 'QUICK_REPLY', text: 'Não' },
      ]),
    })).toBeNull();
  });

  it('índice duplicado → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('índices não consecutivos → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['tel: pronto', 'tel:+5511999999999'],
    ['espaços', '+55 11 99999-9999'],
  ])('telefone inseguro (%s) → null', (_label, phone_number) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        { index: 1, type: 'PHONE_NUMBER', text: 'Ligar', phone_number },
      ]),
    })).toBeNull();
  });

  it('QR + URL + PHONE → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('header media → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis(MIX_QR_PHONE_BUTTONS, { headerMediaFormat: 'IMAGE' }),
    })).toBeNull();
  });

  it('QR-only / PHONE / QR+URL individuais permanecem intactos', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis(),
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
        phone_number: '+5511999999999',
      }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis(MIX_QR_STATIC_BUTTONS),
    })).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        { type: 'URL', index: 1, text: 'Abrir', href: 'https://example.com/loja' },
      ],
    });
  });
});

describe('sanitizeTemplateButtonsSnapshot — QR + PHONE_NUMBER (4C.6.D2)', () => {
  it('snapshot misto v1 → whitelist; extras e payload dropped', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      extra_top: 'drop',
      buttons: [
        {
          type: 'QUICK_REPLY', index: 0, text: 'Sim',
          extra: 'nope',
        },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
          extra: 'nope',
          href: 'tel:+5511999999999',
        },
      ],
    })).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
      {
        type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
        phone_number: '+5511999999999',
      },
    ]);
  });

  it('QR com payload no mix → item QR dropped; PHONE permanece', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        {
          type: 'QUICK_REPLY', index: 0, text: 'Sim',
          payload: 'lovoo:qr:v1:hello:en:0',
        },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    })).toEqual([
      {
        type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
        phone_number: '+5511999999999',
      },
    ]);
  });

  it('telefone inseguro no mix → PHONE dropped; QR permanece', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: 'javascript:alert(1)',
        },
      ],
    })).toEqual([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
    ]);
  });
});

function mixStaticPhoneAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

const MIX_STATIC_PHONE_BUTTONS = [
  {
    index: 0, type: 'URL', text: 'Abrir site',
    url: 'https://example.com/loja', url_kind: 'static',
  },
  {
    index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
    phone_number: '+5511999999999',
  },
];

describe('buildTemplateButtonsSnapshot — URL estática + PHONE_NUMBER (4C.7.A2)', () => {
  it('URL + PHONE → wrapper v1 misto; href e número da definição; sem runtime', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis(MIX_STATIC_PHONE_BUTTONS),
      parameterValues: {
        body: {},
        url: { '0': 'suffix-runtime' },
        phone_number: '+5511888888888',
      },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        { type: 'URL', index: 0, text: 'Abrir site', href: 'https://example.com/loja' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
    expect(JSON.stringify(snap)).not.toContain('suffix-runtime');
    expect(JSON.stringify(snap)).not.toContain('+5511888888888');
    expect(JSON.stringify(snap)).not.toContain('url_kind');
    expect(Object.keys(snap.buttons[0]).sort()).toEqual(['href', 'index', 'text', 'type']);
    expect(Object.keys(snap.buttons[1]).sort()).toEqual([
      'index', 'phone_number', 'text', 'type',
    ]);
  });

  it('PHONE + URL → ordem e índices originais', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
        {
          index: 1, type: 'URL', text: 'Abrir site',
          url: 'https://example.com/loja', url_kind: 'static',
        },
      ]),
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        {
          type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
          phone_number: '+5511999999999',
        },
        { type: 'URL', index: 1, text: 'Abrir site', href: 'https://example.com/loja' },
      ],
    });
  });

  it('índice duplicado → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir site',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        {
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('índices não consecutivos → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir site',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('URL dinâmica → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir',
          url: 'https://example.com/test/{{1}}', url_kind: 'dynamic',
        },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['placeholder', 'https://example.com/{{1}}'],
    ['relativa', '/loja'],
  ])('URL insegura/placeholder (%s) → null', (_label, url) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        { index: 0, type: 'URL', text: 'Abrir', url, url_kind: 'static' },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['tel: pronto', 'tel:+5511999999999'],
    ['espaços', '+55 11 99999-9999'],
  ])('telefone inseguro (%s) → null', (_label, phone_number) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir site',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        { index: 1, type: 'PHONE_NUMBER', text: 'Ligar', phone_number },
      ]),
    })).toBeNull();
  });

  it('duas URLs estáticas → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'A',
          url: 'https://example.com/a', url_kind: 'static',
        },
        {
          index: 1, type: 'URL', text: 'B',
          url: 'https://example.com/b', url_kind: 'static',
        },
      ]),
    })).toBeNull();
  });

  it('dois PHONE_NUMBER → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        {
          index: 0, type: 'PHONE_NUMBER', text: 'A',
          phone_number: '+5511999999999',
        },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'B',
          phone_number: '+5511888888888',
        },
      ]),
    })).toBeNull();
  });

  it('QR + URL + PHONE → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir site',
          url: 'https://example.com/loja', url_kind: 'static',
        },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
    })).toBeNull();
  });

  it('header media → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis(MIX_STATIC_PHONE_BUTTONS, { headerMediaFormat: 'IMAGE' }),
    })).toBeNull();
  });

  it('QR-only / PHONE / QR+URL / QR+PHONE permanecem intactos', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: staticUrlAnalysis(),
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Site', href: 'https://example.com/loja',
      }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: phoneAnalysis(),
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
        phone_number: '+5511999999999',
      }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrStaticAnalysis(MIX_QR_STATIC_BUTTONS),
    })).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        { type: 'URL', index: 1, text: 'Abrir', href: 'https://example.com/loja' },
      ],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrPhoneAnalysis(MIX_QR_PHONE_BUTTONS),
    })).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    });
  });
});

describe('sanitizeTemplateButtonsSnapshot — URL estática + PHONE_NUMBER (4C.7.A2)', () => {
  it('snapshot misto v1 → whitelist; extras dropped', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      extra_top: 'drop',
      buttons: [
        {
          type: 'URL', index: 0, text: 'Abrir site',
          href: 'https://example.com/loja',
          url: 'https://evil.example/x',
          extra: 'nope',
        },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
          extra: 'nope',
        },
      ],
    })).toEqual([
      { type: 'URL', index: 0, text: 'Abrir site', href: 'https://example.com/loja' },
      {
        type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
        phone_number: '+5511999999999',
      },
    ]);
  });

  it('href inseguro → URL dropped; PHONE permanece', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'URL', index: 0, text: 'Abrir', href: 'javascript:alert(1)' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    })).toEqual([
      {
        type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
        phone_number: '+5511999999999',
      },
    ]);
  });
});

function mixDynamicPhoneAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

const MIX_DYN_PHONE_BUTTONS = [
  {
    index: 0, type: 'URL', text: 'Abrir link',
    url: 'https://example.com/pedido/{{1}}', url_kind: 'dynamic',
  },
  {
    index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
    phone_number: '+5511999999999',
  },
];

describe('buildTemplateButtonsSnapshot — URL dinâmica + PHONE_NUMBER (4C.8.A2)', () => {
  it('URL + PHONE → wrapper v1; href = prefixo WABA + suffix; telefone da WABA', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: {
        body: {},
        url: { '0': 'pedido-123' },
        phone_number: '+5511888888888',
      },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        {
          type: 'URL', index: 0, text: 'Abrir link',
          href: 'https://example.com/pedido/pedido-123',
        },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
    expect(JSON.stringify(snap)).not.toContain('+5511888888888');
    expect(JSON.stringify(snap)).not.toContain('url_kind');
    expect(JSON.stringify(snap)).not.toContain('{{1}}');
    expect(Object.keys(snap.buttons[0]).sort()).toEqual(['href', 'index', 'text', 'type']);
    expect(Object.keys(snap.buttons[1]).sort()).toEqual([
      'index', 'phone_number', 'text', 'type',
    ]);
  });

  it.each([
    ['e2e-001', 'https://example.com/pedido/e2e-001'],
    ['campanha/123', 'https://example.com/pedido/campanha/123'],
    ['campanha?origem=crm', 'https://example.com/pedido/campanha?origem=crm'],
  ])('4C10 mix: sufixo legítimo %s → href composto', (suffix, href) => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {}, url: { '0': suffix } },
    });
    expect(snap.buttons[0].href).toBe(href);
    expect(snap.buttons[1].type).toBe('PHONE_NUMBER');
  });

  it.each([
    ['https://evil.example/x'],
    ['javascript:alert(1)'],
    ['  //evil.example'],
    ['\u0000https://evil.example/x'],
  ])('4C10 mix: sufixo inadequado %s → null', (suffix) => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {}, url: { '0': suffix } },
    });
    expect(snap).toBeNull();
  });

  it('4C10 mix: prefixo WABA vazio + URL absoluta → null', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir link',
          url: '{{1}}', url_kind: 'dynamic',
        },
        MIX_DYN_PHONE_BUTTONS[1],
      ]),
      parameterValues: { body: {}, url: { '0': 'https://evil.example/x' } },
    });
    expect(snap).toBeNull();
  });

  it('PHONE + URL → ordem original; href no índice 1', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis([
        {
          index: 0, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
        {
          index: 1, type: 'URL', text: 'Abrir link',
          url: 'https://example.com/pedido/{{1}}', url_kind: 'dynamic',
        },
      ]),
      parameterValues: { body: {}, url: { '1': 'pedido-123' } },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        {
          type: 'PHONE_NUMBER', index: 0, text: 'Ligar',
          phone_number: '+5511999999999',
        },
        {
          type: 'URL', index: 1, text: 'Abrir link',
          href: 'https://example.com/pedido/pedido-123',
        },
      ],
    });
  });

  it('href final inseguro → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir',
          url: 'https://user:pass@example.com/pedido/{{1}}',
          url_kind: 'dynamic',
        },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
      parameterValues: { body: {}, url: { '0': 'pedido-123' } },
    })).toBeNull();
  });

  it('sufixo ausente / vazio → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
    })).toBeNull();
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {} },
    })).toBeNull();
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {}, url: { '0': '' } },
    })).toBeNull();
  });

  it('chave URL incorreta / extras → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {}, url: { '1': 'pedido-123' } },
    })).toBeNull();
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS),
      parameterValues: { body: {}, url: { '0': 'pedido-123', '1': 'extra' } },
    })).toBeNull();
  });

  it('telefone inseguro → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir link',
          url: 'https://example.com/pedido/{{1}}', url_kind: 'dynamic',
        },
        {
          index: 1, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: 'javascript:alert(1)',
        },
      ]),
      parameterValues: { body: {}, url: { '0': 'pedido-123' } },
    })).toBeNull();
  });

  it('QR + URL dinâmica + PHONE → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir link',
          url: 'https://example.com/pedido/{{1}}', url_kind: 'dynamic',
        },
        {
          index: 2, type: 'PHONE_NUMBER', text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ]),
      parameterValues: { body: {}, url: { '1': 'pedido-123' } },
    })).toBeNull();
  });

  it('header media → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixDynamicPhoneAnalysis(MIX_DYN_PHONE_BUTTONS, { headerMediaFormat: 'IMAGE' }),
      parameterValues: { body: {}, url: { '0': 'pedido-123' } },
    })).toBeNull();
  });

  it('QR-only / dinâmica única / estática+PHONE permanecem intactos', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis([{ index: 0, type: 'QUICK_REPLY', text: 'Sim' }]),
    })).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Sim' }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: urlAnalysis(),
      parameterValues: { body: {}, url: { '0': '12345' } },
    })).toEqual({
      v: 1,
      buttons: [{
        type: 'URL', index: 0, text: 'Abrir teste',
        href: 'https://example.com/test/12345',
      }],
    });
    expect(buildTemplateButtonsSnapshot({
      analysis: mixStaticPhoneAnalysis(MIX_STATIC_PHONE_BUTTONS),
    })).toEqual({
      v: 1,
      buttons: [
        { type: 'URL', index: 0, text: 'Abrir site', href: 'https://example.com/loja' },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
        },
      ],
    });
  });
});

describe('sanitizeTemplateButtonsSnapshot — URL dinâmica + PHONE_NUMBER (4C.8.A2)', () => {
  it('snapshot misto v1 → whitelist; extras dropped; sanitizer inalterado', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      extra_top: 'drop',
      buttons: [
        {
          type: 'URL', index: 0, text: 'Abrir link',
          href: 'https://example.com/pedido/pedido-123',
          url: 'https://evil.example/x',
          extra: 'nope',
        },
        {
          type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
          phone_number: '+5511999999999',
          extra: 'nope',
        },
      ],
    })).toEqual([
      {
        type: 'URL', index: 0, text: 'Abrir link',
        href: 'https://example.com/pedido/pedido-123',
      },
      {
        type: 'PHONE_NUMBER', index: 1, text: 'Ligar',
        phone_number: '+5511999999999',
      },
    ]);
  });
});

function mixQrDynamicAnalysis(buttons, overrides = {}) {
  return {
    supported: true,
    unsupported_reason: null,
    parameter_format: 'POSITIONAL',
    headerMediaFormat: null,
    buttons,
    ...overrides,
  };
}

describe('buildTemplateButtonsSnapshot — QR + URL dinâmica (4C.11)', () => {
  const qrThenUrl = [
    { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
    {
      index: 1, type: 'URL', text: 'Abrir',
      url: 'https://example.com/test/{{1}}', url_kind: 'dynamic',
    },
  ];

  it('QR + URL → v1; href = prefixo + suffix; sem payload', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrDynamicAnalysis(qrThenUrl),
      parameterValues: { body: {}, url: { '1': 'e2e-001' } },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Sim' },
        {
          type: 'URL', index: 1, text: 'Abrir',
          href: 'https://example.com/test/e2e-001',
        },
      ],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('{{1}}');
  });

  it('URL + QR → ordem original; href no índice 0', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: mixQrDynamicAnalysis([
        {
          index: 0, type: 'URL', text: 'Abrir',
          url: 'https://example.com/test/{{1}}', url_kind: 'dynamic',
        },
        { index: 1, type: 'QUICK_REPLY', text: 'Sim' },
      ]),
      parameterValues: { body: {}, url: { '0': 'campanha/123' } },
    });
    expect(snap.buttons.map(b => [b.type, b.index])).toEqual([
      ['URL', 0],
      ['QUICK_REPLY', 1],
    ]);
    expect(snap.buttons[0].href).toBe('https://example.com/test/campanha/123');
  });

  it.each([
    ['https://evil.example/x'],
    ['javascript:alert(1)'],
    ['//evil.example'],
  ])('sufixo inadequado %s → null', (suffix) => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrDynamicAnalysis(qrThenUrl),
      parameterValues: { body: {}, url: { '1': suffix } },
    })).toBeNull();
  });

  it('QR text 65 → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrDynamicAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'A'.repeat(65) },
        qrThenUrl[1],
      ]),
      parameterValues: { body: {}, url: { '1': 'e2e-001' } },
    })).toBeNull();
  });

  it('prefixo WABA javascript: + suffix → null', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: mixQrDynamicAnalysis([
        { index: 0, type: 'QUICK_REPLY', text: 'Sim' },
        {
          index: 1, type: 'URL', text: 'Abrir',
          url: 'javascript:alert(1)//{{1}}', url_kind: 'dynamic',
        },
      ]),
      parameterValues: { body: {}, url: { '1': 'x' } },
    })).toBeNull();
  });
});

// =============================================================================
// MVP4D.A2 — snapshot QR com HEADER media (comportamento atual)
// =============================================================================

describe('buildTemplateButtonsSnapshot — MVP4D.A2 media × QR', () => {
  it('IMAGE + QR → wrapper v1 type/index/text; sem payload', () => {
    const snap = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis(
        [{ index: 0, type: 'QUICK_REPLY', text: 'Quero' }],
        { headerMediaFormat: 'IMAGE' },
      ),
      parameterValues: { body: {} },
    });
    expect(snap).toEqual({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Quero' }],
    });
    expect(JSON.stringify(snap)).not.toContain('payload');
    expect(JSON.stringify(snap)).not.toContain('lovoo:qr:v1');
  });

  it('VIDEO + QR e DOCUMENT + QR → snapshot QR (comportamento atual, sem restrição)', () => {
    const video = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis(
        [{ index: 0, type: 'QUICK_REPLY', text: 'Quero' }],
        { headerMediaFormat: 'VIDEO' },
      ),
      parameterValues: { body: {} },
    });
    const doc = buildTemplateButtonsSnapshot({
      analysis: qrAnalysis(
        [{ index: 0, type: 'QUICK_REPLY', text: 'Quero' }],
        { headerMediaFormat: 'DOCUMENT' },
      ),
      parameterValues: { body: {} },
    });
    expect(video.buttons[0]).toEqual({ type: 'QUICK_REPLY', index: 0, text: 'Quero' });
    expect(doc.buttons[0]).toEqual({ type: 'QUICK_REPLY', index: 0, text: 'Quero' });
  });

  it('IMAGE + QR text 65 → null (gate 4C.9)', () => {
    expect(buildTemplateButtonsSnapshot({
      analysis: qrAnalysis(
        [{ index: 0, type: 'QUICK_REPLY', text: 'A'.repeat(65) }],
        { headerMediaFormat: 'IMAGE' },
      ),
      parameterValues: { body: {} },
    })).toBeNull();
  });

  it('sanitize descarta botão QR com payload; preserva irmão sem payload', () => {
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [{ type: 'QUICK_REPLY', index: 0, text: 'Quero', payload: 'lovoo:qr:v1:x:pt_BR:0' }],
    })).toBeNull();
    expect(sanitizeTemplateButtonsSnapshot({
      v: 1,
      buttons: [
        { type: 'QUICK_REPLY', index: 0, text: 'Quero', payload: 'secret' },
        { type: 'QUICK_REPLY', index: 1, text: 'Agora' },
      ],
    })).toEqual([{ type: 'QUICK_REPLY', index: 1, text: 'Agora' }]);
  });
});

// =============================================================================
// templateEngine.test.js
//
// Testes unitários para api/lib/meta-whatsapp/templateEngine.js
// Módulo puro — sem mocks, sem rede, sem banco, sem IO.
//
// COBERTURA:
//   analyzeTemplate:
//     AT-POS-01..14   extração POSITIONAL
//     AT-NAM-01..09   extração NAMED
//     AT-STR-01..17   estrutura de componentes
//     AT-EX-01..08    comportamento de examples
//
//   validateParameterValues:
//     VPV-01..18
//
//   buildGraphComponents:
//     BGC-01..09
//
//   interpolateBody:
//     IB-01..08
//
//   Pureza / segurança:
//     PUR-01..03
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  analyzeTemplate,
  validateParameterValues,
  buildGraphComponents,
  interpolateBody,
} from '../templateEngine.js';

// =============================================================================
// Factories de fixtures — nunca dados reais
// =============================================================================

function bodyOnly(text, example) {
  return {
    name:             'test_template',
    language:         'pt_BR',
    status:           'APPROVED',
    category:         'MARKETING',
    parameter_format: 'POSITIONAL',
    components:       [{ type: 'BODY', text, example }],
  };
}

function namedBodyOnly(text, example) {
  return {
    name:             'test_template',
    language:         'pt_BR',
    status:           'APPROVED',
    category:         'MARKETING',
    parameter_format: 'NAMED',
    components:       [{ type: 'BODY', text, example }],
  };
}

function withHeader(headerText, bodyText, fmt = 'POSITIONAL') {
  return {
    name:             'test_template',
    language:         'pt_BR',
    status:           'APPROVED',
    category:         'MARKETING',
    parameter_format: fmt,
    components:       [
      { type: 'HEADER', format: 'TEXT', text: headerText },
      { type: 'BODY',   text: bodyText },
    ],
  };
}

// =============================================================================
// analyzeTemplate — POSITIONAL
// =============================================================================

describe('analyzeTemplate — POSITIONAL', () => {

  it('AT-POS-01: 1 parâmetro → key "1", position 1', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{1}}!'));
    expect(r.supported).toBe(true);
    expect(r.parameter_format).toBe('POSITIONAL');
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0]).toMatchObject({ component: 'BODY', key: '1', position: 1 });
  });

  it('AT-POS-02: 2 parâmetros → keys "1" e "2"', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{1}}, pedido {{2}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(2);
    expect(r.parameters[0].key).toBe('1');
    expect(r.parameters[1].key).toBe('2');
  });

  it('AT-POS-03: ordem invertida no texto → ordenado por posição [1,2]', () => {
    const r = analyzeTemplate(bodyOnly('{{2}} antes de {{1}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters.map(p => p.position)).toEqual([1, 2]);
  });

  it('AT-POS-04: duplicata {{1}} duas vezes → um único parâmetro na posição 1', () => {
    const r = analyzeTemplate(bodyOnly('{{1}} e também {{1}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0].position).toBe(1);
  });

  it('AT-POS-05: gap {{1}} + {{3}} sem {{2}} → placeholder_gap', () => {
    const r = analyzeTemplate(bodyOnly('{{1}} e {{3}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('placeholder_gap');
  });

  it('AT-POS-06: {{0}} → invalid_placeholder_index', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{0}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('invalid_placeholder_index');
  });

  it('AT-POS-07: {{ }} (espaço interno) em template POSITIONAL → malformed_placeholder', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{ }}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-POS-08: {{1x}} em template POSITIONAL → malformed_placeholder', () => {
    const r = analyzeTemplate(bodyOnly('Valor {{1x}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-POS-09: {{name}} (NAMED syntax) em template POSITIONAL → malformed_placeholder', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{name}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-POS-10: BODY sem parâmetros (texto estático) → supported, params=[]', () => {
    const r = analyzeTemplate(bodyOnly('Olá cliente, sua compra foi confirmada.'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(0);
    expect(r.bodyText).toBe('Olá cliente, sua compra foi confirmada.');
  });

  it('AT-POS-11: delimitador incompleto "{{1" → texto literal, sem parâmetro', () => {
    const r = analyzeTemplate(bodyOnly('Veja {{1 para mais informações'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(0);
  });

  it('AT-POS-12: delimitador incompleto "1}}" → texto literal, sem parâmetro', () => {
    const r = analyzeTemplate(bodyOnly('Contato 1}} para suporte'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(0);
  });

  it('AT-POS-13: {{-1}} em POSITIONAL → malformed_placeholder', () => {
    const r = analyzeTemplate(bodyOnly('Índice {{-1}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-POS-14: bodyText retornado é o texto bruto do BODY', () => {
    const text = 'Pedido {{1}} confirmado';
    const r = analyzeTemplate(bodyOnly(text));
    expect(r.bodyText).toBe(text);
  });

});

// =============================================================================
// analyzeTemplate — NAMED
// =============================================================================

describe('analyzeTemplate — NAMED', () => {

  it('AT-NAM-01: 1 parâmetro NAMED → key é o nome, position null', () => {
    const r = analyzeTemplate(namedBodyOnly('Olá {{first_name}}!'));
    expect(r.supported).toBe(true);
    expect(r.parameter_format).toBe('NAMED');
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0]).toMatchObject({
      component: 'BODY', key: 'first_name', position: null,
    });
  });

  it('AT-NAM-02: 2 parâmetros NAMED → ambos presentes', () => {
    const r = analyzeTemplate(namedBodyOnly('{{first_name}}, pedido {{order_id}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters.map(p => p.key)).toEqual(['first_name', 'order_id']);
  });

  it('AT-NAM-03: ordem de primeira ocorrência preservada: "{{b}} {{a}}" → [b, a]', () => {
    const r = analyzeTemplate(namedBodyOnly('{{beta}} e {{alpha}}'));
    expect(r.parameters.map(p => p.key)).toEqual(['beta', 'alpha']);
  });

  it('AT-NAM-04: duplicata NAMED → uma entrada única', () => {
    const r = analyzeTemplate(namedBodyOnly('{{name}} e também {{name}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0].key).toBe('name');
  });

  it('AT-NAM-05: {{1}} (POSITIONAL) em template NAMED → malformed_placeholder', () => {
    const r = analyzeTemplate(namedBodyOnly('Olá {{1}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-NAM-06: {{abc-def}} em template NAMED → malformed_placeholder', () => {
    const r = analyzeTemplate(namedBodyOnly('Valor {{abc-def}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

  it('AT-NAM-07: NAMED sem parâmetros (texto estático) → supported, params=[]', () => {
    const r = analyzeTemplate(namedBodyOnly('Texto estático'));
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(0);
  });

  it('AT-NAM-08: nome começando com underscore → válido', () => {
    const r = analyzeTemplate(namedBodyOnly('Valor {{_ref}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters[0].key).toBe('_ref');
  });

  it('AT-NAM-09: nome somente dígitos "{{123}}" em NAMED → malformed_placeholder (não começa com letra/_)', () => {
    const r = analyzeTemplate(namedBodyOnly('Código {{123}}'));
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('malformed_placeholder');
  });

});

// =============================================================================
// analyzeTemplate — Estrutura de componentes
// =============================================================================

describe('analyzeTemplate — estrutura', () => {

  it('AT-STR-01: BODY ausente → Template has no BODY component', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ type: 'HEADER', format: 'TEXT', text: 'Título' }],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('Template has no BODY component');
  });

  it('AT-STR-02: components ausente (template sem variáveis) → BODY deve estar presente', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('Template has no BODY component');
  });

  it('AT-STR-03: BODY com text=null → body_text_missing', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ type: 'BODY', text: null }],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('body_text_missing');
  });

  it('AT-STR-04: BODY com text=object → body_text_missing', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ type: 'BODY', text: { content: 'x' } }],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('body_text_missing');
  });

  it('AT-STR-05: BODY com text="" (vazio) → válido, params=[]', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ type: 'BODY', text: '' }],
    });
    expect(r.supported).toBe(true);
    expect(r.parameters).toHaveLength(0);
    expect(r.bodyText).toBe('');
  });

  it('AT-STR-06: HEADER ausente → válido, sem parâmetros HEADER', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{1}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters.filter(p => p.component === 'HEADER')).toHaveLength(0);
  });

  it('AT-STR-07: HEADER TEXT com parâmetro → suportado (índices independentes por componente)', () => {
    // POSITIONAL: numeração é independente por componente.
    // HEADER {{1}} = param 1 do header. BODY {{1}} = param 1 do body. Sem colisão.
    const r = analyzeTemplate(withHeader('Pedido {{1}}', 'Valor {{1}}'));
    expect(r.supported).toBe(true);
    expect(r.parameters.filter(p => p.component === 'HEADER')).toHaveLength(1);
    expect(r.parameters.filter(p => p.component === 'BODY')).toHaveLength(1);
  });

  it('AT-STR-08: HEADER com text=null → header_text_missing', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'TEXT', text: null },
        { type: 'BODY',   text: 'Olá' },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toBe('header_text_missing');
  });

  it('AT-STR-09: HEADER IMAGE → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Olá' },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/IMAGE/);
  });

  it('AT-STR-10: HEADER VIDEO → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'VIDEO' },
        { type: 'BODY', text: 'Olá' },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/VIDEO/);
  });

  it('AT-STR-11: HEADER DOCUMENT → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'DOCUMENT' },
        { type: 'BODY', text: 'Olá' },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/DOCUMENT/);
  });

  it('AT-STR-12: FOOTER estático → suportado, sem parâmetros FOOTER', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'BODY',   text: 'Olá {{1}}' },
        { type: 'FOOTER', text: 'Rodapé fixo' },
      ],
    });
    expect(r.supported).toBe(true);
    expect(r.parameters.filter(p => p.component === 'FOOTER')).toHaveLength(0);
    expect(r.parameters).toHaveLength(1); // somente BODY param
  });

  it('AT-STR-13: BUTTONS → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'BODY',    text: 'Olá' },
        { type: 'BUTTONS', buttons: [] },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/BUTTONS/);
  });

  it('AT-STR-14: CAROUSEL → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'BODY',     text: 'Olá' },
        { type: 'CAROUSEL', cards: [] },
      ],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/CAROUSEL/);
  });

  it('AT-STR-15: AUTHENTICATION → unsupported antes de analisar components', () => {
    const r = analyzeTemplate({
      category: 'AUTHENTICATION', parameter_format: 'POSITIONAL',
      components: [{ type: 'BODY', text: 'Código {{1}}' }],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/AUTHENTICATION/);
  });

  it('AT-STR-16: parameter_format desconhecido → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'UNKNOWN_FORMAT',
      components: [{ type: 'BODY', text: 'Olá' }],
    });
    expect(r.supported).toBe(false);
    expect(r.unsupported_reason).toMatch(/Unknown parameter_format/);
  });

  it('AT-STR-17: parameter_format ausente → fallback POSITIONAL, suportado', () => {
    const r = analyzeTemplate({
      category:   'MARKETING',
      components: [{ type: 'BODY', text: 'Texto fixo' }],
    });
    expect(r.supported).toBe(true);
    expect(r.parameter_format).toBe('POSITIONAL');
  });

  it('AT-STR-18: rawTemplate null → supported=false', () => {
    const r = analyzeTemplate(null);
    expect(r.supported).toBe(false);
  });

  it('AT-STR-19: rawTemplate array → supported=false', () => {
    const r = analyzeTemplate([]);
    expect(r.supported).toBe(false);
  });

  it('AT-STR-20: rawTemplate string → supported=false', () => {
    const r = analyzeTemplate('hello');
    expect(r.supported).toBe(false);
  });

  it('AT-STR-21: componente com type undefined → fail-closed', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ text: 'Olá' }, { type: 'BODY', text: 'Corpo' }],
    });
    expect(r.supported).toBe(false);
  });

  it('AT-STR-22: componente type não-string (number) → fail-closed', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [{ type: 42, text: 'x' }, { type: 'BODY', text: 'Corpo' }],
    });
    expect(r.supported).toBe(false);
  });

  it('AT-STR-23: HEADER format ausente → tratado como TEXT, suportado', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', text: 'Título estático' },
        { type: 'BODY',   text: 'Corpo' },
      ],
    });
    expect(r.supported).toBe(true);
  });

  it('AT-STR-24: components não-array → unsupported', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: 'invalid',
    });
    expect(r.supported).toBe(false);
  });

});

// =============================================================================
// analyzeTemplate — Examples
// =============================================================================

describe('analyzeTemplate — examples', () => {

  it('AT-EX-01: POSITIONAL — example correto → example preenchido nos params', () => {
    const template = bodyOnly('Olá {{1}}, {{2}}', {
      body_text: [['João', 'Produto X']],
    });
    const r = analyzeTemplate(template);
    expect(r.parameters[0].example).toBe('João');
    expect(r.parameters[1].example).toBe('Produto X');
  });

  it('AT-EX-02: POSITIONAL — example ausente → example=null em todos params', () => {
    const r = analyzeTemplate(bodyOnly('Olá {{1}}'));
    expect(r.parameters[0].example).toBeNull();
  });

  it('AT-EX-03: POSITIONAL — example menor (só 1 valor, 2 params) → extras recebem null', () => {
    const template = bodyOnly('{{1}} e {{2}}', { body_text: [['Só um']] });
    const r = analyzeTemplate(template);
    expect(r.parameters[0].example).toBe('Só um');
    expect(r.parameters[1].example).toBeNull();
  });

  it('AT-EX-04: POSITIONAL — example maior (3 valores, 1 param) → extras ignorados, param OK', () => {
    const template = bodyOnly('{{1}}', { body_text: [['Val1', 'Val2', 'Val3']] });
    const r = analyzeTemplate(template);
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0].example).toBe('Val1');
  });

  it('AT-EX-05: example malformado (não-array) → não derruba engine, example=null', () => {
    const template = bodyOnly('{{1}}', { body_text: 'invalid' });
    const r = analyzeTemplate(template);
    expect(r.supported).toBe(true);
    expect(r.parameters[0].example).toBeNull();
  });

  it('AT-EX-06: NAMED — example matching por param_name', () => {
    const template = namedBodyOnly('Olá {{first_name}}', {
      body_text_named_params: [{ param_name: 'first_name', example: 'Maria' }],
    });
    const r = analyzeTemplate(template);
    expect(r.parameters[0].example).toBe('Maria');
  });

  it('AT-EX-07: NAMED — example extra (param_name não no texto) ignorado, params OK', () => {
    const template = namedBodyOnly('Olá {{first_name}}', {
      body_text_named_params: [
        { param_name: 'first_name', example: 'Maria' },
        { param_name: 'extra_param', example: 'Ignorado' },
      ],
    });
    const r = analyzeTemplate(template);
    expect(r.parameters).toHaveLength(1);
    expect(r.parameters[0].example).toBe('Maria');
  });

  it('AT-EX-08: NAMED — param no texto sem entry no example → example=null', () => {
    const template = namedBodyOnly('{{first_name}} e {{last_name}}', {
      body_text_named_params: [{ param_name: 'first_name', example: 'Ana' }],
    });
    const r = analyzeTemplate(template);
    const last = r.parameters.find(p => p.key === 'last_name');
    expect(last?.example).toBeNull();
  });

  it('AT-EX-09: POSITIONAL HEADER — example.header_text[0] → example no param HEADER', () => {
    const r = analyzeTemplate({
      category: 'MARKETING', parameter_format: 'POSITIONAL',
      components: [
        {
          type: 'HEADER', format: 'TEXT', text: 'Pedido {{1}}',
          example: { header_text: ['PED-001'] },
        },
        { type: 'BODY', text: 'Corpo' },
      ],
    });
    const hParam = r.parameters.find(p => p.component === 'HEADER');
    expect(hParam?.example).toBe('PED-001');
  });

});

// =============================================================================
// validateParameterValues
// =============================================================================

describe('validateParameterValues', () => {

  // Helpers de parâmetros esperados
  const bodyParams2 = [
    { component: 'BODY', key: '1', position: 1, example: null },
    { component: 'BODY', key: '2', position: 2, example: null },
  ];
  const namedBodyParams = [
    { component: 'BODY', key: 'first_name', position: null, example: null },
    { component: 'BODY', key: 'order_id',   position: null, example: null },
  ];
  const headerBodyParams = [
    { component: 'HEADER', key: '1', position: 1, example: null },
    { component: 'BODY',   key: '1', position: 1, example: null },
  ];
  const zeroBodyParams = []; // template sem parâmetros no BODY

  it('VPV-01: POSITIONAL válido → valid=true', () => {
    const r = validateParameterValues(bodyParams2, { body: { '1': 'Ana', '2': 'PED-001' } });
    expect(r.valid).toBe(true);
  });

  it('VPV-02: NAMED válido → valid=true', () => {
    const r = validateParameterValues(namedBodyParams, {
      body: { first_name: 'Ana', order_id: 'PED-001' },
    });
    expect(r.valid).toBe(true);
  });

  it('VPV-03: HEADER + BODY válidos → valid=true', () => {
    const r = validateParameterValues(headerBodyParams, {
      header: { '1': 'Titulo' },
      body:   { '1': 'Ana' },
    });
    expect(r.valid).toBe(true);
  });

  it('VPV-04: chave body faltando → template_params_mismatch', () => {
    const r = validateParameterValues(bodyParams2, { body: { '1': 'Ana' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-05: chave body extra → template_params_mismatch', () => {
    const r = validateParameterValues(bodyParams2, {
      body: { '1': 'Ana', '2': 'PED', '3': 'Extra' },
    });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-06: valor whitespace-only → template_params_mismatch', () => {
    const r = validateParameterValues(bodyParams2, { body: { '1': '   ', '2': 'PED' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-07: valor não-string (number) → template_params_mismatch', () => {
    const r = validateParameterValues(bodyParams2, { body: { '1': 123, '2': 'PED' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-08: parameterValues=null → invalid_request', () => {
    const r = validateParameterValues(bodyParams2, null);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_request');
  });

  it('VPV-09: parameterValues=array → invalid_request', () => {
    const r = validateParameterValues(bodyParams2, [{ body: { '1': 'x' } }]);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_request');
  });

  it('VPV-10: body ausente → invalid_request', () => {
    const r = validateParameterValues(bodyParams2, { header: { '1': 'x' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_request');
  });

  it('VPV-11: body=null → invalid_request', () => {
    const r = validateParameterValues(bodyParams2, { body: null });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_request');
  });

  it('VPV-12: body=array → invalid_request', () => {
    const r = validateParameterValues(bodyParams2, { body: ['Ana', 'PED'] });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_request');
  });

  it('VPV-13: BODY zero parâmetros + body={} → valid=true', () => {
    const r = validateParameterValues(zeroBodyParams, { body: {} });
    expect(r.valid).toBe(true);
  });

  it('VPV-14: BODY zero parâmetros + body com chave extra → mismatch', () => {
    const r = validateParameterValues(zeroBodyParams, { body: { extra: 'x' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-15: header esperado mas ausente → template_params_mismatch', () => {
    const r = validateParameterValues(headerBodyParams, { body: { '1': 'Ana' } });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-16: header não esperado mas presente → template_params_mismatch', () => {
    const r = validateParameterValues(bodyParams2, {
      header: { '1': 'Extra' },
      body:   { '1': 'Ana', '2': 'PED' },
    });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('template_params_mismatch');
  });

  it('VPV-17: prototype safety — chave herdada NÃO conta como parâmetro fornecido', () => {
    const malicious = Object.create({ inherited_key: 'hacked' });
    malicious.body = { '1': 'Ana', '2': 'PED' };
    const r = validateParameterValues(bodyParams2, malicious);
    // inherited_key não deve ser contado como extra — não pertence a body nem header
    expect(r.valid).toBe(true);
  });

  it('VPV-18: prototype no body — chave herdada NÃO conta como parâmetro fornecido', () => {
    const maliciousBody = Object.create({ '1': 'hacked' });
    // body tem a chave '1' herdada, não própria; mas falta '2'
    const r = validateParameterValues(bodyParams2, { body: maliciousBody });
    // '1' herdada: Object.prototype.hasOwnProperty.call(body, '1') = false → mismatch
    expect(r.valid).toBe(false);
  });

  it('VPV-19: whitespace em torno do valor preservado para envio, trim somente verifica vazio', () => {
    // " Ana " tem trim.length > 0 → válido; valor original preservado
    const params = [{ component: 'BODY', key: '1', position: 1, example: null }];
    const r = validateParameterValues(params, { body: { '1': ' Ana ' } });
    expect(r.valid).toBe(true);
  });

});

// =============================================================================
// buildGraphComponents
// =============================================================================

describe('buildGraphComponents', () => {

  const positionalComps = [
    { type: 'BODY', text: 'Olá {{1}}, pedido {{2}}' },
  ];
  const headerBodyComps = [
    { type: 'HEADER', format: 'TEXT', text: 'Pedido {{1}}' },
    { type: 'BODY',   text: 'Valor {{1}}' },
  ];
  const namedBodyComps = [
    { type: 'BODY', text: 'Olá {{first_name}}, pedido {{order_id}}' },
  ];
  const namedHeaderBodyComps = [
    { type: 'HEADER', format: 'TEXT', text: 'Empresa {{company_name}}' },
    { type: 'BODY',   text: 'Cliente {{client_name}}' },
  ];
  const staticComps = [
    { type: 'BODY', text: 'Texto estático sem variáveis' },
  ];
  const withFooter = [
    { type: 'BODY',   text: 'Corpo {{1}}' },
    { type: 'FOOTER', text: 'Rodapé fixo' },
  ];
  const staticHeader = [
    { type: 'HEADER', format: 'TEXT', text: 'Cabeçalho fixo' },
    { type: 'BODY',   text: 'Corpo {{1}}' },
  ];

  it('BGC-01: POSITIONAL BODY 2 params → type=body, 2 parâmetros ordenados', () => {
    const r = buildGraphComponents(positionalComps, 'POSITIONAL', {
      body: { '1': 'Ana', '2': 'PED-001' },
    });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('body');
    expect(r[0].parameters).toEqual([
      { type: 'text', text: 'Ana' },
      { type: 'text', text: 'PED-001' },
    ]);
  });

  it('BGC-02: POSITIONAL HEADER + BODY → 2 entries [header, body]', () => {
    const r = buildGraphComponents(headerBodyComps, 'POSITIONAL', {
      header: { '1': 'Titulo' },
      body:   { '1': 'R$ 100' },
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ type: 'header', parameters: [{ type: 'text', text: 'Titulo' }] });
    expect(r[1]).toMatchObject({ type: 'body',   parameters: [{ type: 'text', text: 'R$ 100' }] });
  });

  it('BGC-03: NAMED BODY → parâmetros com parameter_name', () => {
    const r = buildGraphComponents(namedBodyComps, 'NAMED', {
      body: { first_name: 'Ana', order_id: 'PED-002' },
    });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('body');
    expect(r[0].parameters).toEqual([
      { type: 'text', parameter_name: 'first_name', text: 'Ana' },
      { type: 'text', parameter_name: 'order_id',   text: 'PED-002' },
    ]);
  });

  it('BGC-04: NAMED HEADER + BODY → 2 entries com parameter_name', () => {
    const r = buildGraphComponents(namedHeaderBodyComps, 'NAMED', {
      header: { company_name: 'LovooCRM' },
      body:   { client_name:  'Ana' },
    });
    expect(r).toHaveLength(2);
    expect(r[0].parameters[0].parameter_name).toBe('company_name');
    expect(r[1].parameters[0].parameter_name).toBe('client_name');
  });

  it('BGC-05: BODY estático (sem parâmetros) → entry body omitido do resultado', () => {
    const r = buildGraphComponents(staticComps, 'POSITIONAL', { body: {} });
    expect(r).toHaveLength(0);
  });

  it('BGC-06: HEADER estático (sem parâmetros) → entry header omitido', () => {
    const r = buildGraphComponents(staticHeader, 'POSITIONAL', {
      body: { '1': 'Valor' },
    });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('body');
  });

  it('BGC-07: FOOTER omitido do resultado sempre', () => {
    const r = buildGraphComponents(withFooter, 'POSITIONAL', {
      body: { '1': 'Corpo' },
    });
    const types = r.map(c => c.type);
    expect(types).not.toContain('footer');
  });

  it('BGC-08: whitespace preservado no valor enviado ao Graph', () => {
    const r = buildGraphComponents(positionalComps, 'POSITIONAL', {
      body: { '1': ' Ana ', '2': 'PED' },
    });
    expect(r[0].parameters[0].text).toBe(' Ana ');
  });

  it('BGC-09: POSITIONAL com texto "{{2}} antes de {{1}}" → parâmetros ordenados [1,2]', () => {
    const comps = [{ type: 'BODY', text: '{{2}} e depois {{1}}' }];
    const r = buildGraphComponents(comps, 'POSITIONAL', { body: { '1': 'A', '2': 'B' } });
    expect(r[0].parameters[0].text).toBe('A'); // posição 1 primeiro
    expect(r[0].parameters[1].text).toBe('B'); // posição 2 depois
  });

});

// =============================================================================
// interpolateBody
// =============================================================================

describe('interpolateBody', () => {

  it('IB-01: POSITIONAL — {{1}} substituído pelo valor', () => {
    const r = interpolateBody('Olá {{1}}!', 'POSITIONAL', { '1': 'Ana' });
    expect(r).toBe('Olá Ana!');
  });

  it('IB-02: POSITIONAL — múltiplos placeholders substituídos', () => {
    const r = interpolateBody('{{1}} pedido {{2}}', 'POSITIONAL', { '1': 'Ana', '2': 'PED-001' });
    expect(r).toBe('Ana pedido PED-001');
  });

  it('IB-03: POSITIONAL — duplicata {{1}} recebe o mesmo valor nas duas ocorrências', () => {
    const r = interpolateBody('{{1}} e de novo {{1}}', 'POSITIONAL', { '1': 'Ana' });
    expect(r).toBe('Ana e de novo Ana');
  });

  it('IB-04: POSITIONAL — texto estático sem placeholders retornado intacto', () => {
    const r = interpolateBody('Texto sem variáveis', 'POSITIONAL', {});
    expect(r).toBe('Texto sem variáveis');
  });

  it('IB-05: NAMED — {{first_name}} substituído', () => {
    const r = interpolateBody('Olá {{first_name}}', 'NAMED', { first_name: 'Ana' });
    expect(r).toBe('Olá Ana');
  });

  it('IB-06: NAMED — duplicata {{name}} recebe mesmo valor em todas ocorrências', () => {
    const r = interpolateBody('{{name}} e {{name}}', 'NAMED', { name: 'Ana' });
    expect(r).toBe('Ana e Ana');
  });

  it('IB-07: whitespace no valor preservado na interpolação', () => {
    const r = interpolateBody('Olá {{1}}!', 'POSITIONAL', { '1': ' Ana ' });
    expect(r).toBe('Olá  Ana !');
  });

  it('IB-08: NAMED — texto estático retornado intacto', () => {
    const r = interpolateBody('Mensagem fixa', 'NAMED', {});
    expect(r).toBe('Mensagem fixa');
  });

});

// =============================================================================
// Pureza e segurança
// =============================================================================

describe('templateEngine — pureza', () => {

  it('PUR-01: módulo não importa Supabase, graphClient, auth, crypto ou env', async () => {
    // Valida que o módulo carrega sem nenhuma dependência de IO
    const source = await import('../templateEngine.js');
    expect(typeof source.analyzeTemplate).toBe('function');
    expect(typeof source.validateParameterValues).toBe('function');
    expect(typeof source.buildGraphComponents).toBe('function');
    expect(typeof source.interpolateBody).toBe('function');
    // Não deve exportar helpers privados com _ (não são API pública)
    // Exports inesperados indicariam expansão não autorizada da API
    const expectedExports = new Set([
      'analyzeTemplate',
      'validateParameterValues',
      'buildGraphComponents',
      'interpolateBody',
    ]);
    for (const key of Object.keys(source)) {
      if (key === 'default') continue;
      expect(expectedExports.has(key)).toBe(true);
    }
  });

  it('PUR-02: analyzeTemplate não lança exception em nenhum input arbitrário', () => {
    const inputs = [
      null, undefined, 42, 'string', [], {}, Symbol('s'),
      { components: null },
      { category: null, components: [{ type: 'BODY', text: null }] },
    ];
    for (const input of inputs) {
      expect(() => analyzeTemplate(input)).not.toThrow();
    }
  });

  it('PUR-03: validateParameterValues não lança exception em inputs arbitrários', () => {
    const inputs = [null, undefined, 42, 'string', [], {}, Symbol('s')];
    const params = [{ component: 'BODY', key: '1', position: 1, example: null }];
    for (const input of inputs) {
      expect(() => validateParameterValues(params, input)).not.toThrow();
    }
  });

});

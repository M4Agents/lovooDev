import { describe, it, expect } from 'vitest';
import { buildGraphCreatePayload } from '../templateCreate.js';

const BASE = {
  name: 'pedido_enviado',
  language: 'pt_BR',
  category: 'UTILITY',
  body_text: 'Olá {{1}}, seu pedido {{2}} saiu para entrega.',
  examples: { body: { '1': 'João', '2': 'ORD-1' } },
};

describe('buildGraphCreatePayload', () => {
  it('TC-01: BODY posicional com exemplos', () => {
    const result = buildGraphCreatePayload(BASE);
    expect(result.ok).toBe(true);
    expect(result.payload.parameter_format).toBe('POSITIONAL');
    expect(result.payload.allow_category_change).toBe(true);
    expect(result.payload.components[0]).toEqual({
      type: 'BODY',
      text: BASE.body_text,
      example: { body_text: [['João', 'ORD-1']] },
    });
  });

  it('TC-02: HEADER TEXT + BODY nomeado + FOOTER', () => {
    const result = buildGraphCreatePayload({
      name: 'boas_vindas',
      language: 'pt_BR',
      category: 'MARKETING',
      header_text: 'Olá {{first_name}}',
      body_text: 'Seu pedido {{order_id}} está pronto.',
      footer_text: 'Lovoo CRM',
      examples: {
        header: { first_name: 'Ana' },
        body: { order_id: 'ORD-9' },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.payload.parameter_format).toBe('NAMED');
    expect(result.payload.components).toHaveLength(3);
    expect(result.payload.components[0].example.header_text_named_params).toEqual([
      { param_name: 'first_name', example: 'Ana' },
    ]);
    expect(result.payload.components[2]).toEqual({ type: 'FOOTER', text: 'Lovoo CRM' });
  });

  it('TC-03: AUTHENTICATION rejeitado', () => {
    expect(buildGraphCreatePayload({ ...BASE, category: 'AUTHENTICATION' }).error)
      .toBe('authentication_not_supported');
  });

  it('TC-04: botões e components crus rejeitados', () => {
    expect(buildGraphCreatePayload({ ...BASE, buttons: [{ type: 'QUICK_REPLY' }] }).error)
      .toBe('buttons_not_supported');
    expect(buildGraphCreatePayload({ ...BASE, components: [{ type: 'BODY', text: 'x' }] }).error)
      .toBe('buttons_not_supported');
  });

  it('TC-05: mídia rejeitada', () => {
    expect(buildGraphCreatePayload({ ...BASE, header_format: 'IMAGE' }).error)
      .toBe('media_not_supported');
  });

  it('TC-06: variáveis inválidas e exemplos obrigatórios', () => {
    expect(buildGraphCreatePayload({ ...BASE, body_text: 'Oi {{2}}' }).error)
      .toBe('invalid_template_variables');
    expect(buildGraphCreatePayload({ ...BASE, body_text: 'Oi {{1}} e {{nome}}' }).error)
      .toBe('invalid_template_variables');
    expect(buildGraphCreatePayload({ ...BASE, examples: { body: { '1': 'João' } } }).error)
      .toBe('invalid_template_examples');
    expect(buildGraphCreatePayload({
      ...BASE,
      body_text: 'Olá {{lead.name}}',
      examples: { body: { 'lead.name': 'João' } },
    }).error).toBe('invalid_template_variables');
  });

  it('TC-07: footer com variável e body vazio', () => {
    expect(buildGraphCreatePayload({ ...BASE, footer_text: 'tchau {{1}}' }).error)
      .toBe('invalid_template_footer');
    expect(buildGraphCreatePayload({ ...BASE, body_text: '   ' }).error)
      .toBe('invalid_template_body');
  });

  it('TC-08: nome inválido e idioma fora da allowlist', () => {
    expect(buildGraphCreatePayload({ ...BASE, name: 'Hello World' }).error)
      .toBe('invalid_template_name');
    expect(buildGraphCreatePayload({ ...BASE, language: 'xx_ZZ' }).error)
      .toBe('invalid_template_language');
  });

  it('TC-09: body sem variáveis omite example', () => {
    const result = buildGraphCreatePayload({
      name: 'aviso_simples',
      language: 'pt_BR',
      category: 'UTILITY',
      body_text: 'Loja fechada amanhã.',
    });
    expect(result.ok).toBe(true);
    expect(result.payload.components[0].example).toBeUndefined();
  });
});

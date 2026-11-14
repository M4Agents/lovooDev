import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WELCOME_ORIGIN_PATTERN } from '../welcomePopupAccess.js';
import {
  normalizeWelcomeEmail,
  normalizeWelcomeMobile,
  parseWelcomeContactList,
} from '../welcomeContact.js';

describe('e-mail do ensaio', () => {
  it('aceita formato comum e remove só espaços externos', () => {
    expect(normalizeWelcomeEmail(' nome.sobrenome+tag@dominio.com.br ')).toBe('nome.sobrenome+tag@dominio.com.br');
    expect(normalizeWelcomeEmail('Ana_B@Valleron.store')).toBe('ana_b@valleron.store');
  });

  it('rejeita estrutura inválida sem afirmar que a caixa existe', () => {
    expect(normalizeWelcomeEmail('a@b@c.com')).toBeNull();
    expect(normalizeWelcomeEmail('a b@dominio.com')).toBeNull();
    expect(normalizeWelcomeEmail('@dominio.com')).toBeNull();
    expect(normalizeWelcomeEmail('usuario@')).toBeNull();
    expect(normalizeWelcomeEmail('usuario@dominio')).toBeNull();
    expect(normalizeWelcomeEmail('usuario @dominio.com')).toBeNull();
  });
});

describe('celular brasileiro do ensaio', () => {
  const canonical = '5511999999999';

  it('aceita os formatos equivalentes e o DDD 55', () => {
    expect(normalizeWelcomeMobile('(11) 99999-9999')).toBe(canonical);
    expect(normalizeWelcomeMobile('11999999999')).toBe(canonical);
    expect(normalizeWelcomeMobile('+55 (11) 99999-9999')).toBe(canonical);
    expect(normalizeWelcomeMobile('5511999999999')).toBe(canonical);
    expect(normalizeWelcomeMobile('55999999999')).toBe('5555999999999');
    expect(normalizeWelcomeMobile('5555999999999')).toBe('5555999999999');
    expect(normalizeWelcomeMobile('+55 (55) 99999-9999')).toBe('5555999999999');
  });

  it('rejeita fixo, incompleto, DDD inválido, excesso e DDI repetido', () => {
    expect(normalizeWelcomeMobile('(11) 3333-4444')).toBeNull();
    expect(normalizeWelcomeMobile('551133334444')).toBeNull();
    expect(normalizeWelcomeMobile('119999999')).toBeNull();
    expect(normalizeWelcomeMobile('00999999999')).toBeNull();
    expect(normalizeWelcomeMobile('119999999999')).toBeNull();
    expect(normalizeWelcomeMobile('+55 55 11 99999-9999')).toBeNull();
    expect(normalizeWelcomeMobile('+1 415 555 0134')).toBeNull();
  });

  it('grava o contato autorizado no mesmo formato canônico', () => {
    const parsed = parseWelcomeContactList(' Ana_B@Valleron.store , +55 (11) 99999-9999 ');
    expect(parsed).toEqual({
      ok: true,
      contacts: [{ email: 'ana_b@valleron.store', phone: canonical }],
    });
    expect(parseWelcomeContactList('a@b@c.com, 11999999999').ok).toBe(false);
  });
});

describe('origem compartilhada', () => {
  it('usa no SQL o mesmo padrão da API', () => {
    const sql = readFileSync(
      resolve(import.meta.dirname, '../../../../supabase/migrations/20261114130000_nuvemshop_welcome_test_submissions.sql'),
      'utf8',
    );
    expect(sql).toContain(WELCOME_ORIGIN_PATTERN);
  });
});

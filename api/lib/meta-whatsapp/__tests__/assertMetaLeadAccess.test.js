// =============================================================================
// assertMetaLeadAccess.test.js
//
// Testes unitários puros — sem banco, rede, JWT ou templates.
//
// COBERTURA:
//   A  Seis roles
//   B  Seller restrito / irrestrito
//   C–E Seller próprio / outro responsável / sem responsável
//   F  Manager carteira completa
//   G  Partner accessPath=partner
//   H  Role × accessPath inválidos
//   I  Parent super_admin e system_admin
//   J  Parent com role não autorizada
//   K–M Isolamento de company_id (lead, conversa, empresa)
//   N  Soft-delete em READ/LINK/REPLACE/UNLINK
//   O–P REPLACE só admin-class
//   Q  UNLINK seller restrito × lead de terceiro
//   R  SEARCH scope own/all
//   S  CREATE sem lead
//   T  view_all_leads no seller não amplia
//   U–W Contexto inválido
//   X  Resposta sem dados de lead
//   Y  Sem consulta/escrita em banco
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertMetaLeadAccess } from '../assertMetaLeadAccess.js';

const USER_ID    = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_USER = 'eeee0000-0000-0000-0000-000000000005';
const COMPANY_ID = 'bbbb0000-0000-0000-0000-000000000002';
const OTHER_CO   = 'cccc0000-0000-0000-0000-000000000003';
const CONV_ID    = 'dddd0000-0000-0000-0000-000000000004';

const ALL_ROLES = ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'];

function makeAuth(overrides = {}) {
  return {
    ok:         true,
    userId:     USER_ID,
    companyId:  COMPANY_ID,
    role:       'admin',
    accessPath: 'direct',
    ...overrides,
  };
}

function makeCompany(overrides = {}) {
  return {
    id: COMPANY_ID,
    restrict_leads_to_owner: false,
    ...overrides,
  };
}

function makeLead(overrides = {}) {
  return {
    id:                   42,
    company_id:           COMPANY_ID,
    responsible_user_id:  USER_ID,
    deleted_at:           null,
    ...overrides,
  };
}

function makeConversation(overrides = {}) {
  return {
    id:         CONV_ID,
    company_id: COMPANY_ID,
    lead_id:    42,
    ...overrides,
  };
}

function call(overrides = {}) {
  const {
    auth = makeAuth(),
    operation = 'search',
    company = makeCompany(),
    lead,
    conversation,
    ...rest
  } = overrides;
  return assertMetaLeadAccess({ auth, operation, company, lead, conversation, ...rest });
}

function expectAllowed(result, scope) {
  expect(result).toEqual({ ok: true, scope });
}

function expectDenied(result, reason) {
  expect(result).toEqual({ ok: false, reason });
}

describe('assertMetaLeadAccess — contexto (U V W)', () => {
  it('U: auth ausente → invalid_context', () => {
    expectDenied(assertMetaLeadAccess({
      operation: 'search',
      company: makeCompany(),
    }), 'invalid_context');
  });

  it('U: auth.ok false → invalid_context', () => {
    expectDenied(call({ auth: makeAuth({ ok: false }) }), 'invalid_context');
  });

  it('V: role desconhecida → invalid_context', () => {
    expectDenied(call({ auth: makeAuth({ role: 'support' }) }), 'invalid_context');
  });

  it('W: operation inválida → invalid_context', () => {
    expectDenied(call({ operation: 'merge' }), 'invalid_context');
  });

  it('W: company_id malformado → invalid_context', () => {
    expectDenied(call({ auth: makeAuth({ companyId: 'nao-uuid' }) }), 'invalid_context');
  });

  it('W: restrict_leads_to_owner ausente → invalid_context', () => {
    expectDenied(call({ company: { id: COMPANY_ID } }), 'invalid_context');
  });

  it('W: READ sem lead → invalid_context', () => {
    expectDenied(call({ operation: 'read' }), 'invalid_context');
  });

  it('W: LINK sem conversation → invalid_context', () => {
    expectDenied(call({ operation: 'link', lead: makeLead() }), 'invalid_context');
  });
});

describe('assertMetaLeadAccess — accessPath (G H I J)', () => {
  it.each([
    ['partner', 'partner'],
    ['super_admin', 'parent'],
    ['system_admin', 'parent'],
    ['admin', 'direct'],
    ['manager', 'direct'],
    ['seller', 'direct'],
  ])('G/I: role %s + accessPath %s autorizado no SEARCH', (role, accessPath) => {
    expectAllowed(call({ auth: makeAuth({ role, accessPath }) }), 'all');
  });

  it.each([
    ['partner', 'direct'],
    ['partner', 'parent'],
    ['seller', 'partner'],
    ['admin', 'partner'],
    ['manager', 'parent'],
    ['seller', 'parent'],
    ['admin', 'parent'],
  ])('H/J: role %s + accessPath %s → invalid_context', (role, accessPath) => {
    expectDenied(call({ auth: makeAuth({ role, accessPath }) }), 'invalid_context');
  });
});

describe('assertMetaLeadAccess — isolamento de tenant (K L M)', () => {
  it('M: company.id diferente de auth.companyId → invalid_context', () => {
    expectDenied(call({ company: makeCompany({ id: OTHER_CO }) }), 'invalid_context');
  });

  it('K: lead de outro company_id → invalid_context', () => {
    expectDenied(call({
      operation: 'read',
      lead: makeLead({ company_id: OTHER_CO }),
    }), 'invalid_context');
  });

  it('L: conversa de outro company_id → invalid_context', () => {
    expectDenied(call({
      operation: 'link',
      lead: makeLead(),
      conversation: makeConversation({ company_id: OTHER_CO }),
    }), 'invalid_context');
  });
});

describe('assertMetaLeadAccess — SEARCH scope (A B F R T)', () => {
  it.each([
    ['super_admin', 'direct', false, 'all'],
    ['system_admin', 'direct', false, 'all'],
    ['admin', 'direct', false, 'all'],
    ['manager', 'direct', false, 'all'],
    ['partner', 'partner', false, 'all'],
    ['seller', 'direct', false, 'all'],
    ['super_admin', 'direct', true, 'all'],
    ['system_admin', 'parent', true, 'all'],
    ['admin', 'direct', true, 'all'],
    ['manager', 'direct', true, 'all'],
    ['partner', 'partner', true, 'all'],
    ['seller', 'direct', true, 'own'],
  ])('A/B/F/R: %s restrict=%s → scope %s', (role, accessPath, restrict, scope) => {
    expectAllowed(call({
      auth: makeAuth({ role, accessPath }),
      company: makeCompany({ restrict_leads_to_owner: restrict }),
    }), scope);
  });

  it('T: seller restrito com permissions.view_all_leads=true continua scope=own', () => {
    expectAllowed(call({
      auth: makeAuth({
        role: 'seller',
        permissions: { view_all_leads: true },
      }),
      company: makeCompany({
        restrict_leads_to_owner: true,
        permissions: { view_all_leads: true },
      }),
    }), 'own');
  });
});

describe('assertMetaLeadAccess — READ/LINK ownership (C D E)', () => {
  const restrictedSeller = makeAuth({ role: 'seller' });
  const restrictedCompany = makeCompany({ restrict_leads_to_owner: true });

  it('C: seller restrito + lead próprio → own', () => {
    expectAllowed(call({
      auth: restrictedSeller,
      company: restrictedCompany,
      operation: 'read',
      lead: makeLead({ responsible_user_id: USER_ID }),
    }), 'own');
  });

  it('D: seller restrito + lead de outro → not_found', () => {
    expectDenied(call({
      auth: restrictedSeller,
      company: restrictedCompany,
      operation: 'read',
      lead: makeLead({ responsible_user_id: OTHER_USER }),
    }), 'not_found');
  });

  it('E: seller restrito + lead sem responsável → not_found', () => {
    expectDenied(call({
      auth: restrictedSeller,
      company: restrictedCompany,
      operation: 'read',
      lead: makeLead({ responsible_user_id: null }),
    }), 'not_found');
  });

  it('seller irrestrito + lead de outro → all', () => {
    expectAllowed(call({
      auth: restrictedSeller,
      company: makeCompany({ restrict_leads_to_owner: false }),
      operation: 'link',
      lead: makeLead({ responsible_user_id: OTHER_USER }),
      conversation: makeConversation({ lead_id: null }),
    }), 'all');
  });
});

describe('assertMetaLeadAccess — REPLACE (O P)', () => {
  const dest = makeLead({ id: 99, responsible_user_id: OTHER_USER });
  const conv = makeConversation({ lead_id: 1 });

  it.each(['super_admin', 'system_admin', 'admin'])('O: %s pode REPLACE', (role) => {
    expectAllowed(call({
      auth: makeAuth({ role }),
      operation: 'replace',
      lead: dest,
      conversation: conv,
    }), 'all');
  });

  it.each([
    ['seller', 'direct'],
    ['manager', 'direct'],
    ['partner', 'partner'],
  ])('P: %s não pode REPLACE → forbidden', (role, accessPath) => {
    expectDenied(call({
      auth: makeAuth({ role, accessPath }),
      operation: 'replace',
      lead: dest,
      conversation: conv,
    }), 'forbidden');
  });
});

describe('assertMetaLeadAccess — UNLINK (Q N)', () => {
  it('Q: seller restrito não desvincula lead de terceiro → not_found', () => {
    expectDenied(call({
      auth: makeAuth({ role: 'seller' }),
      company: makeCompany({ restrict_leads_to_owner: true }),
      operation: 'unlink',
      lead: makeLead({ responsible_user_id: OTHER_USER }),
      conversation: makeConversation(),
    }), 'not_found');
  });

  it('UNLINK seller restrito no próprio lead → own', () => {
    expectAllowed(call({
      auth: makeAuth({ role: 'seller' }),
      company: makeCompany({ restrict_leads_to_owner: true }),
      operation: 'unlink',
      lead: makeLead(),
      conversation: makeConversation(),
    }), 'own');
  });

  it('N: UNLINK de lead próprio soft-deleted → permitido', () => {
    expectAllowed(call({
      auth: makeAuth({ role: 'seller' }),
      company: makeCompany({ restrict_leads_to_owner: true }),
      operation: 'unlink',
      lead: makeLead({ deleted_at: '2026-11-23T12:00:00.000Z' }),
      conversation: makeConversation(),
    }), 'own');
  });

  it('UNLINK com conversation.lead_id divergente → invalid_context', () => {
    expectDenied(call({
      operation: 'unlink',
      lead: makeLead({ id: 42 }),
      conversation: makeConversation({ lead_id: 99 }),
    }), 'invalid_context');
  });
});

describe('assertMetaLeadAccess — soft-delete (N)', () => {
  const deleted = makeLead({ deleted_at: '2026-11-23T12:00:00.000Z' });
  const conv = makeConversation();

  it.each(['read', 'link', 'replace'])('N: %s em lead soft-deleted → not_found', (operation) => {
    expectDenied(call({
      operation,
      lead: deleted,
      conversation: conv,
    }), 'not_found');
  });

  it('N: UNLINK admin em lead soft-deleted do tenant → all', () => {
    expectAllowed(call({
      operation: 'unlink',
      lead: deleted,
      conversation: conv,
    }), 'all');
  });
});

describe('assertMetaLeadAccess — CREATE (S)', () => {
  it('S: CREATE não exige lead preexistente', () => {
    expectAllowed(call({
      auth: makeAuth({ role: 'seller' }),
      operation: 'create',
    }), 'all');
  });

  it('S: CREATE seller restrito retorna scope=own sem consultar telefone', () => {
    expectAllowed(call({
      auth: makeAuth({ role: 'seller' }),
      company: makeCompany({ restrict_leads_to_owner: true }),
      operation: 'create',
      lead: null,
      conversation: null,
    }), 'own');
  });
});

describe('assertMetaLeadAccess — contrato da resposta (X Y)', () => {
  it('X: recusa não inclui dados de lead', () => {
    const result = call({
      auth: makeAuth({ role: 'seller' }),
      company: makeCompany({ restrict_leads_to_owner: true }),
      operation: 'read',
      lead: makeLead({
        responsible_user_id: OTHER_USER,
        name: 'Segredo',
        phone: '5511999990000',
        email: 'x@example.com',
      }),
    });
    expectDenied(result, 'not_found');
    expect(JSON.stringify(result)).not.toMatch(/Segredo|5511999990000|example\.com|42/);
  });

  it('Y: fonte do helper não consulta banco nem templates', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'assertMetaLeadAccess.js'),
      'utf8',
    );
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/getSupabaseAdmin|auth\.getUser|\.from\(/);
    expect(src).not.toMatch(/view_all_leads/);
    expect(src).not.toMatch(/hasPermission|useLeadPermissions|useAccessControl/);
  });
});

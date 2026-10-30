import { describe, expect, it } from 'vitest';
import {
  canViewInstagramByoMeta,
  canWriteInstagramByoMeta,
} from '../instagramByoVisibility';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const PARENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_PARENT = 'bbbbbbbb-0000-4000-8000-000000000002';

function role(companyId: string, roleName: 'admin' | 'manager' | 'seller' | 'super_admin' | 'system_admin' | 'partner', companyType: 'parent' | 'client' = 'client') {
  return {
    company_id: companyId,
    role: roleName,
    companies: { id: companyId, name: 'Empresa', company_type: companyType },
  };
}

describe('canViewInstagramByoMeta', () => {
  it('oculta seller da empresa ativa', () => {
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(COMPANY, 'seller')],
    })).toBe(false);
  });

  it('mostra admin e manager com membership direta', () => {
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      roles: [role(COMPANY, 'admin')],
    })).toBe(true);
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      roles: [role(COMPANY, 'manager')],
    })).toBe(true);
  });

  it('mostra super_admin da empresa pai correta e oculta outra pai', () => {
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(PARENT, 'super_admin', 'parent')],
    })).toBe(true);
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(OTHER_PARENT, 'system_admin', 'parent')],
    })).toBe(false);
  });

  it('mostra partner somente com a empresa na lista de atribuição', () => {
    const roles = [role(PARENT, 'partner', 'parent')];
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles,
      partnerAssignedCompanyIds: [COMPANY],
    })).toBe(true);
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles,
      partnerAssignedCompanyIds: [OTHER],
    })).toBe(false);
    expect(canViewInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles,
    })).toBe(false);
  });

  it('mostra admin de qualquer empresa com membership e oculta empresa sem vínculo', () => {
    expect(canViewInstagramByoMeta({
      companyId: OTHER,
      roles: [role(OTHER, 'admin')],
    })).toBe(true);
    expect(canViewInstagramByoMeta({
      companyId: OTHER,
      roles: [role(COMPANY, 'admin')],
    })).toBe(false);
  });
});

describe('canWriteInstagramByoMeta', () => {
  it('permite escrita direta de admin, super_admin e system_admin', () => {
    for (const roleName of ['admin', 'super_admin', 'system_admin'] as const) {
      expect(canWriteInstagramByoMeta({
        companyId: COMPANY,
        roles: [role(COMPANY, roleName)],
      })).toBe(true);
    }
  });

  it('deixa manager, partner e seller somente sem escrita', () => {
    for (const roleName of ['manager', 'partner', 'seller'] as const) {
      expect(canWriteInstagramByoMeta({
        companyId: COMPANY,
        parentCompanyId: PARENT,
        roles: [role(COMPANY, roleName)],
      })).toBe(false);
    }
  });

  it('permite super_admin e system_admin da empresa pai e recusa admin ou partner da pai', () => {
    expect(canWriteInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(PARENT, 'super_admin', 'parent')],
    })).toBe(true);
    expect(canWriteInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(PARENT, 'system_admin', 'parent')],
    })).toBe(true);
    expect(canWriteInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(PARENT, 'admin', 'parent')],
    })).toBe(false);
    expect(canWriteInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(PARENT, 'partner', 'parent')],
    })).toBe(false);
  });

  it('faz a membership direta prevalecer sobre o papel da empresa pai', () => {
    expect(canWriteInstagramByoMeta({
      companyId: COMPANY,
      parentCompanyId: PARENT,
      roles: [role(COMPANY, 'manager'), role(PARENT, 'super_admin', 'parent')],
    })).toBe(false);
  });

  it('permite admin da própria empresa e recusa admin sem vínculo nela', () => {
    expect(canWriteInstagramByoMeta({
      companyId: OTHER,
      roles: [role(OTHER, 'admin')],
    })).toBe(true);
    expect(canWriteInstagramByoMeta({
      companyId: OTHER,
      roles: [role(COMPANY, 'admin')],
    })).toBe(false);
  });
});

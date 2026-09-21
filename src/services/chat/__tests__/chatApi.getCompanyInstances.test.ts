// =============================================================================
// chatApi.getCompanyInstances.test.ts — MVP3C.3 / Etapa 0
//
// Verifica que a query para whatsapp_life_instances usa seleção explícita
// (Etapa 0) e NÃO inclui provider_token.
//
// CI-01  select usa lista explícita de campos (não SELECT *)
// CI-02  provider_token NÃO está na lista de campos solicitados
// CI-03  todos os campos necessários estão na seleção
// CI-04  filtro por company_id e status='connected'
//
// Segurança: nenhum UUID real, token ou credencial nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── vi.hoisted: garante que as fns mock estão disponíveis antes do vi.mock ────

const { mockOrder, mockEq2, mockEq1, mockSelect, mockFrom, mockRpc } = vi.hoisted(() => {
  const mockOrder  = vi.fn().mockResolvedValue({ data: [], error: null })
  const mockEq2    = vi.fn(() => ({ order: mockOrder }))
  const mockEq1    = vi.fn(() => ({ eq: mockEq2 }))
  const mockSelect = vi.fn(() => ({ eq: mockEq1 }))
  const mockFrom   = vi.fn(() => ({ select: mockSelect }))
  // rpc é chamado por syncInstancesStatusBackground — devolvemos sucesso silencioso
  const mockRpc    = vi.fn().mockResolvedValue({ data: null, error: null })
  return { mockOrder, mockEq2, mockEq1, mockSelect, mockFrom, mockRpc }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc:  mockRpc,
  },
}))

// ── Import após mock ──────────────────────────────────────────────────────────

import { chatApi } from '../chatApi'

// ── Constantes esperadas ──────────────────────────────────────────────────────

const EXPECTED_SELECT =
  'id, instance_name, phone_number, profile_name, profile_picture_url, status, assigned_user_id, available_to_all'

const REQUIRED_FIELDS = [
  'id',
  'instance_name',
  'phone_number',
  'profile_name',
  'profile_picture_url',
  'status',
  'assigned_user_id',
  'available_to_all',
]

beforeEach(() => {
  vi.clearAllMocks()
  mockOrder.mockResolvedValue({ data: [], error: null })
  mockEq2.mockReturnValue({ order: mockOrder })
  mockEq1.mockReturnValue({ eq: mockEq2 })
  mockSelect.mockReturnValue({ eq: mockEq1 })
  mockFrom.mockReturnValue({ select: mockSelect })
  mockRpc.mockResolvedValue({ data: null, error: null })
})

// ── Testes ────────────────────────────────────────────────────────────────────

describe('chatApi.getCompanyInstances — MVP3C.3 Etapa 0 (SELECT explícito)', () => {

  it('CI-01: select usa lista explícita — NÃO usa SELECT *', async () => {
    await chatApi.getCompanyInstances('company-test-001')
    expect(mockSelect).toHaveBeenCalledWith(EXPECTED_SELECT)
    const actualSelectArg: string = mockSelect.mock.calls[0][0]
    expect(actualSelectArg).not.toBe('*')
    expect(actualSelectArg.trim()).not.toBe('')
  })

  it('CI-02: provider_token NÃO está na lista de campos solicitados', async () => {
    await chatApi.getCompanyInstances('company-test-001')
    const actualSelectArg: string = mockSelect.mock.calls[0][0]
    expect(actualSelectArg).not.toContain('provider_token')
  })

  it('CI-03: todos os campos necessários estão presentes na seleção', async () => {
    await chatApi.getCompanyInstances('company-test-001')
    const actualSelectArg: string = mockSelect.mock.calls[0][0]
    for (const field of REQUIRED_FIELDS) {
      expect(actualSelectArg).toContain(field)
    }
  })

  it('CI-04: filtro aplicado — company_id e status="connected"', async () => {
    await chatApi.getCompanyInstances('company-test-001')
    expect(mockEq1).toHaveBeenCalledWith('company_id', 'company-test-001')
    expect(mockEq2).toHaveBeenCalledWith('status', 'connected')
  })
})

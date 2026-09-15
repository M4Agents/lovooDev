// @vitest-environment jsdom
// =============================================================================
// src/components/Settings/__tests__/CompaniesPanel.test.tsx
//
// Testes de integração para companies.meta_whatsapp_enabled (E5).
// Escopo restrito: visibilidade, toggle, auth, isolamento do save genérico.
//
// Infraestrutura: Vitest · @testing-library/react · jsdom
// Nota: @testing-library/jest-dom não instalado — usa DOM props diretamente.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { CompaniesPanel } from '../CompaniesPanel'
import type { ClientCompany } from '../companiesTypes'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const COMPANY_B_ID = 'bbbbbbbb-0000-0000-0000-000000000002'

function makeCompany(id: string, name: string, metaEnabled?: boolean): ClientCompany {
  return {
    id,
    name,
    domain:                null,
    status:                'active',
    user_id:               'user-001',
    parent_company_id:     'parent-001',
    company_type:          'client',
    created_at:            '2026-01-01T00:00:00Z',
    updated_at:            '2026-01-01T00:00:00Z',
    meta_whatsapp_enabled: metaEnabled,
  }
}

const COMPANY_A = makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)
const COMPANY_B = makeCompany(COMPANY_B_ID, 'Empresa Beta',  false)

// ── Toggle stub — data-testid + data-checked para queries determinísticas ─────

vi.mock('../../ui/Toggle', () => ({
  Toggle: ({ checked, onChange, disabled }: {
    checked:  boolean
    onChange: (v: boolean) => void
    disabled: boolean
  }) => (
    <button
      type="button"
      data-testid="meta-wa-toggle"
      data-checked={String(checked)}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
    />
  ),
}))

// ── CompanyCard stub — expõe onEdit como botão nomeado ────────────────────────

vi.mock('../CompanyCard', () => ({
  CompanyCard: ({ comp, onEdit }: { comp: ClientCompany; onEdit: (c: ClientCompany) => void }) => (
    <div data-testid={`card-${comp.id}`}>
      <span>{comp.name}</span>
      <button onClick={() => onEdit(comp)}>Editar {comp.name}</button>
    </div>
  ),
  daysUntil:  () => null,
  formatDate: (d: string) => d,
}))

vi.mock('../CompaniesFilter', () => ({ CompaniesFilter: () => null }))

// ── Boundaries de negócio ─────────────────────────────────────────────────────

vi.mock('../../../hooks/useAccessControl', () => ({ useAccessControl: vi.fn() }))
vi.mock('../../../contexts/AuthContext',   () => ({ useAuth: () => ({ impersonateUser: vi.fn() }) }))
vi.mock('../../../services/api',           () => ({ api: { getAllCompanies: vi.fn() } }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}))

import { useAccessControl } from '../../../hooks/useAccessControl'
import { api }              from '../../../services/api'
import { supabase }         from '../../../lib/supabase'

// ── Fetch global ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(global as any).fetch = mockFetch

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDbChain(data: unknown = []) {
  const result = { data, error: null }
  const chain: Record<string, unknown> = {
    in:    vi.fn().mockResolvedValue(result),
    order: vi.fn().mockResolvedValue(result),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(chain as any).select = vi.fn().mockReturnValue(chain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(chain as any).eq     = vi.fn().mockReturnValue(chain)
  return chain
}

function setupAC({ canAccess = true, canProvision = true } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAccessControl).mockReturnValue({
    canAccessCompanies:       canAccess,
    canProvisionMetaWhatsApp: canProvision,
    isSaaSAdmin:              true,
    isSystemAdmin:            false,
  } as any)
}

function setupLoad(companies: ClientCompany[]) {
  vi.mocked(api.getAllCompanies).mockResolvedValue(companies as any)
  vi.mocked(supabase.from).mockReturnValue(makeDbChain([]) as any)
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'mock-token-123' } }, error: null,
  } as any)
}

async function renderAndLoad(companies: ClientCompany[]) {
  setupLoad(companies)
  render(<CompaniesPanel />)
  if (companies.length > 0) await screen.findByText(companies[0].name)
}

function openEdit(companyName: string) {
  fireEvent.click(screen.getByRole('button', { name: `Editar ${companyName}` }))
}

function makeToggleOk(companyId: string, enabled: boolean) {
  return { ok: true, json: () => Promise.resolve({ success: true, company_id: companyId, meta_whatsapp_enabled: enabled }) }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

afterEach(() => { cleanup(); vi.clearAllMocks() })

beforeEach(() => {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/admin/trials/info')) return Promise.resolve({ ok: false })
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
})

// =============================================================================

describe('CompaniesPanel — Meta WhatsApp toggle (E5)', () => {

  // ── A. Visibilidade ──────────────────────────────────────────────────────

  describe('A — Visibilidade', () => {
    it('TC-A01: canProvisionMetaWhatsApp=false → seção Meta ausente', async () => {
      setupAC({ canProvision: false })
      await renderAndLoad([COMPANY_A])
      openEdit('Empresa Alpha')

      expect(screen.queryByText('Integrações')).toBeNull()
      expect(screen.queryByTestId('meta-wa-toggle')).toBeNull()
    })

    it('TC-A02: canProvision=true, meta_enabled=false → toggle desligado', async () => {
      setupAC({ canProvision: true })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')

      const t = screen.getByTestId('meta-wa-toggle') as HTMLButtonElement
      expect(t.getAttribute('data-checked')).toBe('false')
    })

    it('TC-A03: canProvision=true, meta_enabled=true → toggle ligado', async () => {
      setupAC({ canProvision: true })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', true)])
      openEdit('Empresa Alpha')

      expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('true')
    })
  })

  // ── B. Habilitar ─────────────────────────────────────────────────────────

  describe('B — Habilitar (false → true)', () => {
    it('TC-B01: toggle false→true envia POST com method/headers/body exatos', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))     return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))       return Promise.resolve(makeToggleOk(COMPANY_A_ID, true))
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)
      })

      const [url, opts] = mockFetch.mock.calls.find(c => c[0].includes('toggle-meta-whatsapp'))!
      expect(url).toBe('/api/admin/companies/toggle-meta-whatsapp')
      expect(opts.method).toBe('POST')
      expect(opts.headers['Content-Type']).toBe('application/json')
      expect(opts.headers['Authorization']).toBe('Bearer mock-token-123')

      const body = JSON.parse(opts.body)
      expect(body).toEqual({ company_id: COMPANY_A_ID, enabled: true })
      expect(Object.keys(body).sort()).toEqual(['company_id', 'enabled'].sort())
    })
  })

  // ── C. Desabilitar ────────────────────────────────────────────────────────

  describe('C — Desabilitar (true → false)', () => {
    it('TC-C01: toggle true→false envia enabled=false no body', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))     return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))       return Promise.resolve(makeToggleOk(COMPANY_A_ID, false))
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', true)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)
      })
      const [, opts] = mockFetch.mock.calls.find(c => c[0].includes('toggle-meta-whatsapp'))!
      expect(JSON.parse(opts.body)).toEqual({ company_id: COMPANY_A_ID, enabled: false })
    })
  })

  // ── D. Loading / Concorrência ─────────────────────────────────────────────

  describe('D — Loading / Concorrência', () => {
    it('TC-D01: durante request toggle disabled; segunda chamada ignorada; loading liberado ao resolver', async () => {
      setupAC({ canProvision: true })
      let resolveToggle!: (v: unknown) => void
      const deferred = new Promise<unknown>(res => { resolveToggle = res })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return deferred
        return Promise.resolve({ ok: false })
      })

      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      // Aguarda fetch ser chamado (1x) e toggle ficar disabled
      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)
      })
      await waitFor(() => {
        expect((screen.getByTestId('meta-wa-toggle') as HTMLButtonElement).disabled).toBe(true)
      })

      // Segundo click em toggle disabled → ignorado pelo mock (onClick guard !disabled)
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))
      expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)

      // Resolver → loading liberado
      await act(async () => {
        resolveToggle(makeToggleOk(COMPANY_A_ID, true))
      })
      await waitFor(() => {
        expect((screen.getByTestId('meta-wa-toggle') as HTMLButtonElement).disabled).toBe(false)
      })
    })
  })

  // ── E. Sucesso ─────────────────────────────────────────────────────────────

  describe('E — Sucesso', () => {
    it('TC-E01: resposta 200 válida enabled=true → toggle ligado, sem erro', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve(makeToggleOk(COMPANY_A_ID, true))
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('false')

      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('true'))
      expect(screen.queryByText(/Erro ao atualizar/)).toBeNull()
    })

    it('TC-E02: resposta 200 válida enabled=false → toggle desligado, sem erro', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve(makeToggleOk(COMPANY_A_ID, false))
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', true)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('false'))
      expect(screen.queryByText(/Erro ao atualizar/)).toBeNull()
    })
  })

  // ── F. Fail Closed ────────────────────────────────────────────────────────

  describe('F — Fail Closed', () => {
    it('TC-F01: HTTP 500 → valor anterior preservado, erro visível, loading liberado', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => screen.getByText('Erro ao atualizar configuração. Tente novamente.'))
      const t = screen.getByTestId('meta-wa-toggle') as HTMLButtonElement
      expect(t.getAttribute('data-checked')).toBe('false')
      expect(t.disabled).toBe(false)
    })

    it('TC-F02: 200 JSON malformado (sem success) → erro, valor anterior preservado', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => screen.getByText('Erro ao atualizar configuração. Tente novamente.'))
      expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('false')
    })

    it('TC-F03: 200 com company_id de outra empresa → erro, valor anterior preservado', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp')) {
          return Promise.resolve({
            ok: true, json: () => Promise.resolve({ success: true, company_id: 'OUTRO-ID', meta_whatsapp_enabled: true }),
          })
        }
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => screen.getByText('Erro ao atualizar configuração. Tente novamente.'))
      expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('false')
    })

    it('TC-F04: 200 com meta_whatsapp_enabled ≠ solicitado → erro, valor anterior preservado', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp')) {
          // Solicitado enabled=true, servidor confirma false (inconsistência)
          return Promise.resolve({
            ok: true, json: () => Promise.resolve({ success: true, company_id: COMPANY_A_ID, meta_whatsapp_enabled: false }),
          })
        }
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle')) // solicita true

      await waitFor(() => screen.getByText('Erro ao atualizar configuração. Tente novamente.'))
      expect(screen.getByTestId('meta-wa-toggle').getAttribute('data-checked')).toBe('false')
    })
  })

  // ── G. Autenticação ───────────────────────────────────────────────────────

  describe('G — Autenticação', () => {
    it('TC-G01: getSession sem token → fetch não chamado, erro exibido, loading liberado', async () => {
      setupAC({ canProvision: true })
      // getSession retorna null em TODOS os calls (fetchTrialInfo sai silenciosamente; toggle falha)
      vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as any)
      vi.mocked(api.getAllCompanies).mockResolvedValue([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)] as any)
      vi.mocked(supabase.from).mockReturnValue(makeDbChain([]) as any)

      render(<CompaniesPanel />)
      await screen.findByText('Empresa Alpha')
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => screen.getByText('Erro interno ao processar operação.'))

      expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(0)
      const t = screen.getByTestId('meta-wa-toggle') as HTMLButtonElement
      expect(t.getAttribute('data-checked')).toBe('false')
      expect(t.disabled).toBe(false)
    })
  })

  // ── H. Isolamento do Save genérico ───────────────────────────────────────

  describe('H — Isolamento do Save genérico', () => {
    it('TC-H01: toggle Meta não chama /api/companies/update', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve(makeToggleOk(COMPANY_A_ID, true))
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', false)])
      openEdit('Empresa Alpha')
      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)
      })
      expect(mockFetch.mock.calls.filter(c => c[0].includes('/api/companies/update')).length).toBe(0)
    })

    it('TC-H02: save genérico não envia meta_whatsapp_enabled no body', async () => {
      setupAC({ canProvision: true })
      // Empresa com meta_whatsapp_enabled=true — não deve vazarpara update
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('/api/companies/update'))    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        return Promise.resolve({ ok: false })
      })
      await renderAndLoad([makeCompany(COMPANY_A_ID, 'Empresa Alpha', true)])
      openEdit('Empresa Alpha')

      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('/api/companies/update')).length).toBe(1)
      })
      const [, opts] = mockFetch.mock.calls.find(c => c[0].includes('/api/companies/update'))!
      const body = JSON.parse(opts.body)
      expect('meta_whatsapp_enabled' in (body?.updates ?? {})).toBe(false)
    })
  })

  // ── I. Empresa correta ────────────────────────────────────────────────────

  describe('I — Empresa correta no body', () => {
    it('TC-I01: editar empresa B → body.company_id === B.id, nunca A.id', async () => {
      setupAC({ canProvision: true })
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/trials/info'))   return Promise.resolve({ ok: false })
        if (url.includes('toggle-meta-whatsapp'))     return Promise.resolve(makeToggleOk(COMPANY_B_ID, true))
        return Promise.resolve({ ok: false })
      })

      await renderAndLoad([COMPANY_A, COMPANY_B])
      await screen.findByText('Empresa Beta') // garantir que ambas estão no DOM
      openEdit('Empresa Beta')

      fireEvent.click(screen.getByTestId('meta-wa-toggle'))

      await waitFor(() => {
        expect(mockFetch.mock.calls.filter(c => c[0].includes('toggle-meta-whatsapp')).length).toBe(1)
      })
      const [, opts] = mockFetch.mock.calls.find(c => c[0].includes('toggle-meta-whatsapp'))!
      const body = JSON.parse(opts.body)
      expect(body.company_id).toBe(COMPANY_B_ID)
      expect(body.company_id).not.toBe(COMPANY_A_ID)
    })
  })
})

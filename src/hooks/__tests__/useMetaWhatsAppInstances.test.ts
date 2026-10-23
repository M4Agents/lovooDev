// @vitest-environment jsdom
// =============================================================================
// useMetaWhatsAppInstances — isolamento de GET stale (MVP5.A4.2)
// Mocks apenas. Sem Graph, Supabase WRITE ou desconexão real.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useMetaWhatsAppInstances } from '../useMetaWhatsAppInstances'
import type { MetaWhatsAppInstance } from '../../types/meta-whatsapp'

vi.mock('../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    getInstances: vi.fn(),
  },
}))

import { metaWhatsAppApi } from '../../services/metaWhatsAppApi'

const COMPANY_A = 'aaaa0000-0000-0000-0000-000000000001'
const COMPANY_B = 'bbbb0000-0000-0000-0000-000000000002'

function makeInstance(id: string, displayName: string): MetaWhatsAppInstance {
  return {
    id,
    phone_number_id: '000000000000',
    waba_id:         '111111111111',
    display_name:    displayName,
    phone_number:    '+55 11 90000-0000',
    verified_name:   displayName,
    status:          'connected',
    created_at:      '2026-01-01T00:00:00.000Z',
    updated_at:      '2026-01-01T00:00:00.000Z',
  }
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

type Snapshot = {
  companyId: string | undefined
  names: string[]
  loading: boolean
  error: string | null
}

function recordHook(snapshots: Snapshot[]) {
  return ({ companyId }: { companyId: string | undefined }) => {
    const result = useMetaWhatsAppInstances(companyId)
    snapshots.push({
      companyId,
      names:   result.instances.map((item) => item.display_name ?? ''),
      loading: result.loading,
      error:   result.error,
    })
    return result
  }
}

describe('isolamento de GET entre empresas', () => {
  it('carregamento normal apresenta somente instâncias da empresa A', async () => {
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a', 'Empresa A')])

    const { result } = renderHook(
      ({ companyId }: { companyId: string | undefined }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A as string | undefined } },
    )

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa A' }),
      ])
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.instances.some((item) => item.display_name === 'Empresa B')).toBe(false)
  })

  it('primeiro render após A→B não expõe instâncias de A', async () => {
    let resolveB: (value: MetaWhatsAppInstance[]) => void
    const snapshots: Snapshot[] = []

    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a', 'Empresa A')])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve }))

    const { rerender } = renderHook(recordHook(snapshots), {
      initialProps: { companyId: COMPANY_A as string | undefined },
    })

    await waitFor(() => {
      expect(snapshots.some((snap) => snap.names.includes('Empresa A'))).toBe(true)
    })

    const beforeSwitch = snapshots.length
    rerender({ companyId: COMPANY_B })

    const firstRenderWithB = snapshots.slice(beforeSwitch).find((snap) => snap.companyId === COMPANY_B)
    expect(firstRenderWithB).toBeDefined()
    expect(firstRenderWithB?.names).not.toContain('Empresa A')
    expect(firstRenderWithB?.loading).toBe(true)
    expect(firstRenderWithB?.error).toBeNull()
    expect(resolveB!).toBeTypeOf('function')
  })

  it('enquanto o GET de B está pendente, a lista de A não fica disponível', async () => {
    let resolveB: (value: MetaWhatsAppInstance[]) => void
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a', 'Empresa A')])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve }))

    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string | undefined }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A as string | undefined } },
    )

    await waitFor(() => {
      expect(result.current.instances.some((item) => item.display_name === 'Empresa A')).toBe(true)
    })

    rerender({ companyId: COMPANY_B })

    expect(result.current.instances).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(resolveB!).toBeTypeOf('function')
  })

  it('resposta antiga da empresa A não substitui a lista da empresa B', async () => {
    let resolveA: (value: MetaWhatsAppInstance[]) => void
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve }))
      .mockResolvedValueOnce([makeInstance('inst-b', 'Empresa B')])

    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A } },
    )

    await waitFor(() => {
      expect(metaWhatsAppApi.getInstances).toHaveBeenCalledWith(COMPANY_A)
    })

    rerender({ companyId: COMPANY_B })

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa B' }),
      ])
    })

    resolveA!([makeInstance('inst-a', 'Empresa A')])

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa B' }),
      ])
    })
    expect(result.current.instances.some((item) => item.display_name === 'Empresa A')).toBe(false)
    expect(metaWhatsAppApi.getInstances).toHaveBeenCalledWith(COMPANY_B)
  })

  it('troca A → B → A não reaplica respostas obsoletas', async () => {
    let resolveA1: (value: MetaWhatsAppInstance[]) => void
    let resolveB: (value: MetaWhatsAppInstance[]) => void
    let resolveA2: (value: MetaWhatsAppInstance[]) => void

    vi.mocked(metaWhatsAppApi.getInstances)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA1 = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA2 = resolve }))

    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string | undefined }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A as string | undefined } },
    )

    await waitFor(() => {
      expect(metaWhatsAppApi.getInstances).toHaveBeenCalledWith(COMPANY_A)
    })

    rerender({ companyId: COMPANY_B })
    rerender({ companyId: COMPANY_A })

    resolveA1!([makeInstance('inst-a1', 'Empresa A antiga')])
    resolveB!([makeInstance('inst-b', 'Empresa B')])
    resolveA2!([makeInstance('inst-a2', 'Empresa A atual')])

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa A atual' }),
      ])
    })
    expect(result.current.instances.some((item) => item.display_name === 'Empresa A antiga')).toBe(false)
    expect(result.current.instances.some((item) => item.display_name === 'Empresa B')).toBe(false)
  })

  it('refresh na mesma empresa recarrega sem reutilizar outra empresa', async () => {
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a1', 'Empresa A')])
      .mockResolvedValueOnce([makeInstance('inst-a2', 'Empresa A atualizada')])

    const { result } = renderHook(
      ({ companyId }: { companyId: string | undefined }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A as string | undefined } },
    )

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa A' }),
      ])
    })

    result.current.refresh()

    await waitFor(() => {
      expect(result.current.instances).toEqual([
        expect.objectContaining({ display_name: 'Empresa A atualizada' }),
      ])
    })
    expect(metaWhatsAppApi.getInstances).toHaveBeenCalledTimes(2)
    expect(metaWhatsAppApi.getInstances).toHaveBeenNthCalledWith(1, COMPANY_A)
    expect(metaWhatsAppApi.getInstances).toHaveBeenNthCalledWith(2, COMPANY_A)
  })

  it('erro de B não reapresenta a lista antiga de A', async () => {
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a', 'Empresa A')])
      .mockRejectedValueOnce(new Error('Meta WhatsApp não habilitado para esta empresa'))

    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string | undefined }) => useMetaWhatsAppInstances(companyId),
      { initialProps: { companyId: COMPANY_A as string | undefined } },
    )

    await waitFor(() => {
      expect(result.current.instances.some((item) => item.display_name === 'Empresa A')).toBe(true)
    })

    rerender({ companyId: COMPANY_B })

    await waitFor(() => {
      expect(result.current.error).toBe('Meta WhatsApp não habilitado para esta empresa')
    })
    expect(result.current.instances).toEqual([])
    expect(result.current.instances.some((item) => item.display_name === 'Empresa A')).toBe(false)
  })

  it('companyId ausente não apresenta instâncias da empresa anterior', async () => {
    const snapshots: Snapshot[] = []
    vi.mocked(metaWhatsAppApi.getInstances)
      .mockResolvedValueOnce([makeInstance('inst-a', 'Empresa A')])

    const { rerender } = renderHook(recordHook(snapshots), {
      initialProps: { companyId: COMPANY_A as string | undefined },
    })

    await waitFor(() => {
      expect(snapshots.some((snap) => snap.names.includes('Empresa A'))).toBe(true)
    })

    const beforeClear = snapshots.length
    rerender({ companyId: undefined })

    const firstRenderWithoutCompany = snapshots.slice(beforeClear).find((snap) => snap.companyId === undefined)
    expect(firstRenderWithoutCompany).toBeDefined()
    expect(firstRenderWithoutCompany?.names).not.toContain('Empresa A')
    expect(firstRenderWithoutCompany?.loading).toBe(false)
    expect(firstRenderWithoutCompany?.error).toBeNull()
  })
})

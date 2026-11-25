/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogItemMediaEditor } from '../CatalogItemMediaEditor'
import { useCatalogUploadGuard, type CatalogUploadAttempt } from '../useCatalogUploadGuard'
import { CATALOG_IMAGE_ACCEPT, CATALOG_MEDIA_ACCEPT } from '../../../services/catalogLibraryUpload'

const { getSession, onAuthStateChange, upload, addLink } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  upload: vi.fn(),
  addLink: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

vi.mock('../../../services/catalogLibraryUpload', async () => {
  const actual = await vi.importActual<typeof import('../../../services/catalogLibraryUpload')>('../../../services/catalogLibraryUpload')
  return { ...actual, uploadCatalogMediaToLibrary: (...args: unknown[]) => upload(...args) }
})

vi.mock('../../../services/catalogMediaApi', () => ({
  CATALOG_MEDIA_USAGE_ROLES: ['presentation', 'demo', 'proof', 'testimonial', 'before_after'],
  catalogMediaApi: {
    listResolved: vi.fn(async () => []),
    listLibraryAssetsForPicker: vi.fn(async () => []),
    addLink: (...args: unknown[]) => addLink(...args),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

type AuthListener = (event: string, session: { user?: { id?: string } } | null) => void

const COMPANY = 'bbbb0000-0000-4000-8000-000000000002'
const OTHER = 'dddd0000-0000-4000-8000-000000000004'
const USER = 'aaaa0000-0000-4000-8000-000000000001'
const ITEM = 'item-1'

function renderEditor(companyId = COMPANY, sourceType: 'product' | 'service' = 'product', sourceId = ITEM) {
  return render(
    <MemoryRouter>
      <CatalogItemMediaEditor companyId={companyId} sourceType={sourceType} sourceId={sourceId} />
    </MemoryRouter>
  )
}

async function choose(files: File[]) {
  const input = await waitFor(() => {
    const node = document.querySelector('input[type="file"]')
    if (!node) throw new Error('seletor ausente')
    return node as HTMLInputElement
  })
  fireEvent.change(input, { target: { files } })
}

describe('proteção de contexto do upload do catálogo', () => {
  beforeEach(() => {
    upload.mockReset()
    addLink.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: USER } } }, error: null })
    onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    addLink.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('usa a allowlist no seletor e envia produto e serviço em sequência', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    upload.mockImplementation((_file: File, _company: string, sourceType: string) => new Promise((resolve) => {
      resolvers.push(() => resolve({
        ok: true,
        data: { id: `id-${resolvers.length}`, file_type: 'image', preview_url: 'https://example-bucket.s3.us-east-1.amazonaws.com/k' },
      }))
      expect(sourceType).toBe('product')
    }))
    const view = renderEditor()
    const input = await waitFor(() => {
      const node = document.querySelector('input[type="file"]')
      if (!node) throw new Error('seletor ausente')
      return node
    })
    expect(input.getAttribute('accept')).toBe(CATALOG_MEDIA_ACCEPT)
    await choose([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ])
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    resolvers[0](undefined)
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(addLink).toHaveBeenCalledTimes(1)
    resolvers[1](undefined)
    await waitFor(() => expect(addLink).toHaveBeenCalledTimes(2))
    expect(addLink.mock.calls[0][0].productId).toBe(ITEM)
    expect(addLink.mock.calls[0][0].serviceId).toBeNull()

    upload.mockImplementation((_file: File, _company: string, sourceType: string) => {
      expect(sourceType).toBe('service')
      return Promise.resolve({ ok: true, data: { id: 'svc-1', file_type: 'video' } })
    })
    view.rerender(
      <MemoryRouter>
        <CatalogItemMediaEditor companyId={COMPANY} sourceType="service" sourceId={ITEM} />
      </MemoryRouter>
    )
    await choose([new File(['c'], 'c.mp4', { type: 'video/mp4' })])
    await waitFor(() => expect(addLink).toHaveBeenCalled())
    const linkCalls = addLink.mock.calls
    const serviceCall = linkCalls[linkCalls.length - 1]?.[0]
    if (!serviceCall) throw new Error('vínculo ausente')
    expect(serviceCall.serviceId).toBe(ITEM)
    expect(serviceCall.productId).toBeNull()
  })

  it('não vincula nem limpa um envio novo quando a empresa muda', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    upload.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve)
    }))
    const view = renderEditor()
    await choose([new File(['a'], 'a.png', { type: 'image/png' })])
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    const firstSignal = upload.mock.calls[0][3] as AbortSignal
    view.rerender(
      <MemoryRouter>
        <CatalogItemMediaEditor companyId={OTHER} sourceType="product" sourceId={ITEM} />
      </MemoryRouter>
    )
    await waitFor(() => expect(firstSignal.aborted).toBe(true))
    await choose([new File(['b'], 'b.png', { type: 'image/png' })])
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(upload.mock.calls[1][1]).toBe(OTHER)
    resolvers[0]({ ok: true, data: { id: 'late', file_type: 'image' } })
    await waitFor(() => expect(screen.getByText('Enviando e vinculando…')).toBeTruthy())
    expect(addLink).not.toHaveBeenCalled()

    resolvers[1]({ ok: true, data: { id: 'new', file_type: 'image' } })
    await waitFor(() => expect(addLink).toHaveBeenCalledTimes(1))
    expect(addLink.mock.calls[0][0].companyId).toBe(OTHER)
    expect(screen.queryByText('Enviando e vinculando…')).toBeNull()
  })

  it('preserva a nova tentativa de vínculo sem reenviar o arquivo', async () => {
    upload.mockResolvedValue({ ok: true, data: { id: 'asset-1', file_type: 'image' } })
    addLink.mockRejectedValueOnce(new Error('falha de vínculo'))
    renderEditor()
    await choose([new File(['a'], 'a.png', { type: 'image/png' })])
    const retry = await screen.findByRole('button', { name: 'Tentar vincular novamente' })
    expect(upload).toHaveBeenCalledTimes(1)
    addLink.mockResolvedValue(undefined)
    fireEvent.click(retry)
    await waitFor(() => expect(addLink).toHaveBeenCalledTimes(2))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(addLink.mock.calls[1][0].libraryAssetId).toBe('asset-1')
  })

  it('troca de usuário aborta e não vincula a resposta atrasada', async () => {
    const listeners: AuthListener[] = []
    onAuthStateChange.mockImplementation((callback: AuthListener) => {
      listeners.push(callback)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    let resolveUpload: (value: unknown) => void = () => {}
    upload.mockImplementation((_f: File, _c: string, _s: string, signal: AbortSignal) => new Promise((resolve) => {
      resolveUpload = resolve
      signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
    }))
    renderEditor()
    await choose([new File(['a'], 'a.png', { type: 'image/png' })])
    await waitFor(() => expect(upload).toHaveBeenCalled())
    const listener = listeners[0]
    if (!listener) throw new Error('listener ausente')
    listener('SIGNED_IN', { user: { id: OTHER } })
    await waitFor(() => expect((upload.mock.calls[0][3] as AbortSignal).aborted).toBe(true))
    resolveUpload({ ok: true, data: { id: 'late', file_type: 'image' } })
    expect(addLink).not.toHaveBeenCalled()
  })

  it('fechar o editor aborta o envio e não vincula a resposta atrasada', async () => {
    let resolveUpload: (value: unknown) => void = () => {}
    upload.mockImplementation((_f: File, _c: string, _s: string, signal: AbortSignal) => new Promise((resolve) => {
      resolveUpload = resolve
      signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
    }))
    const view = renderEditor()
    await choose([new File(['a'], 'a.png', { type: 'image/png' })])
    await waitFor(() => expect(upload).toHaveBeenCalled())
    view.unmount()
    expect((upload.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    resolveUpload({ ok: true, data: { id: 'late', file_type: 'image' } })
    expect(addLink).not.toHaveBeenCalled()
  })

  it('tentativa sem sessão não aborta o envio em andamento nem prende o loading', async () => {
    let resolveUpload: (value: unknown) => void = () => {}
    upload.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve
    }))
    renderEditor()
    await choose([new File(['a'], 'a.png', { type: 'image/png' })])
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    const firstSignal = upload.mock.calls[0][3] as AbortSignal
    expect(screen.getByText('Enviando e vinculando…')).toBeTruthy()

    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    await choose([new File(['b'], 'b.png', { type: 'image/png' })])
    await waitFor(() => expect(screen.getByText('Sessão inválida ou expirada.')).toBeTruthy())
    expect(firstSignal.aborted).toBe(false)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Enviando e vinculando…')).toBeTruthy()

    resolveUpload({ ok: true, data: { id: 'asset-1', file_type: 'image' } })
    await waitFor(() => expect(addLink).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Enviando e vinculando…')).toBeNull()
    expect(firstSignal.aborted).toBe(false)
  })
})

describe('guarda compartilhado da imagem principal e do lote', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: USER } } }, error: null })
    onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
  })

  it('troca de empresa, usuário ou desmontagem não deixa a operação antiga dona do loading', () => {
    const listeners: AuthListener[] = []
    onAuthStateChange.mockImplementation((callback: AuthListener) => {
      listeners.push(callback)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    const onInvalidate = vi.fn()
    const hook = renderHook(
      ({ companyId }: { companyId: string }) => useCatalogUploadGuard({ companyId, sourceId: ITEM }, onInvalidate),
      { initialProps: { companyId: COMPANY } }
    )
    const attempts: CatalogUploadAttempt[] = []
    act(() => {
      attempts.push(hook.result.current.begin(USER))
    })
    const first = attempts[0]
    if (!first) throw new Error('tentativa ausente')
    act(() => {
      hook.rerender({ companyId: OTHER })
    })
    expect(first.signal.aborted).toBe(true)
    expect(hook.result.current.ownsLoading(first.op)).toBe(false)
    expect(hook.result.current.matches(first)).toBe(false)
    expect(onInvalidate).toHaveBeenCalled()

    act(() => {
      attempts.push(hook.result.current.begin(USER))
    })
    const second = attempts[1]
    if (!second) throw new Error('tentativa ausente')
    expect(hook.result.current.ownsLoading(second.op)).toBe(true)
    expect(hook.result.current.ownsLoading(first.op)).toBe(false)

    const listener = listeners[0]
    if (!listener) throw new Error('listener ausente')
    act(() => {
      listener('SIGNED_IN', { user: { id: OTHER } })
    })
    expect(second.signal.aborted).toBe(true)
    expect(hook.result.current.matches(second)).toBe(false)

    act(() => {
      attempts.push(hook.result.current.begin(OTHER))
    })
    const third = attempts[2]
    if (!third) throw new Error('tentativa ausente')
    act(() => {
      hook.unmount()
    })
    expect(third.signal.aborted).toBe(true)
    expect(hook.result.current.ownsLoading(third.op)).toBe(false)
  })
})

describe('seletor da imagem principal', () => {
  it('restringe produto e serviço aos MIME de imagem', () => {
    expect(CATALOG_IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/gif,image/webp')
    expect(CATALOG_MEDIA_ACCEPT).toContain('video/mp4')
    expect(CATALOG_IMAGE_ACCEPT).not.toContain('video/')
    expect(CATALOG_IMAGE_ACCEPT).not.toContain('heic')
  })
})

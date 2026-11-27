// @vitest-environment jsdom
// Biblioteca só consulta chat_messages quando a capability do painel permite.

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { session: { access_token: string; user: { id: string } } | null } }> => ({
    data: { session: null },
  })),
)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../MediaLibrary/DirectS3Upload', () => ({
  DirectS3Upload: () => null,
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: mockFrom, auth: { getSession: mockGetSession } },
}))

import { BibliotecaV2 } from '../BibliotecaV2'

function queryResult() {
  const api: Record<string, unknown> = {}
  const done = Promise.resolve({ data: [], error: null, count: 0 })
  for (const method of ['select', 'eq', 'not', 'order', 'limit', 'in', 'lt', 'delete']) {
    api[method] = vi.fn(() => api)
  }
  api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    done.then(resolve, reject)
  return api
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BibliotecaV2 — chat_messages só com a capability', () => {
  it('não consulta chat_messages quando conversationMediaEnabled é false', async () => {
    mockFrom.mockImplementation(() => queryResult())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { folders: [] } }),
    }))

    render(
      <BibliotecaV2
        conversationId="conv-uazapi-aaa"
        companyId="company-test-001"
        conversationMediaEnabled={false}
      />
    )

    await waitFor(() => {
      expect(mockFrom).not.toHaveBeenCalled()
    })
  })

  it('consulta chat_messages quando a capability permanece no padrão', async () => {
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('chat_messages')
      return queryResult()
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { folders: [] } }),
    }))

    render(
      <BibliotecaV2
        conversationId="conv-uazapi-aaa"
        companyId="company-test-001"
      />
    )

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('chat_messages')
    })
  })
})

const COMPANY_ID = 'company-test-001'
const OTHER_COMPANY = 'company-test-002'
const FOLDER_ID = 'folder-test-001'
const TOKEN = 'session-access-token'
const USER_ID = 'user-test-001'
const OTHER_USER = 'user-test-002'

function folderResponse(companyId = COMPANY_ID) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        folders: [{
          id: FOLDER_ID,
          company_id: companyId,
          name: 'Catalogo',
          path: '/catalogo',
          icon: '📁',
          created_at: '2026-01-01T00:00:00Z',
        }],
      },
    }),
  }
}

function fileResponse(filename: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      data: {
        files: [{
          id: filename,
          original_filename: filename,
          file_type: 'image',
          mime_type: 'image/png',
          file_size: 10,
          preview_url: `https://cdn.example/${filename}`,
          s3_key: `secret/${filename}`,
          created_at: '2026-01-01T00:00:00Z',
          folder_id: FOLDER_ID,
        }],
      },
    }),
  }
}

async function openFolder(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.getByText('biblioteca.tabFolders')).toBeTruthy()
  })
  fireEvent.click(view.getByText('biblioteca.tabFolders'))
  await waitFor(() => {
    expect(view.getByText('Catalogo')).toBeTruthy()
  })
  fireEvent.click(view.getByText('Catalogo'))
}

describe('BibliotecaV2 — Bearer da listagem', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('A/B/D/K: sessão válida envia o Bearer e preserva company_id e folder_id', async () => {
    mockFrom.mockImplementation(() => queryResult())
    mockGetSession.mockResolvedValue({ data: { session: { access_token: TOKEN, user: { id: USER_ID } } } })
    const fetchMock = vi.fn<(input?: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(async (input?: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/files/list')) return fileResponse('comercial.png')
      return folderResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = render(
      <BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />,
    )
    await openFolder(view)

    await waitFor(() => {
      expect(view.getByText('comercial.png')).toBeTruthy()
    })
    const listCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/files/list'))
    expect(String(listCall?.[0])).toContain(`company_id=${COMPANY_ID}`)
    expect(String(listCall?.[0])).toContain(`folder_id=${FOLDER_ID}`)
    expect(listCall?.[1]).toEqual({ headers: { Authorization: `Bearer ${TOKEN}` } })
  })

  it('C/E/F/G/H: sem sessão ou erro HTTP não chama anônimo nem mostra arquivo', async () => {
    mockFrom.mockImplementation(() => queryResult())
    const fetchMock = vi.fn<(input?: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(
      async () => folderResponse(),
    )
    vi.stubGlobal('fetch', fetchMock)
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const missing = render(
      <BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />,
    )
    await openFolder(missing)
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/files/list'))).toBe(false)
    })
    expect(missing.queryByText('comercial.png')).toBeNull()
    cleanup()

    for (const status of [401, 403, 404, 500, 503]) {
      mockGetSession.mockResolvedValue({ data: { session: { access_token: TOKEN, user: { id: USER_ID } } } })
      fetchMock.mockImplementation(async (input?: RequestInfo | URL) => {
        if (String(input).includes('/files/list')) return fileResponse(`erro-${status}.png`, status)
        return folderResponse()
      })
      const view = render(
        <BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />,
      )
      await openFolder(view)
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/files/list'))).toBe(true)
      })
      expect(view.queryByText(`erro-${status}.png`)).toBeNull()
      cleanup()
      fetchMock.mockClear()
    }
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain(TOKEN)
  })

  it('I/J/M/N: resposta da empresa anterior não substitui a lista atual', async () => {
    mockFrom.mockImplementation(() => queryResult())
    mockGetSession.mockResolvedValue({ data: { session: { access_token: TOKEN, user: { id: USER_ID } } } })
    let releaseFirst: (value: unknown) => void = () => {}
    const first = new Promise((resolve) => { releaseFirst = resolve })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/files/list')) return folderResponse()
      if (url.includes(OTHER_COMPANY)) return fileResponse('atual.png')
      return first
    })
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const view = render(
      <BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />,
    )
    await openFolder(view)
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/files/list'))).toBe(true)
    })

    view.rerender(
      <BibliotecaV2 conversationId="conv-1" companyId={OTHER_COMPANY} />,
    )
    await waitFor(() => {
      expect(view.getByText('atual.png')).toBeTruthy()
    })
    releaseFirst(fileResponse('antiga.png'))
    await waitFor(() => {
      expect(view.queryByText('antiga.png')).toBeNull()
    })
    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('meta_whatsapp_enabled')
  })

  it('C/M/N: token renovado do mesmo usuário entra; logout ou outro usuário durante o json não entra', async () => {
    mockFrom.mockImplementation(() => queryResult())
    let session: { access_token: string; user: { id: string } } | null = {
      access_token: TOKEN,
      user: { id: USER_ID },
    }
    mockGetSession.mockImplementation(async () => ({ data: { session } }))
    let releaseJson: () => void = () => {}
    const jsonGate = new Promise<void>((resolve) => { releaseJson = resolve })
    const listedFile = (filename: string) => ({
      id: filename,
      original_filename: filename,
      file_type: 'image',
      mime_type: 'image/png',
      file_size: 10,
      preview_url: `https://cdn.example/${filename}`,
      s3_key: `secret/${filename}`,
      created_at: '2026-01-01T00:00:00Z',
      folder_id: FOLDER_ID,
    })
    const fetchMock = vi.fn<(input?: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(async (input?: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/files/list')) return folderResponse()
      return {
        ok: true,
        status: 200,
        json: async () => {
          await jsonGate
          return { data: { files: [listedFile('renovado.png')] } }
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const view = render(<BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />)
    await openFolder(view)
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/files/list'))).toBe(true)
    })
    const listCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/files/list'))
    expect(listCall?.[1]).toEqual({ headers: { Authorization: `Bearer ${TOKEN}` } })
    session = { access_token: 'renewed-token', user: { id: USER_ID } }
    releaseJson()
    await waitFor(() => {
      expect(view.getByText('renovado.png')).toBeTruthy()
    })
    cleanup()

    let releaseLogout: () => void = () => {}
    const logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve })
    session = { access_token: TOKEN, user: { id: USER_ID } }
    fetchMock.mockImplementation(async (input?: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/files/list')) return folderResponse()
      return {
        ok: true,
        status: 200,
        json: async () => {
          await logoutGate
          return { data: { files: [listedFile('sair.png')] } }
        },
      }
    })
    const loggedOut = render(<BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />)
    await openFolder(loggedOut)
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/files/list')).length).toBeGreaterThan(1)
    })
    session = null
    releaseLogout()
    await waitFor(() => {
      expect(loggedOut.queryByText('sair.png')).toBeNull()
    })
    cleanup()

    let releaseOther: () => void = () => {}
    const otherGate = new Promise<void>((resolve) => { releaseOther = resolve })
    session = { access_token: TOKEN, user: { id: USER_ID } }
    fetchMock.mockImplementation(async (input?: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/files/list')) return folderResponse()
      return {
        ok: true,
        status: 200,
        json: async () => {
          await otherGate
          return { data: { files: [listedFile('outro-usuario.png')] } }
        },
      }
    })
    const switched = render(<BibliotecaV2 conversationId="conv-1" companyId={COMPANY_ID} />)
    await openFolder(switched)
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/files/list')).length).toBeGreaterThan(2)
    })
    session = { access_token: 'other-token', user: { id: OTHER_USER } }
    releaseOther()
    await waitFor(() => {
      expect(switched.queryByText('outro-usuario.png')).toBeNull()
    })
    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('renewed-token')
    expect(logged).not.toContain('other-token')
    expect(logged).not.toContain('meta_whatsapp_enabled')
  })
})

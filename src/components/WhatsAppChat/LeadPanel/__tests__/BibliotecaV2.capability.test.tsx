// @vitest-environment jsdom
// Biblioteca só consulta chat_messages quando a capability do painel permite.

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../MediaLibrary/DirectS3Upload', () => ({
  DirectS3Upload: () => null,
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: mockFrom },
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

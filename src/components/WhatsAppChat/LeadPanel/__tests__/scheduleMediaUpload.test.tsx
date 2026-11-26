/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyScheduleResult,
  scheduleProgressPercent,
  useChatScheduleUpload,
  type ScheduleRunResult,
  type ScheduleUploadScope,
} from '../scheduleMediaUpload'

const { getSession, onAuthStateChange, uploadChatMedia } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  uploadChatMedia: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

vi.mock('../../../../services/chatMediaUpload', () => ({
  uploadChatMedia: (...args: unknown[]) => uploadChatMedia(...args),
}))

const USER = 'aaaa0000-0000-4000-8000-000000000001'
const OTHER = 'dddd0000-0000-4000-8000-000000000004'
const COMPANY = 'bbbb0000-0000-4000-8000-000000000002'
const CONVERSATION = 'cccc0000-0000-4000-8000-000000000003'
const OTHER_CONVERSATION = 'eeee0000-0000-4000-8000-000000000005'
const INSTANCE = 'ffff0000-0000-4000-8000-000000000006'
const OTHER_INSTANCE = '99999999-9999-4999-8999-999999999999'
const MEDIA_URL = 'https://example-bucket.s3.us-east-1.amazonaws.com/clientes/x/whatsapp/2026/11/26/op/foto.png'

function session(userId: string | null) {
  return { data: { session: userId ? { user: { id: userId } } : null }, error: null }
}

function scope(overrides: Partial<ScheduleUploadScope> = {}): ScheduleUploadScope {
  return {
    companyId: COMPANY,
    conversationId: CONVERSATION,
    instanceId: INSTANCE,
    userId: USER,
    ...overrides,
  }
}

describe('agendamento com mídia do LeadPanel', () => {
  let authListener: ((event: string, next: { user?: { id: string } } | null) => void) | null

  beforeEach(() => {
    authListener = null
    getSession.mockReset()
    onAuthStateChange.mockReset()
    uploadChatMedia.mockReset()
    getSession.mockResolvedValue(session(USER))
    onAuthStateChange.mockImplementation((callback: typeof authListener) => {
      authListener = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    uploadChatMedia.mockResolvedValue({ ok: true, media_url: MEDIA_URL })
  })

  it('agenda arquivo na instância selecionada e texto sem upload', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' })
    const seen: Array<[number, number]> = []
    const { result } = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    const persisted: Array<[string | null, ScheduleUploadScope]> = []
    let outcome: ScheduleRunResult | null = null
    await act(async () => {
      outcome = await result.current.run({
        file,
        onProgress: (loaded, total) => seen.push([loaded, total]),
        persist: async (mediaUrl, attempt) => {
          persisted.push([mediaUrl, attempt])
        },
      })
    })
    expect(outcome).toMatchObject({ action: 'scheduled', media_url: MEDIA_URL })
    expect(persisted).toEqual([[MEDIA_URL, scope()]])
    const [sentFile, request, signal] = uploadChatMedia.mock.calls[0]
    expect(sentFile).toBe(file)
    expect(request).toMatchObject({
      purpose: 'chat_schedule',
      companyId: COMPANY,
      conversationId: CONVERSATION,
      instanceId: INSTANCE,
    })
    expect(request.instanceId).toBe(INSTANCE)
    expect(signal).toBeInstanceOf(AbortSignal)
    request.onProgress(40, 80)
    expect(seen).toEqual([[40, 80]])
    expect(scheduleProgressPercent(40, 80)).toBe(50)

    uploadChatMedia.mockClear()
    const text = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    const textPersisted: Array<string | null> = []
    await act(async () => {
      outcome = await text.result.current.run({
        file: null,
        persist: async (mediaUrl) => {
          textPersisted.push(mediaUrl)
        },
      })
    })
    expect(outcome).toMatchObject({ action: 'scheduled', media_url: null })
    expect(textPersisted).toEqual([null])
    expect(uploadChatMedia).not.toHaveBeenCalled()
  })

  it('falha de upload não persiste e o progresso deixa de chegar após a troca', async () => {
    uploadChatMedia.mockResolvedValue({ ok: false, error: 'Falha ao enviar o arquivo.' })
    const { result } = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    const persisted: string[] = []
    let outcome: ScheduleRunResult | null = null
    await act(async () => {
      outcome = await result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        persist: async () => {
          persisted.push('persist')
        },
      })
    })
    const completed: string[] = []
    applyScheduleResult(outcome!, {
      owns: result.current.ownsLoading,
      complete: () => completed.push('complete'),
      fail: () => completed.push('fail'),
      release: () => completed.push('release'),
    })
    expect(outcome).toMatchObject({ action: 'fail' })
    expect(persisted).toEqual([])
    expect(completed).toEqual(['fail', 'release'])

    const progressed: number[] = []
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockClear()
    uploadChatMedia.mockImplementation((_file: File, request: { onProgress?: (loaded: number, total: number) => void }) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        request.onProgress?.(10, 100)
      })
    })
    const switched = renderHook(
      (props: ScheduleUploadScope) => useChatScheduleUpload(props, { active: true }),
      { initialProps: scope() }
    )
    let pending: Promise<ScheduleRunResult> | null = null
    act(() => {
      pending = switched.result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        onProgress: (loaded) => progressed.push(loaded),
        persist: async () => {
          persisted.push('late')
        },
      })
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalled())
    switched.rerender(scope({ conversationId: OTHER_CONVERSATION }))
    const request = uploadChatMedia.mock.calls[0][1] as { onProgress: (loaded: number, total: number) => void }
    request.onProgress(80, 100)
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(await pending).toMatchObject({ action: 'ignore' })
    expect(persisted).toEqual([])
    expect(progressed).toEqual([10])
    expect(uploadChatMedia.mock.calls[0][1]).toMatchObject({ instanceId: INSTANCE })
  })

  it('cancela ao fechar, troca a instância e ignora clique duplicado', async () => {
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const invalidated: string[] = []
    const { result, rerender } = renderHook(
      (props: { active: boolean; instanceId: string }) => useChatScheduleUpload(
        scope({ instanceId: props.instanceId }),
        { active: props.active, onInvalidate: () => invalidated.push(props.instanceId) }
      ),
      { initialProps: { active: true, instanceId: INSTANCE } }
    )
    const persisted: string[] = []
    let pending: Promise<ScheduleRunResult> | null = null
    act(() => {
      pending = result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        persist: async () => {
          persisted.push('persist')
        },
      })
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    const signal = uploadChatMedia.mock.calls[0][2] as AbortSignal
    rerender({ active: false, instanceId: INSTANCE })
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ action: 'ignore' })
    expect(persisted).toEqual([])
    expect(invalidated).toContain(INSTANCE)

    rerender({ active: true, instanceId: OTHER_INSTANCE })
    expect(invalidated).toContain(OTHER_INSTANCE)

    uploadChatMedia.mockClear()
    uploadChatMedia.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve
    }))
    const locked = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    let first: Promise<ScheduleRunResult> | null = null
    let second: Promise<ScheduleRunResult> | null = null
    act(() => {
      first = locked.result.current.run({
        file: new File(['a'], 'a.png', { type: 'image/png' }),
        persist: async () => undefined,
      })
      second = locked.result.current.run({
        file: new File(['b'], 'b.png', { type: 'image/png' }),
        persist: async () => undefined,
      })
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    expect(await second).toMatchObject({ action: 'ignore', op: null })
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await first
    })
    expect(uploadChatMedia).toHaveBeenCalledTimes(1)
  })

  it('não conclui com sessão trocada, desmontagem ou resultado tardio', async () => {
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(OTHER))
    const { result } = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    await waitFor(() => expect(getSession).toHaveBeenCalled())
    const persisted: string[] = []
    let changed: ScheduleRunResult | null = null
    await act(async () => {
      changed = await result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        persist: async () => {
          persisted.push('persist')
        },
      })
    })
    expect(changed).toMatchObject({ action: 'fail', error: 'A sessão mudou durante o envio.' })
    expect(persisted).toEqual([])

    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const mounted = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    let pending: Promise<ScheduleRunResult> | null = null
    act(() => {
      pending = mounted.result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        persist: async () => {
          persisted.push('unmount')
        },
      })
    })
    await waitFor(() => expect(uploadChatMedia.mock.calls.length).toBeGreaterThan(1))
    const signal = uploadChatMedia.mock.calls[uploadChatMedia.mock.calls.length - 1][2] as AbortSignal
    mounted.unmount()
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ action: 'ignore' })
    expect(persisted).toEqual([])

    const authed = renderHook(() => useChatScheduleUpload(scope(), { active: true }))
    let late: Promise<ScheduleRunResult> | null = null
    act(() => {
      late = authed.result.current.run({
        file: new File(['x'], 'foto.png', { type: 'image/png' }),
        persist: async () => {
          persisted.push('auth')
        },
      })
    })
    await waitFor(() => expect(uploadChatMedia.mock.calls.length).toBeGreaterThan(2))
    act(() => authListener?.('SIGNED_IN', { user: { id: OTHER } }))
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await late
    })
    expect(await late).toMatchObject({ action: 'ignore' })
    expect(persisted).toEqual([])
  })

  it('o LeadPanel não volta ao uploader legado', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/WhatsAppChat/LeadPanel/LeadPanel.tsx'), 'utf8')
    const helper = readFileSync(join(process.cwd(), 'src/components/WhatsAppChat/LeadPanel/scheduleMediaUpload.ts'), 'utf8')
    expect(source).not.toContain('uploadMedia')
    expect(source).toContain('scheduleUpload.run')
    expect(source).toContain('chatApi.scheduleMessage')
    expect(source).toContain('attempt.instanceId')
    expect(helper).toContain("purpose: 'chat_schedule'")
    expect(helper).not.toContain('uploadMedia')
    expect(helper).not.toContain('console.')
  })
})

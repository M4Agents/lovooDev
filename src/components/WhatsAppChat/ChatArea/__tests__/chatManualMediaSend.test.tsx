/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyChatManualSend,
  buildAudioMessage,
  buildAudioPreviewFile,
  buildCaptionMessage,
  useChatManualUpload,
  type ChatManualRunResult,
} from '../chatManualMediaSend'

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
const OTHER_COMPANY = '99999999-9999-4999-8999-999999999999'
const CONVERSATION = 'cccc0000-0000-4000-8000-000000000003'
const OTHER_CONVERSATION = 'eeee0000-0000-4000-8000-000000000005'
const MEDIA_URL = 'https://example-bucket.s3.us-east-1.amazonaws.com/clientes/x/whatsapp/2026/11/26/op/foto.png'

function session(userId: string | null) {
  return {
    data: { session: userId ? { user: { id: userId } } : null },
    error: null,
  }
}

function scope(overrides: Partial<{ companyId: string; conversationId: string; userId: string }> = {}) {
  return {
    companyId: COMPANY,
    conversationId: CONVERSATION,
    userId: USER,
    ...overrides,
  }
}

describe('envio manual do ChatArea', () => {
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

  it('envia o arquivo original e usa a media_url do confirm', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' })
    const { result } = renderHook(() => useChatManualUpload(scope()))
    let outcome: Awaited<ReturnType<typeof result.current.run>> | null = null
    await act(async () => {
      outcome = await result.current.run(file)
    })
    expect(outcome).toMatchObject({ action: 'send', media_url: MEDIA_URL })
    expect(uploadChatMedia).toHaveBeenCalledTimes(1)
    const [sentFile, request, signal] = uploadChatMedia.mock.calls[0]
    expect(sentFile).toBe(file)
    expect(request).toEqual({
      purpose: 'chat_manual',
      companyId: COMPANY,
      conversationId: CONVERSATION,
    })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(buildCaptionMessage({
      mimeType: 'image/png',
      fileName: 'foto.png',
      caption: '  olha isso  ',
      mediaUrl: MEDIA_URL,
    })).toEqual({
      content: 'olha isso',
      message_type: 'image',
      media_url: MEDIA_URL,
    })
  })

  it('preserva legenda vazia, vídeo, documento e o áudio original', () => {
    expect(buildCaptionMessage({
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      caption: '   ',
      mediaUrl: MEDIA_URL,
    })).toEqual({ content: 'clip.mp4', message_type: 'video', media_url: MEDIA_URL })
    expect(buildCaptionMessage({
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
      caption: 'segue',
      mediaUrl: MEDIA_URL,
    })).toEqual({ content: 'segue', message_type: 'document', media_url: MEDIA_URL })

    const blob = new Blob([new Uint8Array([9])], { type: 'audio/webm' })
    const webm = buildAudioPreviewFile(blob, 'audio/webm;codecs=opus', 1000)
    expect(webm.name).toBe('gravacao-1000.webm')
    expect(webm.type).toBe('audio/webm;codecs=opus')
    expect(webm).toBeInstanceOf(File)
    const ogg = buildAudioPreviewFile(blob, 'audio/ogg', 1000)
    expect(ogg.name).toBe('gravacao-1000.ogg')
    expect(buildAudioMessage(MEDIA_URL)).toEqual({
      content: '[áudio]',
      message_type: 'audio',
      media_url: MEDIA_URL,
    })
  })

  it('falha de upload não envia e conserva a tentativa para retry', async () => {
    uploadChatMedia.mockResolvedValue({ ok: false, error: 'Falha ao enviar o arquivo.' })
    const { result } = renderHook(() => useChatManualUpload(scope()))
    const sent: string[] = []
    const failed: string[] = []
    const released: number[] = []
    let outcome: Awaited<ReturnType<typeof result.current.run>> | null = null
    await act(async () => {
      outcome = await result.current.run(new File(['x'], 'foto.png', { type: 'image/png' }))
    })
    applyChatManualSend(outcome!, {
      owns: result.current.ownsLoading,
      send: (url) => sent.push(url),
      fail: (error) => failed.push(error),
      release: (op) => released.push(op),
    })
    expect(outcome).toMatchObject({ action: 'fail' })
    expect(sent).toEqual([])
    expect(failed).toEqual(['Falha ao enviar o arquivo.'])
    expect(released).toHaveLength(1)
    expect(String(outcome)).not.toContain(MEDIA_URL)
  })

  it('troca de conversa, empresa ou usuário descarta o resultado tardio', async () => {
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
        resolveUpload = resolve
      })
    })
    const invalidated: string[] = []
    const { result, rerender } = renderHook(
      (props: { companyId: string; conversationId: string; userId: string }) => useChatManualUpload(props, () => {
        invalidated.push(`${props.companyId}:${props.conversationId}:${props.userId}`)
      }),
      { initialProps: scope() }
    )
    let outcomePromise: Promise<ChatManualRunResult> | null = null
    act(() => {
      outcomePromise = result.current.run(new File(['x'], 'foto.png', { type: 'image/png' }))
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    const signal = uploadChatMedia.mock.calls[0][2] as AbortSignal

    rerender(scope({ conversationId: OTHER_CONVERSATION }))
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await outcomePromise
    })
    const outcome = await outcomePromise
    expect(signal.aborted).toBe(true)
    expect(outcome).toMatchObject({ action: 'ignore' })
    expect(invalidated.some((entry) => entry.includes(OTHER_CONVERSATION))).toBe(true)

    const sent: string[] = []
    applyChatManualSend(outcome!, {
      owns: result.current.ownsLoading,
      send: (url) => sent.push(url),
      fail: () => sent.push('fail'),
      release: () => sent.push('release'),
    })
    expect(sent).toEqual([])
    expect(uploadChatMedia.mock.calls[0][1]).toMatchObject({ conversationId: CONVERSATION })

    rerender(scope({ companyId: OTHER_COMPANY }))
    rerender(scope({ userId: OTHER }))
    expect(invalidated.some((entry) => entry.includes(OTHER_COMPANY))).toBe(true)
    expect(invalidated.some((entry) => entry.endsWith(OTHER))).toBe(true)
  })

  it('não envia quando a sessão muda antes do send nem quando o clique é duplicado', async () => {
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(OTHER))
    const { result } = renderHook(() => useChatManualUpload(scope()))
    await waitFor(() => expect(getSession).toHaveBeenCalled())
    let changed: Awaited<ReturnType<typeof result.current.run>> | null = null
    await act(async () => {
      changed = await result.current.run(new File(['x'], 'foto.png', { type: 'image/png' }))
    })
    const sent: string[] = []
    applyChatManualSend(changed!, {
      owns: result.current.ownsLoading,
      send: (url) => sent.push(url),
      fail: () => sent.push('fail'),
      release: () => undefined,
    })
    expect(changed).toMatchObject({ action: 'fail', error: 'A sessão mudou durante o envio.' })
    expect(sent).toEqual(['fail'])
    expect(sent).not.toContain(MEDIA_URL)

    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockClear()
    uploadChatMedia.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve
    }))
    getSession.mockResolvedValue(session(USER))
    const { result: locked } = renderHook(() => useChatManualUpload(scope()))
    let first: Promise<unknown> | null = null
    let second: Promise<unknown> | null = null
    act(() => {
      first = locked.current.run(new File(['x'], 'a.png', { type: 'image/png' }))
      second = locked.current.run(new File(['y'], 'b.png', { type: 'image/png' }))
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    const duplicate = await second
    expect(duplicate).toMatchObject({ action: 'ignore', op: null })
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await first
    })
    expect(uploadChatMedia).toHaveBeenCalledTimes(1)
  })

  it('cancela ao desmontar e ao trocar o usuário autenticado', async () => {
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const { result, unmount } = renderHook(() => useChatManualUpload(scope()))
    let pending: Promise<unknown> | null = null
    act(() => {
      pending = result.current.run(new File(['x'], 'foto.png', { type: 'image/png' }))
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalled())
    const signal = uploadChatMedia.mock.calls[uploadChatMedia.mock.calls.length - 1]?.[2] as AbortSignal
    unmount()
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ action: 'ignore' })

    const { result: authed } = renderHook(() => useChatManualUpload(scope()))
    let late: Promise<unknown> | null = null
    act(() => {
      late = authed.current.run(new File(['x'], 'foto.png', { type: 'image/png' }))
    })
    await waitFor(() => expect(uploadChatMedia.mock.calls.length).toBeGreaterThan(1))
    const authSignal = uploadChatMedia.mock.calls[uploadChatMedia.mock.calls.length - 1]?.[2] as AbortSignal
    act(() => authListener?.('SIGNED_IN', { user: { id: OTHER } }))
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await late
    })
    expect(authSignal.aborted).toBe(true)
    expect(await late).toMatchObject({ action: 'ignore' })
  })

  it('o ChatArea não volta ao uploader legado', () => {
    const areaDir = join(process.cwd(), 'src/components/WhatsAppChat/ChatArea')
    const source = readFileSync(join(areaDir, 'ChatArea.tsx'), 'utf8')
    const helper = readFileSync(join(areaDir, 'chatManualMediaSend.ts'), 'utf8')
    expect(source).not.toContain('uploadMedia')
    expect(source).not.toContain('S3Storage')
    expect(source).toContain('manualUpload.run')
    expect(source).toContain('audioUpload.run')
    expect(source).toContain('chatApi.sendMessage')
    expect(helper).not.toContain('uploadMedia')
    expect(helper).not.toContain('console.')
  })
})

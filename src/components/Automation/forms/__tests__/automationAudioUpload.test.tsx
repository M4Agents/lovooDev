/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyAutomationAudioResult,
  useAutomationAudioUpload,
  type AutomationAudioRunResult,
  type AutomationAudioScope,
} from '../automationAudioUpload'

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
const OTHER_COMPANY = 'eeee0000-0000-4000-8000-000000000005'
const FLOW = 'ffff0000-0000-4000-8000-000000000006'
const OTHER_FLOW = '99999999-9999-4999-8999-999999999999'
const MEDIA_URL = 'https://example-bucket.s3.us-east-1.amazonaws.com/clientes/x/whatsapp/2026/11/26/op/audio.ogg'

function session(userId: string | null) {
  return { data: { session: userId ? { user: { id: userId } } : null }, error: null }
}

function scope(overrides: Partial<AutomationAudioScope> = {}): AutomationAudioScope {
  return { companyId: COMPANY, flowId: FLOW, userId: USER, ...overrides }
}

function audioFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], 'audio-1.ogg', { type: 'audio/ogg' })
}

describe('gravação de áudio da automação', () => {
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

  it('envia o arquivo original com o flowId real e devolve a media_url', async () => {
    const file = audioFile()
    const { result } = renderHook(() => useAutomationAudioUpload(scope()))
    const applied: string[] = []
    let outcome: AutomationAudioRunResult | null = null
    await act(async () => {
      outcome = await result.current.run(file)
    })
    applyAutomationAudioResult(outcome!, {
      owns: result.current.ownsLoading,
      apply: (mediaUrl) => applied.push(mediaUrl),
      fail: () => applied.push('fail'),
      release: () => applied.push('release'),
    })
    expect(outcome).toMatchObject({ action: 'apply', media_url: MEDIA_URL })
    expect(applied).toEqual([MEDIA_URL, 'release'])
    const [sentFile, request, signal] = uploadChatMedia.mock.calls[0]
    expect(sentFile).toBe(file)
    expect(sentFile.name).toBe('audio-1.ogg')
    expect(sentFile.type).toBe('audio/ogg')
    expect(sentFile.size).toBe(4)
    expect(request).toEqual({
      purpose: 'automation_audio',
      companyId: COMPANY,
      flowId: FLOW,
    })
    expect(request).not.toHaveProperty('conversationId')
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('falha de upload e flowId ausente não atualizam o formulário', async () => {
    uploadChatMedia.mockResolvedValue({ ok: false, error: 'Falha ao enviar o arquivo.' })
    const { result } = renderHook(() => useAutomationAudioUpload(scope()))
    let outcome: AutomationAudioRunResult | null = null
    await act(async () => {
      outcome = await result.current.run(audioFile())
    })
    const effects: string[] = []
    applyAutomationAudioResult(outcome!, {
      owns: result.current.ownsLoading,
      apply: () => effects.push('apply'),
      fail: (error) => effects.push(error),
      release: () => effects.push('release'),
    })
    expect(effects).toEqual(['Falha ao enviar o arquivo.', 'release'])

    uploadChatMedia.mockClear()
    const missing = renderHook(() => useAutomationAudioUpload(scope({ flowId: '' })))
    await act(async () => {
      outcome = await missing.result.current.run(audioFile())
    })
    expect(outcome).toMatchObject({ action: 'fail', error: 'Fluxo não identificado.', op: null })
    expect(uploadChatMedia).not.toHaveBeenCalled()
  })

  it('cancela ao trocar empresa ou fluxo e ignora o resultado tardio', async () => {
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const invalidated: string[] = []
    const switched = renderHook(
      (props: AutomationAudioScope) => useAutomationAudioUpload(props, () => {
        invalidated.push(props.flowId)
      }),
      { initialProps: scope() }
    )
    let pending: Promise<AutomationAudioRunResult> | null = null
    act(() => {
      pending = switched.result.current.run(audioFile())
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    const signal = uploadChatMedia.mock.calls[0][2] as AbortSignal
    expect(uploadChatMedia.mock.calls[0][1]).toMatchObject({ flowId: FLOW })
    switched.rerender(scope({ companyId: OTHER_COMPANY }))
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ action: 'ignore' })
    expect(invalidated).toEqual([FLOW])

    switched.rerender(scope({ companyId: OTHER_COMPANY, flowId: OTHER_FLOW }))
    expect(invalidated).toEqual([FLOW, OTHER_FLOW])
  })

  it('impede clique duplicado e cancela ao desmontar', async () => {
    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const locked = renderHook(() => useAutomationAudioUpload(scope()))
    let first: Promise<AutomationAudioRunResult> | null = null
    let second: Promise<AutomationAudioRunResult> | null = null
    act(() => {
      first = locked.result.current.run(audioFile())
      second = locked.result.current.run(new File([new Uint8Array([9])], 'outro.ogg', { type: 'audio/ogg' }))
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(1))
    expect(await second).toMatchObject({ action: 'ignore', op: null })
    expect(uploadChatMedia.mock.calls[0][0]).toMatchObject({ name: 'audio-1.ogg', type: 'audio/ogg' })
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await first
    })
    expect(await first).toMatchObject({ action: 'apply', media_url: MEDIA_URL })
    expect(uploadChatMedia).toHaveBeenCalledTimes(1)

    const mounted = renderHook(() => useAutomationAudioUpload(scope()))
    let pending: Promise<AutomationAudioRunResult> | null = null
    act(() => {
      pending = mounted.result.current.run(audioFile())
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(2))
    const signal = uploadChatMedia.mock.calls[1][2] as AbortSignal
    mounted.unmount()
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ action: 'ignore' })
  })

  it('não aplica sessão trocada nem resultado tardio de outro usuário', async () => {
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(USER))
    getSession.mockResolvedValueOnce(session(OTHER))
    const { result } = renderHook(() => useAutomationAudioUpload(scope()))
    await waitFor(() => expect(getSession).toHaveBeenCalled())
    let changed: AutomationAudioRunResult | null = null
    await act(async () => {
      changed = await result.current.run(audioFile())
    })
    expect(changed).toMatchObject({ action: 'fail', error: 'A sessão mudou durante o envio.' })
    expect(uploadChatMedia).toHaveBeenCalledTimes(1)

    let resolveUpload: (value: { ok: true; media_url: string }) => void = () => {}
    uploadChatMedia.mockImplementation((_file: File, _request: unknown, signal: AbortSignal) => {
      return new Promise((resolve) => {
        resolveUpload = resolve
        signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'Upload cancelado.' }))
      })
    })
    const authed = renderHook(() => useAutomationAudioUpload(scope()))
    let late: Promise<AutomationAudioRunResult> | null = null
    act(() => {
      late = authed.result.current.run(audioFile())
    })
    await waitFor(() => expect(uploadChatMedia).toHaveBeenCalledTimes(2))
    act(() => authListener?.('SIGNED_IN', { user: { id: OTHER } }))
    await act(async () => {
      resolveUpload({ ok: true, media_url: MEDIA_URL })
      await late
    })
    expect(await late).toMatchObject({ action: 'ignore' })

    const form = readFileSync(join(process.cwd(), 'src/components/Automation/forms/AudioMessageForm.tsx'), 'utf8')
    const helper = readFileSync(join(process.cwd(), 'src/components/Automation/forms/automationAudioUpload.ts'), 'utf8')
    const modal = readFileSync(join(process.cwd(), 'src/components/Automation/MessageConfigModal.tsx'), 'utf8')
    const canvas = readFileSync(join(process.cwd(), 'src/components/Automation/FlowCanvas.tsx'), 'utf8')
    expect(form).not.toContain('uploadMedia')
    expect(form).not.toContain('automation-audio-')
    expect(form).toContain('audioUpload.run')
    expect(form).toContain('audioFile: file')
    expect(form).toContain('audioUrl: mediaUrl')
    expect(form).toContain('handleFileChange')
    expect(form).toContain('handleUrlChange')
    expect(helper).toContain("purpose: 'automation_audio'")
    expect(helper).not.toContain('uploadMedia')
    expect(helper).not.toContain('conversationId')
    expect(helper).not.toContain('console.')
    expect(modal).toContain('flowId={flowId}')
    expect(modal).toContain('userId={user?.id || \'\'}')
    expect(canvas).toContain('flowId={flowId}')
  })
})

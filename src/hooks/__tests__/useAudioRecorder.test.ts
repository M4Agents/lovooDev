// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioRecorder } from '../useAudioRecorder'

type FakeRecorder = {
  mimeType: string
  ondataavailable: ((ev: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

const constructed: { mimeType?: string }[] = []

function installMediaMocks(options?: {
  supported?: (mime: string) => boolean
  ctorThrow?: boolean
  stopThrow?: boolean
  effectiveMime?: string
}) {
  const supported = options?.supported ?? ((mime: string) => mime === 'audio/webm' || mime.startsWith('audio/mp4'))
  class FakeMediaRecorder {
    mimeType: string
    ondataavailable: FakeRecorder['ondataavailable'] = null
    onstop: FakeRecorder['onstop'] = null
    onerror: FakeRecorder['onerror'] = null
    start = vi.fn()
    stop = vi.fn(() => {
      if (options?.stopThrow) throw new Error('stop failed')
      this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) })
      this.onstop?.()
    })
    constructor(_stream: MediaStream, recorderOptions?: { mimeType?: string }) {
      if (options?.ctorThrow) throw new Error('ctor failed')
      constructed.push({ mimeType: recorderOptions?.mimeType })
      this.mimeType = options?.effectiveMime ?? recorderOptions?.mimeType ?? ''
    }
    static isTypeSupported(mime: string) {
      return supported(mime)
    }
  }
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  })
}

describe('useAudioRecorder', () => {
  beforeEach(() => {
    constructed.length = 0
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/fake')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sem preferência usa a ordem MIME da Uazapi (webm primeiro)', async () => {
    installMediaMocks({
      supported: (mime) => mime === 'audio/webm',
    })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording()
    })
    expect(constructed[0]?.mimeType).toBe('audio/webm')
  })

  it('MIME MP4 explícito é passado ao MediaRecorder', async () => {
    installMediaMocks({ effectiveMime: 'audio/mp4' })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording({ mimeType: 'audio/mp4' })
    })
    expect(constructed[0]?.mimeType).toBe('audio/mp4')
    expect(result.current.audioMimeType).toBe('audio/mp4')
  })

  it('MIME não suportado não inicia gravação', async () => {
    installMediaMocks({ supported: () => false })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording({ mimeType: 'audio/mp4' })
    })
    expect(constructed).toHaveLength(0)
    expect(result.current.recorderError).toBe('unsupported_mime')
    expect(result.current.isRecording).toBe(false)
  })

  it('falha de inicialização do MediaRecorder é tratada e libera o stream', async () => {
    installMediaMocks({ ctorThrow: true })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording({ mimeType: 'audio/mp4' })
    })
    expect(result.current.recorderError).toBe('start_failed')
    expect(result.current.isRecording).toBe(false)
  })

  it('falha de finalização é tratada', async () => {
    installMediaMocks({ stopThrow: true })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording()
    })
    act(() => {
      result.current.stopRecording()
    })
    expect(result.current.recorderError).toBe('stop_failed')
    expect(result.current.isRecording).toBe(false)
  })

  it('cancelamento libera gravação e não deixa isRecording ativo', async () => {
    installMediaMocks()
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording()
    })
    expect(result.current.isRecording).toBe(true)
    act(() => {
      result.current.cancelRecording()
    })
    expect(result.current.isRecording).toBe(false)
    expect(result.current.audioBlobPreview).toBeNull()
  })

  it('não renomeia Blob para MP4 quando o MIME efetivo é WebM', async () => {
    installMediaMocks({
      supported: () => true,
      effectiveMime: 'audio/webm',
    })
    const { result } = renderHook(() => useAudioRecorder())
    await act(async () => {
      await result.current.startRecording({ mimeType: 'audio/mp4' })
    })
    act(() => {
      result.current.stopRecording()
    })
    expect(result.current.audioMimeType).toBe('audio/webm')
    expect(result.current.audioBlobPreview?.type).toBe('audio/webm')
  })
})

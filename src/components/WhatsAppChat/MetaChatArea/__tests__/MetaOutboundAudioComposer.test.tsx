// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { MetaOutboundAudioComposer } from '../MetaOutboundAudioComposer'

const recorder = {
  isRecording: false,
  recordingSeconds: 0,
  audioBlobPreview: null as Blob | null,
  audioPreviewUrl: null as string | null,
  audioMimeType: null as string | null,
  previewDurationSeconds: 0,
  micError: null as 'permission_denied' | 'unavailable' | 'unknown' | null,
  recorderError: null as 'unsupported_mime' | 'start_failed' | 'stop_failed' | null,
  startRecording: vi.fn(async () => {}),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  clearPreview: vi.fn(),
}

type SendAudioInput = {
  companyId: string
  instanceId: string
  conversationId: string
  operationId: string
  audio: File
}

const { MetaOutboundAudioSendError, sendAudio, mintId, validateSend, mp4MimeState, remuxAudio } = vi.hoisted(() => {
  class MetaOutboundAudioSendError extends Error {
    status: number
    code: string
    constructor(status: number, code: string) {
      super(code)
      this.name = 'MetaOutboundAudioSendError'
      this.status = status
      this.code = code
    }
  }
  return {
    MetaOutboundAudioSendError,
    sendAudio: vi.fn<(input: SendAudioInput) => Promise<{ ok: true }>>(),
    mintId: vi.fn(() => 'a0b1c2d3-e4f5-4a67-8b90-123456789abc'),
    validateSend: vi.fn((_bytes?: Uint8Array) => ({ ok: true as boolean, code: null as string | null })),
    mp4MimeState: { mime: 'audio/mp4;codecs=mp4a.40.2' as string | null },
    remuxAudio: vi.fn(async (bytes: Uint8Array) => ({ ok: true as const, bytes })),
  }
})

vi.mock('../../../../hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => recorder,
}))

vi.mock('../../../../utils/metaAudioRecorderDiagnostic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/metaAudioRecorderDiagnostic')>()
  return {
    ...actual,
    selectSupportedMp4MimeType: () => mp4MimeState.mime,
  }
})

vi.mock('../../../../utils/metaOutboundAudioSend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/metaOutboundAudioSend')>()
  return {
    ...actual,
    mintOutboundAudioOperationId: () => mintId(),
    validateOutboundAudioBytesForSend: (bytes: Uint8Array) => validateSend(bytes),
  }
})

vi.mock('../../../../services/metaWhatsAppApi', () => ({
  MetaOutboundAudioSendError,
  metaWhatsAppApi: { sendAudio: (input: SendAudioInput) => sendAudio(input) },
}))

vi.mock('../../../../utils/metaOutboundAudioRemux', () => ({
  remuxMetaOutboundAudioToProgressiveMp4: (bytes: Uint8Array) => remuxAudio(bytes),
}))

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INSTANCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONV_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CONV_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function resetRecorder() {
  recorder.isRecording = false
  recorder.recordingSeconds = 0
  recorder.audioBlobPreview = null
  recorder.audioPreviewUrl = null
  recorder.audioMimeType = null
  recorder.previewDurationSeconds = 0
  recorder.micError = null
  recorder.recorderError = null
  recorder.startRecording.mockClear()
  recorder.stopRecording.mockClear()
  recorder.cancelRecording.mockClear()
  recorder.clearPreview.mockClear()
}

function renderComposer(conversationId = CONV_A, onSent = vi.fn()) {
  return render(
    <MetaOutboundAudioComposer
      companyId={COMPANY_ID}
      instanceId={INSTANCE_ID}
      conversationId={conversationId}
      onSent={onSent}
    />,
  )
}

async function readyPreview() {
  recorder.audioBlobPreview = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })
  recorder.audioPreviewUrl = 'blob:http://localhost/preview'
  recorder.previewDurationSeconds = 2
}

beforeEach(() => {
  if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)
    }
  }
  resetRecorder()
  sendAudio.mockReset()
  sendAudio.mockResolvedValue({ ok: true })
  mintId.mockClear()
  validateSend.mockReset()
  validateSend.mockReturnValue({ ok: true, code: null })
  remuxAudio.mockReset()
  remuxAudio.mockImplementation(async (bytes: Uint8Array) => ({ ok: true as const, bytes }))
  mp4MimeState.mime = 'audio/mp4;codecs=mp4a.40.2'
})

afterEach(() => {
  cleanup()
})

describe('MetaOutboundAudioComposer', () => {
  it('microfone inicia gravação MP4', async () => {
    renderComposer()
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-outbound-audio-mic'))
    })
    expect(recorder.startRecording).toHaveBeenCalledWith({
      mimeType: 'audio/mp4;codecs=mp4a.40.2',
    })
  })

  it('sem instância não grava', async () => {
    render(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={undefined}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-outbound-audio-mic'))
    })
    expect(recorder.startRecording).not.toHaveBeenCalled()
  })

  it('grava, para e cancela', () => {
    recorder.isRecording = true
    recorder.recordingSeconds = 4
    renderComposer()
    expect(screen.getByTestId('meta-outbound-audio-recording')).toBeTruthy()
    fireEvent.click(screen.getByText('Encerrar'))
    expect(recorder.stopRecording).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancelar'))
    expect(recorder.cancelRecording).toHaveBeenCalled()
  })

  it('erro de permissão visível', () => {
    recorder.micError = 'permission_denied'
    renderComposer()
    expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/negada/i)
  })

  it('UUIDv4 gerado uma única vez na prévia elegível', async () => {
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(mintId).toHaveBeenCalledTimes(1))
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    expect(mintId).toHaveBeenCalledTimes(1)
  })

  it('clique duplo envia só uma requisição', async () => {
    let resolveSend: (value: { ok: true }) => void = () => {}
    sendAudio.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve }))
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    expect(sendAudio).toHaveBeenCalledTimes(1)
    await act(async () => { resolveSend({ ok: true }) })
  })

  it('retry 503 mantém UUID e bytes', async () => {
    sendAudio
      .mockRejectedValueOnce(new MetaOutboundAudioSendError(503, 'persist_deadline_insufficient'))
      .mockResolvedValueOnce({ ok: true })
    const onSent = vi.fn()
    const { rerender } = renderComposer(CONV_A, onSent)
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={onSent}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => expect(screen.getByTestId('meta-outbound-audio-recover')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-outbound-audio-recover'))
    })
    expect(sendAudio).toHaveBeenCalledTimes(2)
    expect(sendAudio.mock.calls[0][0].operationId).toBe('a0b1c2d3-e4f5-4a67-8b90-123456789abc')
    expect(sendAudio.mock.calls[1][0].operationId).toBe(sendAudio.mock.calls[0][0].operationId)
    expect(sendAudio.mock.calls[1][0].audio).toBe(sendAudio.mock.calls[0][0].audio)
    expect(mintId).toHaveBeenCalledTimes(1)
    expect(remuxAudio).toHaveBeenCalledTimes(1)
  })

  it('retry de persistência mantém UUID e bytes', async () => {
    sendAudio
      .mockRejectedValueOnce(new MetaOutboundAudioSendError(500, 'send_persistence_failed'))
      .mockResolvedValueOnce({ ok: true })
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => expect(screen.getByTestId('meta-outbound-audio-recover')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-outbound-audio-recover'))
    })
    expect(sendAudio.mock.calls[0][0].operationId).toBe(sendAudio.mock.calls[1][0].operationId)
    expect(sendAudio.mock.calls[0][0].audio).toBe(sendAudio.mock.calls[1][0].audio)
  })

  it('timeout/rede preserva identidade e recupera com o mesmo File', async () => {
    sendAudio
      .mockRejectedValueOnce(new MetaOutboundAudioSendError(0, 'network_error'))
      .mockResolvedValueOnce({ ok: true })
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => expect(screen.getByTestId('meta-outbound-audio-recover')).toBeTruthy())
    expect(screen.getByTestId('meta-outbound-audio-error').getAttribute('data-kind')).toBe('recoverable')
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-outbound-audio-recover'))
    })
    expect(sendAudio).toHaveBeenCalledTimes(2)
    expect(sendAudio.mock.calls[1][0].operationId).toBe(sendAudio.mock.calls[0][0].operationId)
    expect(sendAudio.mock.calls[1][0].audio).toBe(sendAudio.mock.calls[0][0].audio)
    expect(mintId).toHaveBeenCalledTimes(1)
  })

  it('501 preserva rascunho e não oferece recuperação', async () => {
    sendAudio.mockRejectedValueOnce(new MetaOutboundAudioSendError(501, 'audio_send_not_enabled'))
    const onSent = vi.fn()
    const { rerender } = renderComposer(CONV_A, onSent)
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={onSent}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toBe(
        'Envio de áudio Meta ainda indisponível',
      )
    })
    expect(screen.getByTestId('meta-outbound-audio-error').getAttribute('data-kind')).toBe('not_enabled')
    expect(screen.queryByTestId('meta-outbound-audio-recover')).toBeNull()
    expect(onSent).not.toHaveBeenCalled()
    expect(screen.getByTestId('meta-outbound-audio-preview')).toBeTruthy()
    expect(mintId).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy()
    sendAudio.mockRejectedValueOnce(new MetaOutboundAudioSendError(501, 'audio_send_not_enabled'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => expect(sendAudio).toHaveBeenCalledTimes(2))
    expect(sendAudio.mock.calls[1][0].operationId).toBe(sendAudio.mock.calls[0][0].operationId)
    expect(sendAudio.mock.calls[1][0].audio).toBe(sendAudio.mock.calls[0][0].audio)
    expect(mintId).toHaveBeenCalledTimes(1)
    expect(onSent).not.toHaveBeenCalled()
    expect(screen.queryByTestId('meta-outbound-audio-recover')).toBeNull()
  })

  it('409 unknown não reenvia', async () => {
    sendAudio.mockRejectedValueOnce(new MetaOutboundAudioSendError(409, 'operation_unknown'))
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/indefinido/)
    })
    expect(screen.getByTestId('meta-outbound-audio-error').getAttribute('data-kind')).toBe('blocked')
    expect(screen.queryByTestId('meta-outbound-audio-recover')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    expect(sendAudio).toHaveBeenCalledTimes(1)
  })

  it('409 in_progress não reenvia', async () => {
    sendAudio.mockRejectedValueOnce(new MetaOutboundAudioSendError(409, 'operation_in_progress'))
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/em andamento/)
    })
    expect(screen.getByTestId('meta-outbound-audio-error').getAttribute('data-kind')).toBe('blocked')
    expect(screen.queryByTestId('meta-outbound-audio-recover')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    expect(sendAudio).toHaveBeenCalledTimes(1)
  })

  it('409 graph_in_flight bloqueia recuperação', async () => {
    sendAudio.mockRejectedValueOnce(new MetaOutboundAudioSendError(409, 'graph_in_flight'))
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/em andamento/)
    })
    expect(screen.queryByTestId('meta-outbound-audio-recover')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
  })

  it('200 limpa rascunho e avisa o chat', async () => {
    const onSent = vi.fn()
    const { rerender } = renderComposer(CONV_A, onSent)
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={onSent}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar áudio' }))
    })
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(recorder.clearPreview).toHaveBeenCalled()
  })

  it('troca de conversa não mistura áudio', async () => {
    const { rerender } = renderComposer(CONV_A)
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(mintId).toHaveBeenCalled())
    recorder.cancelRecording.mockClear()
    recorder.clearPreview.mockClear()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_B}
        onSent={vi.fn()}
      />,
    )
    expect(recorder.cancelRecording).toHaveBeenCalled()
    expect(recorder.clearPreview).toHaveBeenCalled()
  })

  it('desmontagem não dispara envio adicional', async () => {
    const { rerender, unmount } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar áudio' })).toBeTruthy())
    unmount()
    expect(sendAudio).not.toHaveBeenCalled()
  })

  it('falha de remux impede envio e não cria operação', async () => {
    remuxAudio.mockResolvedValue({ ok: false, code: 'audio_remux_failed' })
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/preparar o áudio/)
    })
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    expect(mintId).not.toHaveBeenCalled()
    expect(sendAudio).not.toHaveBeenCalled()
  })

  it('áudio inválido não oferece envio', async () => {
    validateSend.mockReturnValue({ ok: false, code: 'invalid_audio' })
    const { rerender } = renderComposer()
    await readyPreview()
    rerender(
      <MetaOutboundAudioComposer
        companyId={COMPANY_ID}
        instanceId={INSTANCE_ID}
        conversationId={CONV_A}
        onSent={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('meta-outbound-audio-error').textContent).toMatch(/AAC-LC/)
    })
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    expect(mintId).not.toHaveBeenCalled()
  })
})

describe('navegador sem AAC-LC MP4', () => {
  it('mostra indisponibilidade quando o MIME MP4 não é suportado', () => {
    mp4MimeState.mime = null
    renderComposer()
    expect(screen.getByTestId('meta-outbound-audio-unavailable')).toBeTruthy()
    expect((screen.getByTestId('meta-outbound-audio-mic') as HTMLButtonElement).disabled).toBe(true)
  })
})

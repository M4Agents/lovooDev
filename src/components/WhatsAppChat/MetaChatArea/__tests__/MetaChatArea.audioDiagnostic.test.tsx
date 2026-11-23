// @vitest-environment jsdom
// =============================================================================
// Diagnóstico DEV isolado + regressão do compositor Meta (texto/template).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { MetaChatArea } from '../MetaChatArea'
import { MetaAudioDiagnosticRecorder } from '../MetaAudioDiagnosticRecorder'
import type { MetaChatConversation, MetaChatMessage } from '../../../../types/meta-whatsapp'

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

vi.mock('../../../../hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => recorder,
}))

vi.mock('../../../../utils/metaAudioRecorderDiagnostic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/metaAudioRecorderDiagnostic')>()
  return {
    ...actual,
    isMetaAudioRecorderDiagnosticEnabled: vi.fn(() => true),
  }
})

vi.mock('../../../../hooks/chat/useMetaChatMessages', () => ({
  useMetaChatMessages: vi.fn(),
}))

vi.mock('../../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    sendMessage:  vi.fn(),
    sendTemplate: vi.fn(),
    importMedia:  vi.fn(),
    sendAudio:    vi.fn(),
  },
}))

vi.mock('../MetaTemplatePicker', () => ({
  MetaTemplatePicker: ({
    open,
    onSend,
  }: {
    open: boolean
    onSend: (t: unknown, p: unknown) => Promise<void>
  }) => {
    if (!open) return null
    return (
      <div data-testid="template-picker-mock">
        <button
          type="button"
          onClick={() =>
            onSend(
              {
                id: 'tpl-mock-001', name: 'hello_world', language: 'pt_BR',
                status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL',
                components: [], parameters: [], supported: true, unsupported_reason: null,
                header_media_format: null, buttons: [],
              },
              { body: { '1': 'João' } },
            )
          }
        >
          Enviar template mock
        </button>
      </div>
    )
  },
}))

import { useMetaChatMessages } from '../../../../hooks/chat/useMetaChatMessages'
import { metaWhatsAppApi } from '../../../../services/metaWhatsAppApi'
import { isMetaAudioRecorderDiagnosticEnabled } from '../../../../utils/metaAudioRecorderDiagnostic'

const mockUseMetaChatMessages = useMetaChatMessages as ReturnType<typeof vi.fn>
const mockSendMessage = metaWhatsAppApi.sendMessage as ReturnType<typeof vi.fn>
const mockSendTemplate = metaWhatsAppApi.sendTemplate as ReturnType<typeof vi.fn>
const mockSendAudio = metaWhatsAppApi.sendAudio as ReturnType<typeof vi.fn>
const mockEnabled = isMetaAudioRecorderDiagnosticEnabled as ReturnType<typeof vi.fn>

const COMPANY_ID = 'company-test-001'
const CONV_ID = 'conv-test-001'
const CONV_ID_B = 'conv-test-002'

const CONV_FULL: MetaChatConversation = {
  id: CONV_ID,
  instance_id: 'inst-001',
  wa_id: '5511999990001',
  contact_name: 'João Silva',
  profile_picture_url: null,
  status: 'active',
  unread_count: 0,
  last_message_at: '2026-09-21T15:00:00.000Z',
  last_message_preview: 'Olá',
  created_at: '2026-09-21T10:00:00.000Z',
  updated_at: '2026-09-21T15:00:00.000Z',
  lead_id: null,
}

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

function renderDiagnostic(conversationId = CONV_ID) {
  return render(
    <MetaAudioDiagnosticRecorder conversationId={conversationId} disabled={false} />,
  )
}

beforeEach(() => {
  if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
  resetRecorder()
  mockEnabled.mockReturnValue(true)
  mockSendMessage.mockReset()
  mockSendMessage.mockResolvedValue({ ok: true })
  mockSendTemplate.mockReset()
  mockSendTemplate.mockResolvedValue({ ok: true })
  mockSendAudio.mockReset()
  mockSendAudio.mockResolvedValue({ ok: true })
  mockUseMetaChatMessages.mockReturnValue({
    messages: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
})

describe('MetaAudioDiagnosticRecorder — B2 isolado', () => {
  it('B2-02: microfone diagnóstico disponível', () => {
    renderDiagnostic()
    expect(screen.getByTestId('meta-audio-mic-button')).toBeTruthy()
    expect(screen.getByTestId('meta-audio-send-blocked-notice').textContent).toMatch(/envio ainda indisponível/i)
  })

  it('B2-04: clique no mic inicia gravação', async () => {
    renderDiagnostic()
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(recorder.startRecording).toHaveBeenCalledTimes(1)
  })

  it('B2-05: durante gravação, Encerrar chama stopRecording', () => {
    recorder.isRecording = true
    recorder.recordingSeconds = 3
    renderDiagnostic()
    fireEvent.click(screen.getByText('Encerrar'))
    expect(recorder.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('B2-06: prévia aparece sem botão Enviar', () => {
    recorder.audioBlobPreview = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.audioMimeType = 'audio/webm'
    recorder.previewDurationSeconds = 2
    renderDiagnostic()
    expect(screen.getByTestId('meta-audio-preview')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
  })

  it('B2-07: cancelar na barra de gravação chama cancelRecording', () => {
    recorder.isRecording = true
    renderDiagnostic()
    fireEvent.click(screen.getByText('Cancelar'))
    expect(recorder.cancelRecording).toHaveBeenCalled()
  })

  it('B2-08: erro de permissão visível', () => {
    recorder.micError = 'permission_denied'
    renderDiagnostic()
    expect(screen.getByTestId('meta-audio-mic-error').textContent).toMatch(/negada/i)
  })

  it('B2-09: troca de conversa dispara cancel e clear da prévia', () => {
    const { rerender } = renderDiagnostic(CONV_ID)
    recorder.cancelRecording.mockClear()
    recorder.clearPreview.mockClear()
    rerender(<MetaAudioDiagnosticRecorder conversationId={CONV_ID_B} disabled={false} />)
    expect(recorder.cancelRecording).toHaveBeenCalled()
    expect(recorder.clearPreview).toHaveBeenCalled()
  })

  it('B2-10: unmount não lança', () => {
    const { unmount } = renderDiagnostic()
    expect(() => unmount()).not.toThrow()
  })

  it('B2-11: diagnóstico não chama sendMessage nem sendAudio', async () => {
    renderDiagnostic()
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockSendAudio).not.toHaveBeenCalled()
  })

  it('B2-16: cancelar prévia chama clearPreview e não envia', () => {
    recorder.audioBlobPreview = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.previewDurationSeconds = 2
    renderDiagnostic()
    fireEvent.click(screen.getByLabelText('Cancelar áudio'))
    expect(recorder.clearPreview).toHaveBeenCalled()
    expect(mockSendAudio).not.toHaveBeenCalled()
  })

  it('B2-17: painel de diagnóstico visível e limite de 180s encerra gravação', () => {
    recorder.isRecording = true
    recorder.recordingSeconds = 180
    renderDiagnostic()
    expect(screen.getByTestId('meta-audio-diagnostic-panel').textContent).toMatch(/WebM/)
    expect(recorder.stopRecording).toHaveBeenCalled()
  })

  it('B2-18: modo automático chama startRecording sem MIME explícito', async () => {
    renderDiagnostic()
    expect(screen.getByTestId('meta-audio-mode-auto')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(recorder.startRecording).toHaveBeenCalledTimes(1)
    expect(recorder.startRecording.mock.calls[0].length).toBe(0)
  })

  it('B2-19: MP4 suportado pode ser selecionado e passa MIME ao gravador', async () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mime: string) => mime.startsWith('audio/mp4') || mime === 'audio/webm',
    })
    renderDiagnostic()
    const mp4 = screen.getByTestId('meta-audio-mode-mp4') as HTMLInputElement
    expect(mp4.disabled).toBe(false)
    fireEvent.click(mp4)
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(recorder.startRecording).toHaveBeenCalledWith({
      mimeType: expect.stringMatching(/^audio\/mp4/),
    })
    vi.unstubAllGlobals()
  })

  it('B2-20: MP4 não suportado não inicia gravação nesse modo', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mime: string) => mime === 'audio/webm',
    })
    renderDiagnostic()
    expect((screen.getByTestId('meta-audio-mode-mp4') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByTestId('meta-audio-mp4-unsupported')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('B2-21: falha de inicialização e finalização são visíveis', () => {
    recorder.recorderError = 'start_failed'
    const { rerender } = renderDiagnostic()
    expect(screen.getByTestId('meta-audio-recorder-error').textContent).toMatch(/iniciar/i)
    recorder.recorderError = 'stop_failed'
    rerender(<MetaAudioDiagnosticRecorder conversationId={CONV_ID} disabled={false} />)
    expect(screen.getByTestId('meta-audio-recorder-error').textContent).toMatch(/encerrar/i)
  })

  it('B2-22: troca de modo cancela gravação anterior', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mime: string) => mime.startsWith('audio/mp4') || mime === 'audio/webm',
    })
    renderDiagnostic()
    recorder.cancelRecording.mockClear()
    recorder.clearPreview.mockClear()
    fireEvent.click(screen.getByTestId('meta-audio-mode-mp4'))
    expect(recorder.cancelRecording).toHaveBeenCalled()
    expect(recorder.clearPreview).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('B3.2B-01: Blob inválido é rejeitado pelo validador B3.1 no painel DEV', async () => {
    recorder.audioBlobPreview = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], { type: 'audio/webm' })
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.audioMimeType = 'audio/webm'
    recorder.previewDurationSeconds = 2
    renderDiagnostic()
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
    await waitFor(() => {
      expect(screen.getByTestId('meta-audio-b31-validation').textContent).toMatch(/rejeitado/i)
    })
    expect(mockSendAudio).not.toHaveBeenCalled()
  })

  it('B3.2B-02: erro de leitura do Blob aparece só no diagnóstico', async () => {
    const failing = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })
    Object.defineProperty(failing, 'arrayBuffer', {
      value: () => Promise.reject(new Error('read fail')),
    })
    recorder.audioBlobPreview = failing
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.audioMimeType = 'audio/mp4'
    recorder.previewDurationSeconds = 1
    renderDiagnostic()
    await waitFor(() => {
      expect(screen.getByTestId('meta-audio-b31-validation').textContent).toMatch(/Erro ao ler o Blob/i)
    })
    expect(mockSendAudio).not.toHaveBeenCalled()
  })
})

describe('MetaChatArea — compositor de texto após E.4', () => {
  it('não monta o diagnóstico DEV no compositor', () => {
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.queryByTestId('meta-audio-diagnostic-root')).toBeNull()
    expect(screen.getByTestId('meta-outbound-audio-root')).toBeTruthy()
  })

  it('envio de texto permanece funcional', async () => {
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'olá meta' } })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Enviar'))
    })
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendAudio).not.toHaveBeenCalled()
  })

  it('envio de template permanece funcional', async () => {
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.click(screen.getByLabelText('Template'))
    await act(async () => {
      fireEvent.click(screen.getByText('Enviar template mock'))
    })
    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
  })

  it('player inbound de áudio permanece', () => {
    const inboundAudio: MetaChatMessage = {
      id: 'inb-aud-b2-001',
      conversation_id: CONV_ID,
      instance_id: 'inst-001',
      direction: 'inbound',
      message_type: 'audio',
      body: null as unknown as string,
      provider_timestamp: '2026-09-21T15:30:00.000Z',
      created_at: '2026-09-21T15:00:00.000Z',
      media: {
        type: 'audio',
        url: 'https://example.com/inbound.ogg',
        filename: 'inbound.ogg',
        mime_type: 'audio/ogg; codecs=opus',
        file_size: 48_000,
      },
      template_buttons: null,
    }
    mockUseMetaChatMessages.mockReturnValue({
      messages: [inboundAudio],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    const audio = screen.getByTestId('msg-media-audio') as HTMLAudioElement
    expect(audio.src).toContain('inbound.ogg')
    expect(audio.controls).toBe(true)
  })
})

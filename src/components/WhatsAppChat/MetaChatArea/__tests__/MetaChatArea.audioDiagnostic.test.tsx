// @vitest-environment jsdom
// =============================================================================
// MetaChatArea.audioDiagnostic.test.tsx — B2 diagnóstico DEV, envio bloqueado
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MetaChatArea } from '../MetaChatArea'
import type { MetaChatConversation, MetaChatMessage } from '../../../../types/meta-whatsapp'

const recorder = {
  isRecording: false,
  recordingSeconds: 0,
  audioBlobPreview: null as Blob | null,
  audioPreviewUrl: null as string | null,
  audioMimeType: null as string | null,
  previewDurationSeconds: 0,
  micError: null as 'permission_denied' | 'unavailable' | 'unknown' | null,
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
    isMetaAudioRecorderDiagnosticEnabled: vi.fn(() => false),
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
}

function resetRecorder() {
  recorder.isRecording = false
  recorder.recordingSeconds = 0
  recorder.audioBlobPreview = null
  recorder.audioPreviewUrl = null
  recorder.audioMimeType = null
  recorder.previewDurationSeconds = 0
  recorder.micError = null
  recorder.startRecording.mockClear()
  recorder.stopRecording.mockClear()
  recorder.cancelRecording.mockClear()
  recorder.clearPreview.mockClear()
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
  mockEnabled.mockReturnValue(false)
  mockSendMessage.mockReset()
  mockSendMessage.mockResolvedValue({ ok: true })
  mockSendTemplate.mockReset()
  mockSendTemplate.mockResolvedValue({ ok: true })
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

describe('MetaChatArea — B2 áudio diagnóstico', () => {
  it('B2-01: flag desligada → microfone ausente', () => {
    mockEnabled.mockReturnValue(false)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.queryByTestId('meta-audio-mic-button')).toBeNull()
    expect(screen.queryByTestId('meta-audio-diagnostic-root')).toBeNull()
  })

  it('B2-02: flag ligada no DEV → microfone disponível', () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByTestId('meta-audio-mic-button')).toBeTruthy()
    expect(screen.getByTestId('meta-audio-send-blocked-notice').textContent).toMatch(/envio ainda indisponível/i)
  })

  it('B2-03: função de gate falsa (produção/host bloqueado) → microfone ausente', () => {
    mockEnabled.mockReturnValue(false)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.queryByTestId('meta-audio-mic-button')).toBeNull()
  })

  it('B2-04: clique no mic inicia gravação', async () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(recorder.startRecording).toHaveBeenCalledTimes(1)
  })

  it('B2-05: durante gravação, Encerrar chama stopRecording', () => {
    mockEnabled.mockReturnValue(true)
    recorder.isRecording = true
    recorder.recordingSeconds = 3
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByTestId('meta-audio-recording-bar')).toBeTruthy()
    fireEvent.click(screen.getByText('Encerrar'))
    expect(recorder.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('B2-06: prévia aparece sem botão Enviar', () => {
    mockEnabled.mockReturnValue(true)
    recorder.audioBlobPreview = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.audioMimeType = 'audio/webm'
    recorder.previewDurationSeconds = 2
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByTestId('meta-audio-preview')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar áudio' })).toBeNull()
  })

  it('B2-07: cancelar na barra de gravação chama cancelRecording', () => {
    mockEnabled.mockReturnValue(true)
    recorder.isRecording = true
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(recorder.cancelRecording).toHaveBeenCalled()
  })

  it('B2-08: erro de permissão visível', () => {
    mockEnabled.mockReturnValue(true)
    recorder.micError = 'permission_denied'
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByTestId('meta-audio-mic-error').textContent).toMatch(/negada/i)
  })

  it('B2-09: troca de conversa dispara cancel e clear da prévia', () => {
    mockEnabled.mockReturnValue(true)
    const { rerender } = render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />,
    )
    recorder.cancelRecording.mockClear()
    recorder.clearPreview.mockClear()
    rerender(
      <MetaChatArea
        companyId={COMPANY_ID}
        conversationId={CONV_ID_B}
        conversation={{ ...CONV_FULL, id: CONV_ID_B }}
      />,
    )
    expect(recorder.cancelRecording).toHaveBeenCalled()
    expect(recorder.clearPreview).toHaveBeenCalled()
  })

  it('B2-10: unmount não lança', () => {
    mockEnabled.mockReturnValue(true)
    const { unmount } = render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />,
    )
    expect(() => unmount()).not.toThrow()
  })

  it('B2-11: envio de áudio impossível — sendMessage não é chamado pelo mic', async () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('meta-audio-mic-button'))
    })
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId('meta-audio-send-blocked-notice')).toBeTruthy()
  })

  it('B2-12: compositor de texto permanece com flag ligada', () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByLabelText('Mensagem')).toBeTruthy()
    expect(screen.getByLabelText('Enviar')).toBeTruthy()
    expect(screen.getByLabelText('Template')).toBeTruthy()
  })

  it('B2-13: envio de texto continua funcionando com diagnóstico ligado', async () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'olá meta' } })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Enviar'))
    })
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage.mock.calls[0][0]).toBe(COMPANY_ID)
  })

  it('B2-14: envio de template continua funcionando com diagnóstico ligado', async () => {
    mockEnabled.mockReturnValue(true)
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.click(screen.getByLabelText('Template'))
    await act(async () => {
      fireEvent.click(screen.getByText('Enviar template mock'))
    })
    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
  })

  it('B2-15: player inbound de áudio permanece com diagnóstico ligado', () => {
    mockEnabled.mockReturnValue(true)
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
    expect(screen.getByTestId('meta-audio-mic-button')).toBeTruthy()
  })

  it('B2-16: cancelar prévia chama clearPreview e não envia', () => {
    mockEnabled.mockReturnValue(true)
    recorder.audioBlobPreview = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
    recorder.audioPreviewUrl = 'blob:http://localhost/fake-audio'
    recorder.audioMimeType = 'audio/webm'
    recorder.previewDurationSeconds = 2
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    fireEvent.click(screen.getByLabelText('Cancelar áudio'))
    expect(recorder.clearPreview).toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('B2-17: painel de diagnóstico visível e limite de 180s encerra gravação', () => {
    mockEnabled.mockReturnValue(true)
    recorder.isRecording = true
    recorder.recordingSeconds = 180
    render(<MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />)
    expect(screen.getByTestId('meta-audio-diagnostic-panel').textContent).toMatch(/WebM/)
    expect(recorder.stopRecording).toHaveBeenCalled()
  })
})

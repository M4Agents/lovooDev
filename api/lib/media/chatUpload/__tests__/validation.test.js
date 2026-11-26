import { describe, expect, it } from 'vitest'
import { LIBRARY_MIME_TYPES } from '../../libraryUpload/constants.js'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_OTHER_MAX_BYTES,
} from '../constants.js'
import { ChatUploadError } from '../errors.js'
import { validateChatUploadRequest } from '../validation.js'

const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const CONVERSATION_ID = 'cccc0000-0000-4000-8000-000000000003'
const INSTANCE_ID = 'dddd0000-0000-4000-8000-000000000004'
const FLOW_ID = 'eeee0000-0000-4000-8000-000000000005'

const PRESERVED_AUDIO = Object.freeze([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
])

function request(overrides = {}) {
  const body = {
    companyId: COMPANY_ID,
    purpose: 'chat_manual',
    conversationId: CONVERSATION_ID,
    messageType: 'image',
    fileName: 'foto.png',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    ...overrides,
  }
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key]
  }
  return body
}

function statusOf(body) {
  try {
    validateChatUploadRequest(body)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(ChatUploadError)
    return error.status
  }
}

describe('validação do upload do chat', () => {
  it('exige o identificador da finalidade e rejeita combinação indevida', () => {
    const manual = validateChatUploadRequest(request())
    expect(manual.conversationId).toBe(CONVERSATION_ID)
    expect(manual.instanceId).toBeNull()
    expect(manual.flowId).toBeNull()

    const scheduled = validateChatUploadRequest(request({
      purpose: 'chat_schedule',
      instanceId: INSTANCE_ID,
      messageType: 'document',
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
    }))
    expect(scheduled.conversationId).toBe(CONVERSATION_ID)
    expect(scheduled.instanceId).toBe(INSTANCE_ID)
    expect(scheduled.flowId).toBeNull()

    const automation = validateChatUploadRequest(request({
      purpose: 'automation_audio',
      conversationId: undefined,
      messageType: 'audio',
      mimeType: 'audio/webm',
      fileName: 'gravacao.webm',
      flowId: FLOW_ID,
    }))
    expect(automation.flowId).toBe(FLOW_ID)
    expect(automation.conversationId).toBeNull()
    expect(automation.instanceId).toBeNull()

    expect(statusOf(request({ conversationId: undefined }))).toBe(400)
    expect(statusOf(request({ flowId: FLOW_ID }))).toBe(400)
    expect(statusOf(request({
      purpose: 'chat_schedule',
      instanceId: undefined,
    }))).toBe(400)
    expect(statusOf(request({
      purpose: 'automation_audio',
      conversationId: CONVERSATION_ID,
      flowId: FLOW_ID,
      messageType: 'audio',
      mimeType: 'audio/ogg',
    }))).toBe(400)
    expect(statusOf(request({ purpose: 'catalog' }))).toBe(400)
  })

  it.each(PRESERVED_AUDIO)('preserva o áudio %s sem reclassificar', (mimeType) => {
    const extension = mimeType.split('/').pop().replace(/^\x-/, '')
    const result = validateChatUploadRequest(request({
      messageType: 'audio',
      mimeType,
      fileName: `audio.${extension}`,
    }))
    expect(result.messageType).toBe('audio')
    expect(result.mimeType).toBe(mimeType)
    expect(result.contentType).toBe(mimeType)
    expect(result.mimeType).not.toBe('video/mp4')
    expect(result.mimeType).not.toBe('application/octet-stream')
  })

  it('aceita o prefixo atual e recusa MIME incoerente ou vazio fora de documento', () => {
    expect(validateChatUploadRequest(request({
      messageType: 'video',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
    })).mimeType).toBe('video/mp4')
    expect(validateChatUploadRequest(request({
      messageType: 'audio',
      mimeType: 'audio/amr',
      fileName: 'nota.amr',
    })).mimeType).toBe('audio/amr')
    expect(validateChatUploadRequest(request({
      messageType: 'document',
      mimeType: 'application/zip',
      fileName: 'pacote.zip',
    })).mimeType).toBe('application/zip')

    const empty = validateChatUploadRequest(request({
      messageType: 'document',
      mimeType: '',
      fileName: 'sem-tipo.bin',
    }))
    expect(empty.mimeType).toBe('application/octet-stream')
    expect(empty.messageType).toBe('document')

    expect(statusOf(request({ mimeType: '' }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'document',
      mimeType: 'audio/webm',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    const parameterized = validateChatUploadRequest(request({
      mimeType: 'image/jpeg;charset=binary',
    }))
    expect(parameterized.mimeType).toBe('image/jpeg')
    expect(parameterized.contentType).toBe('image/jpeg')
    expect(parameterized.messageType).toBe('image')
    expect(LIBRARY_MIME_TYPES).not.toContain('audio/webm')
  })

  it('restringe automação a áudio e mantém os limites inclusivos', () => {
    expect(statusOf(request({
      purpose: 'automation_audio',
      conversationId: undefined,
      flowId: FLOW_ID,
      messageType: 'image',
      mimeType: 'image/png',
      fileName: 'foto.png',
    }))).toBe(415)
    expect(statusOf(request({ sizeBytes: CHAT_IMAGE_MAX_BYTES }))).toBeNull()
    expect(statusOf(request({ sizeBytes: CHAT_IMAGE_MAX_BYTES + 1 }))).toBe(413)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/mpeg',
      fileName: 'audio.mp3',
      sizeBytes: CHAT_OTHER_MAX_BYTES,
    }))).toBeNull()
    expect(statusOf(request({
      messageType: 'document',
      mimeType: '',
      fileName: 'sem-tipo.bin',
      sizeBytes: CHAT_OTHER_MAX_BYTES + 1,
    }))).toBe(413)
  })

  it('preserva a extensão e recusa nome com caminho', () => {
    expect(validateChatUploadRequest(request({
      fileName: 'relatório final.pdf',
      messageType: 'document',
      mimeType: 'application/pdf',
    })).safeFileName).toBe('relatorio_final.pdf')
    expect(validateChatUploadRequest(request({
      messageType: 'audio',
      mimeType: 'audio/webm',
      fileName: '🎤 gravacao.webm',
    })).safeFileName).toBe('arquivo.webm')
    expect(statusOf(request({ fileName: '../segredo.pdf' }))).toBe(400)
    expect(statusOf(request({ fileName: 'pasta/foto.png' }))).toBe(400)
  })

  it('normaliza parâmetros de áudio e guarda conteúdo ativo como octet-stream', () => {
    const webm = validateChatUploadRequest(request({
      messageType: 'audio',
      mimeType: 'audio/webm;codecs=opus',
      fileName: 'gravacao.webm',
    }))
    expect(webm.messageType).toBe('audio')
    expect(webm.mimeType).toBe('audio/webm')
    expect(webm.contentType).toBe('audio/webm')
    expect(webm.safeFileName).toBe('gravacao.webm')

    const ogg = validateChatUploadRequest(request({
      messageType: 'audio',
      mimeType: 'audio/ogg;codecs=opus',
      fileName: 'gravacao.ogg',
    }))
    expect(ogg.mimeType).toBe('audio/ogg')
    expect(ogg.contentType).toBe('audio/ogg')
    expect(ogg.safeFileName).toBe('gravacao.ogg')

    const svg = validateChatUploadRequest(request({
      mimeType: 'image/svg+xml',
      fileName: 'icone.svg',
    }))
    expect(svg.messageType).toBe('image')
    expect(svg.mimeType).toBe('image/svg+xml')
    expect(svg.contentType).toBe('application/octet-stream')

    const html = validateChatUploadRequest(request({
      messageType: 'document',
      mimeType: 'text/html;charset=utf-8',
      fileName: 'pagina.html',
    }))
    expect(html.messageType).toBe('document')
    expect(html.mimeType).toBe('text/html')
    expect(html.contentType).toBe('application/octet-stream')

    const xhtml = validateChatUploadRequest(request({
      messageType: 'document',
      mimeType: 'application/xhtml+xml',
      fileName: 'pagina.xhtml',
    }))
    expect(xhtml.mimeType).toBe('application/xhtml+xml')
    expect(xhtml.contentType).toBe('application/octet-stream')

    expect(statusOf(request({
      messageType: 'video',
      mimeType: 'audio/webm;codecs=opus',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/webm;',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/webm;codecs',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/webm;codecs=',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/webm; codecs=opus',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'audio',
      mimeType: 'audio/webm;codecs=opus\r\n',
      fileName: 'gravacao.webm',
    }))).toBe(415)
    expect(statusOf(request({
      messageType: 'document',
      mimeType: 'text/html\r\nX-Injected: 1',
      fileName: 'pagina.html',
    }))).toBe(415)
  })
})

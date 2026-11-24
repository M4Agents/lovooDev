import { describe, expect, it, vi } from 'vitest'
import {
  classifyMetaOutboundAudioSend,
  freezeOutboundAudioFile,
  isOutboundAudioOperationId,
  messageForMetaAudioSend,
  mintOutboundAudioOperationId,
  validateOutboundAudioBytesForSend,
} from '../metaOutboundAudioSend'
import { META_OUTBOUND_AUDIO_MAX_BYTES } from '../../../api/lib/meta-whatsapp/audioBytes.js'

describe('metaOutboundAudioSend', () => {
  it('mintOutboundAudioOperationId gera UUIDv4 minúsculo', () => {
    const id = mintOutboundAudioOperationId()
    expect(isOutboundAudioOperationId(id)).toBe(true)
    expect(id).toBe(id.toLowerCase())
  })

  it('congela bytes em File audio/mp4 audio.m4a sem alias WebM', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = freezeOutboundAudioFile(bytes)
    expect(file.name).toBe('audio.m4a')
    expect(file.type).toBe('audio/mp4')
    bytes[0] = 9
    expect(file.size).toBe(4)
  })

  it('rejeita WebM, fMP4 fragmentado e arquivo grande demais', () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
    expect(validateOutboundAudioBytesForSend(webm)).toEqual({ ok: false, code: 'invalid_audio' })
    const huge = new Uint8Array(META_OUTBOUND_AUDIO_MAX_BYTES + 1)
    expect(validateOutboundAudioBytesForSend(huge).code).toBe('audio_too_large')
    const fmp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
      0x00, 0x00, 0x00, 0x10, 0x6d, 0x6f, 0x6f, 0x76, 0x00, 0x00, 0x00, 0x08, 0x6d, 0x76, 0x65, 0x78,
    ])
    expect(validateOutboundAudioBytesForSend(fmp4)).toEqual({ ok: false, code: 'invalid_audio' })
  })

  it('classifica 501, 503, unknown e 200', () => {
    expect(classifyMetaOutboundAudioSend(501, 'audio_send_not_enabled')).toMatchObject({
      kind: 'not_enabled',
      allowRecover: false,
      allowNewOperation: false,
      keepDraft: true,
    })
    expect(classifyMetaOutboundAudioSend(503, 'persist_deadline_insufficient')).toMatchObject({
      kind: 'recoverable',
      allowRecover: true,
      allowNewOperation: false,
    })
    expect(classifyMetaOutboundAudioSend(500, 'send_persistence_failed').allowRecover).toBe(true)
    expect(classifyMetaOutboundAudioSend(0, 'network_error').allowRecover).toBe(true)
    expect(classifyMetaOutboundAudioSend(409, 'operation_unknown')).toMatchObject({
      kind: 'blocked',
      allowRecover: false,
      allowNewOperation: false,
    })
    expect(classifyMetaOutboundAudioSend(409, 'operation_in_progress').kind).toBe('blocked')
    expect(classifyMetaOutboundAudioSend(409, 'graph_in_flight').kind).toBe('blocked')
    expect(classifyMetaOutboundAudioSend(200, 'ok').kind).toBe('success')
    expect(classifyMetaOutboundAudioSend(409, 'customer_service_window_closed')).toMatchObject({
      kind: 'error',
      allowRecover: false,
      allowNewOperation: false,
    })
    expect(classifyMetaOutboundAudioSend(409, 'customer_service_window_unproven').kind).toBe('error')
    expect(classifyMetaOutboundAudioSend(409, '131047').code).toBe('131047')
  })

  it('501 não afirma sucesso', () => {
    expect(messageForMetaAudioSend('not_enabled', 'audio_send_not_enabled')).toBe(
      'Envio de áudio Meta ainda indisponível',
    )
    expect(messageForMetaAudioSend('not_enabled', 'audio_send_not_enabled')).not.toMatch(/enviado/)
    expect(messageForMetaAudioSend('not_enabled', 'audio_send_not_enabled')).not.toMatch(/Recupere/)
  })

  it('mensagens distinguem persistência, incerteza e bloqueio', () => {
    expect(messageForMetaAudioSend('recoverable', 'send_persistence_failed')).toMatch(/pode já ter sido enviado/)
    expect(messageForMetaAudioSend('recoverable', 'network_error')).toMatch(/Não foi possível confirmar/)
    expect(messageForMetaAudioSend('blocked', 'operation_unknown')).toMatch(/Não envie de novo/)
    expect(messageForMetaAudioSend('blocked', 'graph_in_flight')).toMatch(/Não envie de novo/)
    expect(messageForMetaAudioSend('blocked', 'operation_in_progress')).not.toMatch(/Enviar novamente/)
    expect(messageForMetaAudioSend('error', 'audio_remux_failed')).toMatch(/Grave novamente/)
    expect(messageForMetaAudioSend('error', 'customer_service_window_closed')).toMatch(/template aprovado/)
    expect(messageForMetaAudioSend('error', '131047')).toMatch(/janela de 24 horas/)
    expect(messageForMetaAudioSend('error', 'customer_service_window_unproven')).toMatch(/template aprovado/)
  })

  it('não usa crypto.randomUUID duas vezes no helper de mint por chamada', () => {
    const spy = vi.spyOn(crypto, 'randomUUID')
    mintOutboundAudioOperationId()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readDiagnosticBlobBytes,
  summarizeOutboundAudioValidation,
  validateDiagnosticAudioBlob,
  validateDiagnosticAudioBytes,
} from '../metaOutboundAudioValidation'

const META_OUTBOUND_AUDIO_MAX_BYTES = 4 * 1024 * 1024

function u32(n: number): Uint8Array {
  const v = n >>> 0
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function fourcc(type: string): Uint8Array {
  return new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat([u32(8 + payload.length), fourcc(type), payload])
}

function hdlr(handler: string): Uint8Array {
  return box('hdlr', concat([new Uint8Array(8), fourcc(handler), new Uint8Array(12), new Uint8Array([0x00])]))
}

function mp4aPayload(extra: Uint8Array | null): Uint8Array {
  const fields = new Uint8Array(28)
  fields[7] = 0x01
  fields[17] = 0x02
  fields[19] = 0x10
  fields.set(u32((44100 * 65536) >>> 0), 24)
  return extra ? concat([fields, extra]) : fields
}

function esdsAacLc(): Uint8Array {
  return box('esds', new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x19,
    0x00, 0x00,
    0x00,
    0x04, 0x11,
    0x40,
    0x15,
    0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02,
    0x12, 0x10,
    0x06, 0x01,
    0x02,
  ]))
}

function stsdWith(sampleEntry: Uint8Array): Uint8Array {
  return box('stsd', concat([new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), sampleEntry]))
}

function audioTrack(withEsds: boolean): Uint8Array {
  const sample = box('mp4a', mp4aPayload(withEsds ? esdsAacLc() : null))
  return box('trak', box('mdia', concat([
    hdlr('soun'),
    box('minf', box('stbl', stsdWith(sample))),
  ])))
}

function ftypBox(): Uint8Array {
  return box('ftyp', concat([fourcc('isom'), u32(0), fourcc('isom'), fourcc('iso2'), fourcc('mp41')]))
}

function buildAudioMp4(withEsds = false): Uint8Array {
  return concat([ftypBox(), box('moov', audioTrack(withEsds))])
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in B3.2-B diagnostic validation tests')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('summarizeOutboundAudioValidation', () => {
  it('AAC-LC confirmado', () => {
    const view = summarizeOutboundAudioValidation({
      ok: true,
      container: 'mp4',
      sampleEntry: 'mp4a',
      hasAudio: true,
      hasVideo: false,
      audioCodec: 'aac',
      aacProfile: 'lc',
    })
    expect(view.status).toBe('aac_lc')
    expect(view.label).toBe('AAC-LC confirmado')
  })

  it('MP4 inconclusivo', () => {
    const view = summarizeOutboundAudioValidation({
      ok: true,
      container: 'mp4',
      sampleEntry: 'mp4a',
      hasAudio: true,
      hasVideo: false,
      audioCodec: 'unconfirmed',
      aacProfile: null,
    })
    expect(view.status).toBe('unconfirmed')
    expect(view.label).toBe('inconclusivo')
  })

  it('arquivo inválido', () => {
    const view = summarizeOutboundAudioValidation({
      ok: false,
      code: 'unsupported_audio_container',
      reason: 'webm_or_ebml',
    })
    expect(view.status).toBe('rejected')
    expect(view.label).toMatch(/rejeitado/)
    expect(view.reason).toBe('webm_or_ebml')
  })
})

describe('validateDiagnosticAudioBytes — B3.1 real', () => {
  it('MP4/AAC-LC sintético válido', async () => {
    const result = await validateDiagnosticAudioBytes(buildAudioMp4(true), 'localhost')
    expect(result.status).toBe('aac_lc')
    expect(result.label).toBe('AAC-LC confirmado')
    expect(result.audioCodec).toBe('aac')
    expect(result.aacProfile).toBe('lc')
  })

  it('MP4 inconclusivo sem esds', async () => {
    const result = await validateDiagnosticAudioBytes(buildAudioMp4(false), 'localhost')
    expect(result.status).toBe('unconfirmed')
    expect(result.label).toBe('inconclusivo')
  })

  it('arquivo inválido (WebM)', async () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01])
    const result = await validateDiagnosticAudioBytes(webm, 'localhost')
    expect(result.status).toBe('rejected')
    expect(result.code).toBe('unsupported_audio_container')
    expect(result.reason).toBe('webm_or_ebml')
  })

  it('arquivo acima de 4 MB', async () => {
    const bytes = new Uint8Array(META_OUTBOUND_AUDIO_MAX_BYTES + 1)
    const result = await validateDiagnosticAudioBytes(bytes, 'localhost')
    expect(result.status).toBe('rejected')
    expect(result.code).toBe('audio_too_large')
    expect(result.reason).toBe('too_large')
  })

  it('produção não executa o validador', async () => {
    const bytes = buildAudioMp4(true)
    const result = await validateDiagnosticAudioBytes(bytes, 'app.lovoocrm.com')
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('diagnostic_disabled')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('validateDiagnosticAudioBlob', () => {
  it('lê o Blob e valida AAC-LC sintético', async () => {
    const bytes = buildAudioMp4(true)
    const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' })
    const result = await validateDiagnosticAudioBlob(blob, 'localhost')
    expect(result.status).toBe('aac_lc')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('erro de leitura do Blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => Promise.reject(new Error('read fail')),
    })
    const result = await validateDiagnosticAudioBlob(blob, 'localhost')
    expect(result.status).toBe('read_error')
    expect(result.label).toMatch(/Erro ao ler o Blob/)
  })

  it('produção não lê nem valida o Blob', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4))
    const blob = { size: 4, type: 'audio/mp4', arrayBuffer } as unknown as Blob
    const result = await validateDiagnosticAudioBlob(blob, 'app.lovoocrm.com')
    expect(result.status).toBe('skipped')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})

describe('readDiagnosticBlobBytes', () => {
  it('retorna null quando arrayBuffer rejeita', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' })
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () => Promise.reject(new Error('fail')),
    })
    await expect(readDiagnosticBlobBytes(blob)).resolves.toBeNull()
  })
})

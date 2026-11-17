import { describe, expect, it, vi } from 'vitest'
import {
  analyzeAudioBlob,
  describeMetaAcceptance,
  formatByteSignature,
  guessAudioContainer,
  isMetaAudioRecorderDiagnosticEnabled,
  probeMediaRecorderSupport,
  selectSupportedMp4MimeType,
} from '../metaAudioRecorderDiagnostic'

describe('isMetaAudioRecorderDiagnosticEnabled', () => {
  it('localhost habilitado sem flag', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('localhost')).toBe(true)
  })

  it('127.0.0.1 habilitado sem flag', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('127.0.0.1')).toBe(true)
  })

  it('::1 habilitado sem flag', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('::1')).toBe(true)
  })

  it('lovoo-dev.vercel.app habilitado sem flag', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-dev.vercel.app')).toBe(true)
    expect(isMetaAudioRecorderDiagnosticEnabled('LOVOO-DEV.VERCEL.APP')).toBe(true)
    expect(isMetaAudioRecorderDiagnosticEnabled('  lovoo-dev.vercel.app  ')).toBe(true)
  })

  it('app.lovoocrm.com bloqueado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('app.lovoocrm.com')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('APP.LOVOOCRM.COM')).toBe(false)
  })

  it('outros domínios de produção bloqueados', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoocrm.com')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('www.lovoocrm.com')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('www.app.lovoocrm.com')).toBe(false)
  })

  it('previews Vercel não autorizados bloqueados', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('example.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-dev-git-main.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-xxxxx.vercel.app')).toBe(false)
  })

  it('hostname vazio bloqueado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('   ')).toBe(false)
  })

  it('subdomínios falsos, substring e hostnames malformados bloqueados', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('www.lovoo-dev.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('evil.lovoo-dev.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-dev.vercel.app.evil.com')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('notlovoo-dev.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('https://lovoo-dev.vercel.app')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-dev.vercel.app/chat')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('lovoo-dev.vercel.app:443')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('user@lovoo-dev.vercel.app')).toBe(false)
  })
})

describe('guessAudioContainer', () => {
  it('EBML → webm_or_ebml', () => {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
    expect(guessAudioContainer(bytes).container).toBe('webm_or_ebml')
  })

  it('OggS não afirma Opus', () => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0])
    const result = guessAudioContainer(bytes)
    expect(result.container).toBe('ogg')
    expect(result.note).toMatch(/NÃO foi confirmado/i)
  })

  it('ftyp não afirma que é só áudio', () => {
    const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
    const result = guessAudioContainer(bytes)
    expect(result.container).toBe('mp4_iso_bmff')
    expect(result.note).toMatch(/vídeo/i)
  })

  it('vazio → empty', () => {
    expect(guessAudioContainer(new Uint8Array()).container).toBe('empty')
  })
})

describe('analyzeAudioBlob', () => {
  it('codecConfirmed é sempre false', () => {
    const header = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0])
    const blob = new Blob([header], { type: 'audio/ogg' })
    const analysis = analyzeAudioBlob(blob, 'audio/ogg', 2, header.buffer)
    expect(analysis.codecConfirmed).toBe(false)
    expect(analysis.metaAcceptance).toBe(describeMetaAcceptance('ogg'))
    expect(analysis.sizeBytes).toBe(blob.size)
  })

  it('Blob WebM/EBML continua identificado como WebM', () => {
    const header = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])
    const blob = new Blob([header], { type: 'audio/webm' })
    const analysis = analyzeAudioBlob(blob, 'audio/webm', 4, header.buffer)
    expect(analysis.container).toBe('webm_or_ebml')
    expect(analysis.codecConfirmed).toBe(false)
  })

  it('Blob com ftyp é identificado como MP4/ISO-BMFF, codec não confirmado', () => {
    const header = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
    const blob = new Blob([header], { type: 'audio/mp4' })
    const analysis = analyzeAudioBlob(blob, 'audio/mp4', 4, header.buffer)
    expect(analysis.container).toBe('mp4_iso_bmff')
    expect(analysis.codecConfirmed).toBe(false)
    expect(analysis.containerNote).toMatch(/vídeo|M4A/i)
  })

  it('MIME declarado MP4 com assinatura WebM NÃO é tratado como MP4 válido', () => {
    const header = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])
    const blob = new Blob([header], { type: 'audio/mp4' })
    const analysis = analyzeAudioBlob(blob, 'audio/mp4', 2, header.buffer)
    expect(analysis.container).toBe('webm_or_ebml')
    expect(analysis.mimeContainerMismatch).toBe(true)
    expect(analysis.metaAcceptance).toBe(describeMetaAcceptance('webm_or_ebml'))
  })
})

describe('selectSupportedMp4MimeType', () => {
  it('retorna o primeiro candidato suportado', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mime: string) => mime === 'audio/mp4',
    })
    expect(selectSupportedMp4MimeType()).toBe('audio/mp4')
    vi.unstubAllGlobals()
  })

  it('retorna null quando nenhuma variante MP4 é suportada', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: () => false,
    })
    expect(selectSupportedMp4MimeType()).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('formatByteSignature', () => {
  it('formata os primeiros bytes em hex', () => {
    expect(formatByteSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('1A 45 DF A3')
  })
})

describe('probeMediaRecorderSupport', () => {
  it('sem MediaRecorder retorna nulls, não lança', () => {
    const result = probeMediaRecorderSupport()
    expect(result['audio/webm'] === null || typeof result['audio/webm'] === 'boolean').toBe(true)
  })
})

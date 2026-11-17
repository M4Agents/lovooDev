import { describe, expect, it } from 'vitest'
import {
  analyzeAudioBlob,
  describeMetaAcceptance,
  guessAudioContainer,
  isMetaAudioRecorderDiagnosticEnabled,
  probeMediaRecorderSupport,
} from '../metaAudioRecorderDiagnostic'

describe('isMetaAudioRecorderDiagnosticEnabled', () => {
  it('flag ausente → desligado mesmo em localhost', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled(undefined, 'localhost')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('', 'localhost')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('TRUE', 'localhost')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('1', 'lovoo-dev.vercel.app')).toBe(false)
  })

  it('flag true + localhost → ligado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'localhost')).toBe(true)
    expect(isMetaAudioRecorderDiagnosticEnabled('true', '127.0.0.1')).toBe(true)
    expect(isMetaAudioRecorderDiagnosticEnabled('true', '::1')).toBe(true)
  })

  it('flag true + lovoo-dev.vercel.app → ligado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'lovoo-dev.vercel.app')).toBe(true)
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'LOVOO-DEV.VERCEL.APP')).toBe(true)
  })

  it('flag true + app.lovoocrm.com → desligado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'app.lovoocrm.com')).toBe(false)
  })

  it('flag true + hostname de preview/produção extra → desligado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'lovoocrm.com')).toBe(false)
    expect(isMetaAudioRecorderDiagnosticEnabled('true', 'example.vercel.app')).toBe(false)
  })

  it('hostname vazio → desligado', () => {
    expect(isMetaAudioRecorderDiagnosticEnabled('true', '')).toBe(false)
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
})

describe('probeMediaRecorderSupport', () => {
  it('sem MediaRecorder retorna nulls, não lança', () => {
    const result = probeMediaRecorderSupport()
    expect(result['audio/webm'] === null || typeof result['audio/webm'] === 'boolean').toBe(true)
  })
})

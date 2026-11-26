import { describe, expect, it } from 'vitest'
import {
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_MIME_TYPES,
  LIBRARY_OTHER_MAX_BYTES,
} from '../constants.js'
import { LibraryUploadError } from '../errors.js'
import { validateLibraryUploadRequest } from '../validation.js'

const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const FOLDER_ID = 'cccc0000-0000-4000-8000-000000000003'

function request(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    folderId: FOLDER_ID,
    fileName: 'foto.png',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    ...overrides,
  }
}

function statusOf(body) {
  try {
    validateLibraryUploadRequest(body)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(LibraryUploadError)
    return error.status
  }
}

describe('validação do upload da biblioteca', () => {
  it.each(LIBRARY_MIME_TYPES)('aceita o MIME literal %s', (mimeType) => {
    const fileType = mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('video/')
        ? 'video'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'document'
    const result = validateLibraryUploadRequest(request({
      mimeType,
      fileName: 'arquivo.bin',
      sizeBytes: fileType === 'image' ? LIBRARY_IMAGE_MAX_BYTES : LIBRARY_OTHER_MAX_BYTES,
    }))
    expect(result.mimeType).toBe(mimeType)
    expect(result.fileType).toBe(fileType)
  })

  it('não converte aliases para o MIME canônico', () => {
    const jpeg = validateLibraryUploadRequest(request({ mimeType: 'image/jpg', fileName: 'foto.jpg' }))
    const audio = validateLibraryUploadRequest(request({ mimeType: 'audio/mp3', fileName: 'audio.mp3' }))
    const quicktime = validateLibraryUploadRequest(request({ mimeType: 'video/quicktime', fileName: 'clip.mov' }))
    expect(jpeg.mimeType).toBe('image/jpg')
    expect(audio.mimeType).toBe('audio/mp3')
    expect(quicktime.mimeType).toBe('video/quicktime')
  })

  it('aceita os limites inclusivos e rejeita um byte acima', () => {
    expect(statusOf(request({ sizeBytes: LIBRARY_IMAGE_MAX_BYTES }))).toBeNull()
    expect(statusOf(request({ sizeBytes: LIBRARY_IMAGE_MAX_BYTES + 1 }))).toBe(413)
    expect(statusOf(request({
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: LIBRARY_OTHER_MAX_BYTES,
    }))).toBeNull()
    expect(statusOf(request({
      mimeType: 'audio/mpeg',
      fileName: 'audio.mp3',
      sizeBytes: LIBRARY_OTHER_MAX_BYTES + 1,
    }))).toBe(413)
    expect(statusOf(request({
      mimeType: 'application/pdf',
      fileName: 'doc.pdf',
      sizeBytes: LIBRARY_OTHER_MAX_BYTES + 1,
    }))).toBe(413)
  })

  it('rejeita SVG, octet-stream, curingas e MIME fora da lista', () => {
    const rejected = [
      'image/svg+xml',
      'application/octet-stream',
      'image/*',
      'video/webm',
      'audio/aac',
      'text/plain',
      'image/JPEG',
      'image/png; charset=utf-8',
      ' image/png',
    ]
    for (const mimeType of rejected) {
      expect(statusOf(request({ mimeType }))).toBe(415)
    }
  })

  it('rejeita corpo, tamanho, identificadores e nomes inseguros', () => {
    expect(statusOf(null)).toBe(400)
    expect(statusOf([])).toBe(400)
    expect(statusOf(request({ extra: true }))).toBe(400)
    expect(statusOf({ ...request(), companyId: undefined })).toBe(400)
    expect(statusOf(request({ sizeBytes: '1024' }))).toBe(400)
    expect(statusOf(request({ sizeBytes: 0 }))).toBe(400)
    expect(statusOf(request({ sizeBytes: 1.5 }))).toBe(400)
    expect(statusOf(request({ companyId: 'empresa' }))).toBe(400)
    expect(statusOf(request({ folderId: 'pasta' }))).toBe(400)
    expect(statusOf(request({ fileName: '../foto.png' }))).toBe(400)
    expect(statusOf(request({ fileName: 'pasta/foto.png' }))).toBe(400)
    expect(statusOf(request({ fileName: 'pasta\\foto.png' }))).toBe(400)
    expect(statusOf(request({ fileName: '.oculto.png' }))).toBe(400)
    expect(statusOf(request({ fileName: '' }))).toBe(400)
    expect(statusOf(request({ fileName: 'a'.repeat(201) }))).toBe(400)
    expect(statusOf(request({ fileName: 'foto\u0000.png' }))).toBe(400)
  })

  it('sanitiza o nome sem alterar o original', () => {
    const result = validateLibraryUploadRequest(request({ fileName: 'Relatório final.png' }))
    expect(result.originalFileName).toBe('Relatório final.png')
    expect(result.safeFileName).toBe('Relatorio_final.png')
  })
})

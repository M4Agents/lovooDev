import { describe, expect, it } from 'vitest'
import { LibraryUploadError } from '../errors.js'
import {
  buildLibraryObjectKey,
  createLibraryOperationId,
  parseLibraryObjectKey,
} from '../objectKey.js'

const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const NOW = new Date('2026-11-26T02:00:00.000Z')

describe('chave S3 da biblioteca', () => {
  it('gera o UUID no servidor e monta a chave library', () => {
    const operationId = createLibraryOperationId()
    const built = buildLibraryObjectKey({
      companyId: COMPANY_ID,
      operationId,
      safeFileName: 'foto.png',
      now: NOW,
    })
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(built.operationId).toBe(operationId)
    expect(built.s3Key).toBe(
      `clientes/${COMPANY_ID}/library/2026/11/26/${operationId}/foto.png`,
    )
    expect(parseLibraryObjectKey(built.s3Key)).toMatchObject({
      companyId: COMPANY_ID,
      operationId,
      fileName: 'foto.png',
      year: '2026',
      month: '11',
      day: '26',
    })
  })

  it('rejeita operação informada fora do formato UUID e chave de catálogo', () => {
    expect(() => buildLibraryObjectKey({
      companyId: COMPANY_ID,
      operationId: 'cliente-escolheu',
      safeFileName: 'foto.png',
      now: NOW,
    })).toThrow(LibraryUploadError)
    expect(parseLibraryObjectKey(
      `clientes/${COMPANY_ID}/whatsapp/2026/11/26/11111111-1111-4111-8111-111111111111/foto.png`,
    )).toBeNull()
    expect(parseLibraryObjectKey(
      `clientes/${COMPANY_ID}/library/2026/11/26/11111111-1111-4111-8111-111111111111/../foto.png`,
    )).toBeNull()
  })
})

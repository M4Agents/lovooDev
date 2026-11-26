import { describe, expect, it } from 'vitest'
import { ChatUploadError } from '../errors.js'
import {
  buildChatObjectKey,
  createChatOperationId,
  derivePublicObjectUrl,
  parseChatObjectKey,
} from '../objectKey.js'

const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const NOW = new Date('2026-11-26T02:00:00.000Z')

function extractFileName(url) {
  if (!url) return 'arquivo'
  try {
    const fileName = new URL(url).pathname.split('/').pop()
    return fileName || 'arquivo'
  } catch {
    return 'arquivo'
  }
}

describe('chave S3 do chat', () => {
  it('gera o operationId no servidor e monta a chave whatsapp', () => {
    const operationId = createChatOperationId()
    const built = buildChatObjectKey({
      companyId: COMPANY_ID,
      operationId,
      safeFileName: 'contrato.pdf',
      now: NOW,
    })
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(built.s3Key).toBe(
      `clientes/${COMPANY_ID}/whatsapp/2026/11/26/${operationId}/contrato.pdf`,
    )
    const parsed = parseChatObjectKey(built.s3Key)
    expect(parsed).toMatchObject({
      companyId: COMPANY_ID,
      operationId,
      fileName: 'contrato.pdf',
      year: '2026',
      month: '11',
      day: '26',
    })
    const mediaUrl = derivePublicObjectUrl('example-bucket', 'sa-east-1', built.s3Key)
    expect(extractFileName(mediaUrl)).toBe('contrato.pdf')
    expect(mediaUrl).not.toContain('?')
  })

  it('rejeita operationId fora do UUID, chave library e chave histórica', () => {
    expect(() => buildChatObjectKey({
      companyId: COMPANY_ID,
      operationId: 'frontend-conversa-1',
      safeFileName: 'foto.png',
      now: NOW,
    })).toThrow(ChatUploadError)
    expect(parseChatObjectKey(
      `clientes/${COMPANY_ID}/library/2026/11/26/11111111-1111-4111-8111-111111111111/foto.png`,
    )).toBeNull()
    expect(parseChatObjectKey(
      `clientes/${COMPANY_ID}/whatsapp/2026/11/26/frontend-${COMPANY_ID}-1/foto.png`,
    )).toBeNull()
    expect(parseChatObjectKey(
      `clientes/${COMPANY_ID}/whatsapp/2026/11/26/11111111-1111-4111-8111-111111111111/../foto.png`,
    )).toBeNull()
  })
})

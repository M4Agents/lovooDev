import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONFIRM_TTL_SECONDS as CATALOG_TTL } from '../../catalogUpload/constants.js'
import { issueConfirmToken, verifyConfirmToken } from '../../catalogUpload/confirmToken.js'
import { issueLibraryConfirmToken, verifyLibraryConfirmToken } from '../../libraryUpload/confirmToken.js'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_OTHER_MAX_BYTES,
  CONFIRM_SECRET_ENV,
  CONFIRM_TTL_SECONDS,
} from '../constants.js'
import {
  issueChatConfirmToken,
  readChatConfirmSecret,
  verifyChatConfirmToken,
} from '../confirmToken.js'
import { ChatUploadError } from '../errors.js'
import { validateChatUploadRequest } from '../validation.js'

const SECRET = 'k'.repeat(32)
const OTHER_SECRET = 'c'.repeat(32)
const ISSUED_AT = 1_763_000_000
const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const CONVERSATION_ID = 'cccc0000-0000-4000-8000-000000000003'
const INSTANCE_ID = 'dddd0000-0000-4000-8000-000000000004'
const FLOW_ID = 'eeee0000-0000-4000-8000-000000000005'
const USER_ID = 'aaaa0000-0000-4000-8000-000000000001'
const OPERATION_ID = '11111111-1111-4111-8111-111111111111'

function keyDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}/${month}/${day}`
}

function chatKey(fileName = 'foto.png', operationId = OPERATION_ID) {
  return `clientes/${COMPANY_ID}/whatsapp/${keyDate(ISSUED_AT)}/${operationId}/${fileName}`
}

function claims(overrides = {}) {
  return {
    operationId: OPERATION_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    purpose: 'chat_manual',
    conversationId: CONVERSATION_ID,
    instanceId: null,
    flowId: null,
    messageType: 'image',
    s3Key: chatKey(),
    originalFileName: 'foto.png',
    safeFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    contentType: 'image/jpeg',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CONFIRM_TTL_SECONDS,
    ...overrides,
  }
}

function catalogClaims() {
  return {
    operationId: OPERATION_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    sourceType: 'product',
    s3Key: chatKey(),
    originalFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CATALOG_TTL,
  }
}

function libraryClaims() {
  return {
    operationId: OPERATION_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    folderId: FLOW_ID,
    s3Key: `clientes/${COMPANY_ID}/library/${keyDate(ISSUED_AT)}/${OPERATION_ID}/foto.png`,
    originalFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    fileType: 'image',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CONFIRM_TTL_SECONDS,
  }
}

describe('token HMAC do chat', () => {
  it('vincula finalidade, identificadores, chave, nome seguro e MIME', () => {
    const token = issueChatConfirmToken(SECRET, claims())
    const verified = verifyChatConfirmToken(SECRET, token, ISSUED_AT + 10)
    expect(verified.ok).toBe(true)
    expect(verified.claims).toMatchObject({
      context: 'chat',
      purpose: 'chat_manual',
      conversationId: CONVERSATION_ID,
      instanceId: null,
      flowId: null,
      messageType: 'image',
      mimeType: 'image/jpeg',
      contentType: 'image/jpeg',
      safeFileName: 'foto.png',
      s3Key: chatKey(),
    })
    expect(token).not.toContain(SECRET)

    const scheduled = issueChatConfirmToken(SECRET, claims({
      purpose: 'chat_schedule',
      instanceId: INSTANCE_ID,
      messageType: 'document',
      mimeType: 'application/pdf',
      contentType: 'application/pdf',
      originalFileName: 'contrato.pdf',
      safeFileName: 'contrato.pdf',
      s3Key: chatKey('contrato.pdf'),
    }))
    expect(verifyChatConfirmToken(SECRET, scheduled, ISSUED_AT).claims.instanceId).toBe(INSTANCE_ID)

    const automation = issueChatConfirmToken(SECRET, claims({
      purpose: 'automation_audio',
      conversationId: null,
      flowId: FLOW_ID,
      messageType: 'audio',
      mimeType: 'audio/mp4',
      contentType: 'audio/mp4',
      originalFileName: 'gravacao.mp4',
      safeFileName: 'gravacao.mp4',
      s3Key: chatKey('gravacao.mp4'),
    }))
    const audio = verifyChatConfirmToken(SECRET, automation, ISSUED_AT)
    expect(audio.claims.mimeType).toBe('audio/mp4')
    expect(audio.claims.contentType).toBe('audio/mp4')
    expect(audio.claims.flowId).toBe(FLOW_ID)
    expect(audio.claims.conversationId).toBeNull()
  })

  it('rejeita adulteração, expiração, segredo curto e segredo divergente', () => {
    const token = issueChatConfirmToken(SECRET, claims())
    const [version, payload, signature] = token.split('.')
    const input = `${version}.${payload}`
    const expected = createHmac('sha256', SECRET).update(input).digest('base64url')
    const wrong = `${expected.slice(0, -2)}aa`
    expect(verifyChatConfirmToken(SECRET, `${input}.${wrong}`, ISSUED_AT).ok).toBe(false)
    expect(verifyChatConfirmToken(SECRET, `${token}x`, ISSUED_AT).ok).toBe(false)
    expect(verifyChatConfirmToken(OTHER_SECRET, token, ISSUED_AT).ok).toBe(false)
    expect(verifyChatConfirmToken(SECRET, token, ISSUED_AT + CONFIRM_TTL_SECONDS - 1).ok).toBe(true)
    expect(verifyChatConfirmToken(SECRET, token, ISSUED_AT + CONFIRM_TTL_SECONDS).reason).toBe('expired')
    expect(verifyChatConfirmToken(SECRET, token, ISSUED_AT - 1).reason).toBe('expired')
    expect(signature).toBe(expected)
    expect(() => issueChatConfirmToken('k'.repeat(31), claims())).toThrow(ChatUploadError)
    expect(verifyChatConfirmToken('k'.repeat(31), token, ISSUED_AT).ok).toBe(false)
  })

  it('rejeita finalidade, identificador, MIME, limite, nome e chave inconsistentes', () => {
    const rejected = [
      claims({ purpose: 'chat_manual', flowId: FLOW_ID }),
      claims({ purpose: 'chat_schedule', instanceId: null }),
      claims({
        purpose: 'automation_audio',
        conversationId: null,
        flowId: FLOW_ID,
        messageType: 'image',
      }),
      claims({
        purpose: 'automation_audio',
        conversationId: null,
        flowId: FLOW_ID,
        messageType: 'audio',
        mimeType: 'video/mp4',
        originalFileName: 'clip.mp4',
        safeFileName: 'clip.mp4',
        s3Key: chatKey('clip.mp4'),
      }),
      claims({ mimeType: '' }),
      claims({ sizeBytes: CHAT_IMAGE_MAX_BYTES + 1 }),
      claims({
        messageType: 'audio',
        mimeType: 'audio/webm',
        contentType: 'audio/webm',
        originalFileName: 'gravacao.webm',
        safeFileName: 'gravacao.webm',
        s3Key: chatKey('gravacao.webm'),
        sizeBytes: CHAT_OTHER_MAX_BYTES + 1,
      }),
      claims({ safeFileName: 'outro.png' }),
      claims({ originalFileName: 'pasta/foto.png' }),
      claims({ s3Key: chatKey().replace('/whatsapp/', '/library/') }),
      claims({ context: 'catalog' }),
    ]
    for (const value of rejected) {
      if (value.context === 'catalog') {
        const token = issueChatConfirmToken(SECRET, value)
        expect(verifyChatConfirmToken(SECRET, token, ISSUED_AT).claims.context).toBe('chat')
        continue
      }
      expect(() => issueChatConfirmToken(SECRET, value)).toThrow(ChatUploadError)
    }
  })

  it('isola tokens de chat, catálogo e biblioteca mesmo com o mesmo segredo', () => {
    const chatToken = issueChatConfirmToken(SECRET, claims())
    const catalogToken = issueConfirmToken(SECRET, catalogClaims())
    const libraryToken = issueLibraryConfirmToken(SECRET, libraryClaims())
    expect(verifyChatConfirmToken(SECRET, catalogToken, ISSUED_AT).ok).toBe(false)
    expect(verifyChatConfirmToken(SECRET, libraryToken, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, chatToken, ISSUED_AT).ok).toBe(false)
    expect(verifyLibraryConfirmToken(SECRET, chatToken, ISSUED_AT).ok).toBe(false)
    expect(verifyChatConfirmToken(SECRET, chatToken, ISSUED_AT).ok).toBe(true)
  })

  it('amarra o Content-Type de armazenamento e recusa MIME ativo ou com parâmetro', () => {
    const recorded = validateChatUploadRequest({
      companyId: COMPANY_ID,
      purpose: 'chat_manual',
      conversationId: CONVERSATION_ID,
      messageType: 'audio',
      fileName: 'gravacao.webm',
      mimeType: 'audio/webm;codecs=opus',
      sizeBytes: 2048,
    })
    const recordedToken = issueChatConfirmToken(SECRET, claims({
      messageType: recorded.messageType,
      mimeType: recorded.mimeType,
      contentType: recorded.contentType,
      originalFileName: recorded.originalFileName,
      safeFileName: recorded.safeFileName,
      s3Key: chatKey(recorded.safeFileName),
    }))
    expect(verifyChatConfirmToken(SECRET, recordedToken, ISSUED_AT).claims).toMatchObject({
      messageType: 'audio',
      mimeType: 'audio/webm',
      contentType: 'audio/webm',
    })

    const svg = validateChatUploadRequest({
      companyId: COMPANY_ID,
      purpose: 'chat_manual',
      conversationId: CONVERSATION_ID,
      messageType: 'image',
      fileName: 'icone.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 2048,
    })
    const svgToken = issueChatConfirmToken(SECRET, claims({
      messageType: svg.messageType,
      mimeType: svg.mimeType,
      contentType: svg.contentType,
      originalFileName: svg.originalFileName,
      safeFileName: svg.safeFileName,
      s3Key: chatKey(svg.safeFileName),
    }))
    expect(verifyChatConfirmToken(SECRET, svgToken, ISSUED_AT).claims.contentType).toBe('application/octet-stream')
    expect(verifyChatConfirmToken(SECRET, svgToken, ISSUED_AT).claims.mimeType).toBe('image/svg+xml')

    const [version, payload, signature] = svgToken.split('.')
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    parsed.contentType = 'image/svg+xml'
    const tampered = `${version}.${Buffer.from(JSON.stringify(parsed)).toString('base64url')}.${signature}`
    expect(verifyChatConfirmToken(SECRET, tampered, ISSUED_AT).ok).toBe(false)

    expect(() => issueChatConfirmToken(SECRET, claims({
      messageType: 'audio',
      mimeType: 'audio/webm;codecs=opus',
      contentType: 'audio/webm',
      originalFileName: 'gravacao.webm',
      safeFileName: 'gravacao.webm',
      s3Key: chatKey('gravacao.webm'),
    }))).toThrow(ChatUploadError)
    expect(() => issueChatConfirmToken(SECRET, claims({
      mimeType: 'image/svg+xml',
      contentType: 'image/svg+xml',
      originalFileName: 'icone.svg',
      safeFileName: 'icone.svg',
      s3Key: chatKey('icone.svg'),
    }))).toThrow(ChatUploadError)
  })

  it('lê somente o segredo do chat, sem fallback', () => {
    const secret = readChatConfirmSecret({
      MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: OTHER_SECRET,
      MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET: OTHER_SECRET,
      [CONFIRM_SECRET_ENV]: SECRET,
    })
    expect(secret).toBe(SECRET)
    expect(() => readChatConfirmSecret({
      MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: SECRET,
      MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET: SECRET,
    })).toThrow(ChatUploadError)
    expect(() => readChatConfirmSecret({
      [CONFIRM_SECRET_ENV]: 'k'.repeat(31),
    })).toThrow(ChatUploadError)
  })
})

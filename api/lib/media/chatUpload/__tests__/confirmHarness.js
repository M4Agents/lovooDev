import { createHmac } from 'node:crypto'
import { vi } from 'vitest'
import { CONFIRM_TTL_SECONDS } from '../constants.js'
import { issueChatConfirmToken } from '../confirmToken.js'
import { confirmChatUpload } from '../confirmChatUpload.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  CONVERSATION_ID,
  FIXED_NOW,
  FLOW_ID,
  HMAC_SECRET,
  INSTANCE_ID,
  OPERATION_A,
  OTHER_ID,
  REGION,
  USER_ID,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
  readySvc,
  readyTables,
} from './presignFixtures.js'

export const ISSUED_AT = Math.floor(FIXED_NOW.getTime() / 1000)

export function objectKey(fileName = 'foto.png') {
  return `clientes/${COMPANY_ID}/whatsapp/2026/11/26/${OPERATION_A}/${fileName}`
}

export function chatToken(overrides = {}) {
  const purpose = overrides.purpose ?? 'chat_manual'
  const messageType = overrides.messageType
    ?? (purpose === 'automation_audio' ? 'audio' : purpose === 'chat_schedule' ? 'document' : 'image')
  const fileName = overrides.originalFileName
    ?? (messageType === 'audio' ? 'gravacao.webm' : messageType === 'document' ? 'contrato.pdf' : 'foto.png')
  const mimeType = overrides.mimeType
    ?? (messageType === 'audio' ? 'audio/webm' : messageType === 'document' ? 'application/pdf' : 'image/jpeg')
  const contentType = overrides.contentType ?? mimeType
  return issueChatConfirmToken(HMAC_SECRET, {
    operationId: OPERATION_A,
    userId: USER_ID,
    companyId: COMPANY_ID,
    purpose,
    conversationId: purpose === 'automation_audio' ? null : CONVERSATION_ID,
    instanceId: purpose === 'chat_schedule' ? INSTANCE_ID : null,
    flowId: purpose === 'automation_audio' ? FLOW_ID : null,
    messageType,
    s3Key: objectKey(fileName),
    originalFileName: fileName,
    safeFileName: fileName,
    sizeBytes: 1024,
    mimeType,
    contentType,
    bucket: BUCKET,
    region: REGION,
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CONFIRM_TTL_SECONDS,
    ...overrides,
    purpose,
    messageType,
    originalFileName: fileName,
    safeFileName: overrides.safeFileName ?? fileName,
    s3Key: overrides.s3Key ?? objectKey(fileName),
    mimeType,
    contentType,
  })
}

export function signPayload(payload, secret = HMAC_SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `v1.${encoded}`
  const signature = createHmac('sha256', secret).update(input).digest('base64url')
  return `${input}.${signature}`
}

export function headOf(contentType, contentLength = 1024) {
  return vi.fn(async ({ key }) => ({ contentLength, contentType, key }))
}

export function confirmWith(token, extra = {}) {
  const body = extra.body ?? { confirmToken: token }
  const svc = extra.svc ?? readySvc(extra.role ?? 'admin')
  const headObject = extra.headObject ?? headOf(extra.contentType ?? 'image/jpeg', extra.contentLength ?? 1024)
  return confirmChatUpload({
    req: extra.req ?? makeReq(body),
    body,
    svc,
    env: extra.env ?? authorizedEnv(),
    now: () => extra.now ?? FIXED_NOW,
    headObject,
  }).then((result) => ({ result, svc, headObject }))
}

export {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  CONVERSATION_ID,
  FIXED_NOW,
  FLOW_ID,
  HMAC_SECRET,
  INSTANCE_ID,
  OTHER_ID,
  REGION,
  USER_ID,
  makeChain,
  makeReq,
  makeSvc,
  readySvc,
  readyTables,
}

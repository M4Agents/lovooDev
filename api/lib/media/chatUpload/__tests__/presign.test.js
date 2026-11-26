import { describe, expect, it } from 'vitest'
import { CONFIRM_TTL_SECONDS, PUT_TTL_SECONDS } from '../constants.js'
import { verifyChatConfirmToken } from '../confirmToken.js'
import { presignChatUpload } from '../presignChatUpload.js'
import { handleChatPresign } from '../../../../media/uploads/chat/presign.js'
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
  REGION,
  USER_ID,
  acceptedPut,
  authorizedEnv,
  automationBody,
  makeReq,
  manualBody,
  mockRes,
  readySvc,
  scheduleBody,
} from './presignFixtures.js'

const RESPONSE_KEYS = [
  'confirmExpiresIn',
  'confirmToken',
  'expiresIn',
  'operationId',
  'putHeaders',
  'putUrl',
  's3_key',
]

function issue(body, extra = {}) {
  const svc = extra.svc ?? readySvc(extra.role ?? 'admin')
  const signPut = extra.signPut ?? acceptedPut
  return presignChatUpload({
    req: extra.req ?? makeReq(body),
    body,
    svc,
    env: extra.env ?? authorizedEnv(),
    now: () => extra.now ?? FIXED_NOW,
    createOperationId: extra.createOperationId ?? (() => OPERATION_A),
    signPut,
  }).then((result) => ({ result, svc }))
}

describe('presign do upload do chat', () => {
  it('assina as três finalidades com chave whatsapp e token de contexto chat', async () => {
    const manual = await issue(manualBody())
    const schedule = await issue(scheduleBody(), { role: 'manager' })
    const automation = await issue(automationBody(), { role: 'manager' })
    const issuedAt = Math.floor(FIXED_NOW.getTime() / 1000)

    expect(manual.result.status).toBe(200)
    expect(Object.keys(manual.result.body).sort()).toEqual(RESPONSE_KEYS)
    expect(manual.result.body.expiresIn).toBe(PUT_TTL_SECONDS)
    expect(manual.result.body.confirmExpiresIn).toBe(CONFIRM_TTL_SECONDS)
    expect(manual.result.body.operationId).toBe(OPERATION_A)
    expect(manual.result.body.s3_key).toBe(
      `clientes/${COMPANY_ID}/whatsapp/2026/11/26/${OPERATION_A}/foto.png`,
    )
    expect(manual.result.body.putHeaders).toEqual({
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
    })
    expect(manual.result.body.putHeaders['Content-Length']).toBeUndefined()
    const manualUrl = new URL(manual.result.body.putUrl)
    expect(manualUrl.protocol).toBe('https:')
    expect(manualUrl.hostname).toBe(`${BUCKET}.s3.${REGION}.amazonaws.com`)
    expect(decodeURIComponent(manualUrl.pathname)).toBe(`/${manual.result.body.s3_key}`)
    expect(manualUrl.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;if-none-match',
    )
    expect(manualUrl.searchParams.get('X-Amz-Expires')).toBe('300')

    const manualClaims = verifyChatConfirmToken(HMAC_SECRET, manual.result.body.confirmToken, issuedAt)
    expect(manualClaims.ok).toBe(true)
    expect(manualClaims.claims).toMatchObject({
      context: 'chat',
      purpose: 'chat_manual',
      userId: USER_ID,
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      instanceId: null,
      flowId: null,
      messageType: 'image',
      mimeType: 'image/jpeg',
      contentType: 'image/jpeg',
      s3Key: manual.result.body.s3_key,
      expiresAt: issuedAt + 900,
    })

    const scheduleClaims = verifyChatConfirmToken(
      HMAC_SECRET,
      schedule.result.body.confirmToken,
      issuedAt,
    )
    expect(schedule.result.body.s3_key).toContain('/contrato.pdf')
    expect(scheduleClaims.claims).toMatchObject({
      purpose: 'chat_schedule',
      conversationId: CONVERSATION_ID,
      instanceId: INSTANCE_ID,
      flowId: null,
      messageType: 'document',
      mimeType: 'application/pdf',
      contentType: 'application/pdf',
    })

    const automationClaims = verifyChatConfirmToken(
      HMAC_SECRET,
      automation.result.body.confirmToken,
      issuedAt,
    )
    expect(automation.result.body.s3_key).toContain('/gravacao.webm')
    expect(automationClaims.claims).toMatchObject({
      purpose: 'automation_audio',
      conversationId: null,
      instanceId: null,
      flowId: FLOW_ID,
      messageType: 'audio',
      mimeType: 'audio/webm',
      contentType: 'audio/webm',
    })
    expect(JSON.stringify(manual.result.body)).not.toContain(AWS_SECRET)
    expect(JSON.stringify(manual.result.body)).not.toContain(HMAC_SECRET)
    expect(manual.result.body.confirmToken).not.toContain(AWS_KEY)
  })

  it('assina o contentType efetivo de codec e de conteúdo ativo', async () => {
    const codec = await issue(manualBody({
      messageType: 'audio',
      fileName: 'gravacao.webm',
      mimeType: 'audio/webm;codecs=opus',
      sizeBytes: 2048,
    }))
    const active = await issue(manualBody({
      messageType: 'image',
      fileName: 'icone.svg',
      mimeType: 'image/svg+xml',
    }))
    const issuedAt = Math.floor(FIXED_NOW.getTime() / 1000)
    const codecClaims = verifyChatConfirmToken(HMAC_SECRET, codec.result.body.confirmToken, issuedAt)
    const activeClaims = verifyChatConfirmToken(HMAC_SECRET, active.result.body.confirmToken, issuedAt)

    expect(codec.result.status).toBe(200)
    expect(codec.result.body.putHeaders['Content-Type']).toBe('audio/webm')
    expect(codecClaims.claims.mimeType).toBe('audio/webm')
    expect(codecClaims.claims.contentType).toBe('audio/webm')
    expect(codec.result.body.confirmToken).not.toContain('codecs')

    expect(active.result.status).toBe(200)
    expect(active.result.body.putHeaders['Content-Type']).toBe('application/octet-stream')
    expect(activeClaims.claims.mimeType).toBe('image/svg+xml')
    expect(activeClaims.claims.contentType).toBe('application/octet-stream')
    expect(active.result.body.putHeaders['Content-Type']).not.toBe('image/svg+xml')
  })

  it('rejeita assinatura que devolve o MIME ativo no lugar do contentType', async () => {
    const result = await presignChatUpload({
      req: makeReq(manualBody({
        messageType: 'image',
        fileName: 'icone.svg',
        mimeType: 'image/svg+xml',
      })),
      body: manualBody({
        messageType: 'image',
        fileName: 'icone.svg',
        mimeType: 'image/svg+xml',
      }),
      svc: readySvc(),
      env: authorizedEnv(),
      now: () => FIXED_NOW,
      createOperationId: () => OPERATION_A,
      signPut: async ({ key, credentials }) => acceptedPut({
        key,
        credentials,
        contentType: 'image/svg+xml',
      }),
    })
    expect(result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
    expect(result.body.confirmToken).toBeUndefined()
  })

  it('responde no-store e não devolve credencial no handler', async () => {
    const svc = readySvc()
    const res = mockRes()
    await handleChatPresign(makeReq(manualBody()), res, {
      svc,
      env: authorizedEnv(),
      now: () => FIXED_NOW,
      createOperationId: () => OPERATION_A,
      signPut: acceptedPut,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body.secret_access_key).toBeUndefined()
    expect(res.body.access_key_id).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain(AWS_SECRET)
    expect(svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', {
      p_company_id: COMPANY_ID,
    })
  })
})

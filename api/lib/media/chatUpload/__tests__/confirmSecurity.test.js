import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CatalogUploadError } from '../../catalogUpload/errors.js'
import { headCatalogObject } from '../../catalogUpload/headCatalogObject.js'
import { handleChatConfirm } from '../../../../media/uploads/chat/confirm.js'
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
  ISSUED_AT,
  OTHER_ID,
  REGION,
  USER_ID,
  chatToken,
  confirmWith,
  headOf,
  makeChain,
  makeReq,
  makeSvc,
  objectKey,
  readyTables,
  signPayload,
} from './confirmHarness.js'

function denied(extra = {}) {
  return confirmWith(extra.token ?? chatToken(), extra)
}

describe('segurança do confirm do chat', () => {
  it('nega token adulterado, expirado, contexto incorreto e usuário divergente sem AWS', async () => {
    const valid = chatToken()
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`
    const expired = await denied({
      token: valid,
      now: new Date((ISSUED_AT + 900) * 1000),
    })
    const foreignContext = signPayload({
      v: 1,
      operationId: '11111111-1111-4111-8111-111111111111',
      userId: USER_ID,
      companyId: COMPANY_ID,
      context: 'catalog',
      purpose: 'chat_manual',
      conversationId: CONVERSATION_ID,
      instanceId: null,
      flowId: null,
      messageType: 'image',
      s3Key: objectKey(),
      originalFileName: 'foto.png',
      safeFileName: 'foto.png',
      sizeBytes: 1024,
      mimeType: 'image/jpeg',
      contentType: 'image/jpeg',
      bucket: BUCKET,
      region: REGION,
      issuedAt: ISSUED_AT,
      expiresAt: ISSUED_AT + 900,
    })
    const wrongUser = await denied({
      token: valid,
      svc: makeSvc({
        user: { id: OTHER_ID },
        tables: readyTables(),
      }),
    })
    const altered = await denied({ token: tampered })
    const context = await denied({ token: foreignContext })

    expect(altered.result).toEqual({ status: 400, body: { error: 'Token inválido' } })
    expect(expired.result).toEqual({ status: 410, body: { error: 'Token expirado' } })
    expect(context.result).toEqual({ status: 400, body: { error: 'Token inválido' } })
    expect(wrongUser.result).toEqual({ status: 403, body: { error: 'Acesso negado' } })
    for (const attempt of [altered, expired, context, wrongUser]) {
      expect(attempt.svc.rpc).not.toHaveBeenCalled()
      expect(attempt.headObject).not.toHaveBeenCalled()
    }
  })

  it('nega revogação, transferência, instância inválida, fluxo e cross-tenant sem AWS', async () => {
    const revoked = await denied({
      svc: makeSvc({
        tables: {
          company_users: makeChain(null),
          companies: makeChain(null),
        },
      }),
    })
    const transferred = await denied({
      role: 'seller',
      token: chatToken(),
      svc: makeSvc({
        tables: {
          ...readyTables('seller'),
          companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: true }),
          chat_conversations: makeChain({
            id: CONVERSATION_ID,
            company_id: COMPANY_ID,
            instance_id: INSTANCE_ID,
            last_instance_id: null,
            assigned_to: OTHER_ID,
          }),
        },
      }),
    })
    const deletedInstance = await denied({
      svc: makeSvc({
        tables: {
          ...readyTables(),
          whatsapp_life_instances: makeChain({
            id: INSTANCE_ID,
            company_id: COMPANY_ID,
            deleted_at: '2026-01-01T00:00:00.000Z',
            assigned_user_id: null,
            available_to_all: false,
          }),
        },
      }),
    })
    const missingFlow = await denied({
      token: chatToken({ purpose: 'automation_audio' }),
      role: 'manager',
      contentType: 'audio/webm',
      svc: makeSvc({
        tables: {
          ...readyTables('manager'),
          automation_flows: makeChain(null),
        },
      }),
    })
    const foreignConversation = await denied({
      svc: makeSvc({
        tables: {
          ...readyTables(),
          chat_conversations: makeChain({
            id: CONVERSATION_ID,
            company_id: OTHER_ID,
            instance_id: INSTANCE_ID,
            last_instance_id: null,
            assigned_to: null,
          }),
        },
      }),
    })

    expect(revoked.result.status).toBe(403)
    expect(transferred.result).toEqual({ status: 404, body: { error: 'Recurso não encontrado' } })
    expect(deletedInstance.result.status).toBe(404)
    expect(missingFlow.result.status).toBe(404)
    expect(foreignConversation.result.status).toBe(404)
    for (const attempt of [revoked, transferred, deletedInstance, missingFlow, foreignConversation]) {
      expect(attempt.svc.rpc).not.toHaveBeenCalled()
      expect(attempt.headObject).not.toHaveBeenCalled()
      expect(JSON.stringify(attempt.result.body)).not.toContain(OTHER_ID)
    }
  })

  it('nega bucket, região, objeto ausente, tamanho e MIME sem publicar URL', async () => {
    const otherBucket = await denied({
      svc: makeSvc({
        tables: readyTables(),
        rpcData: [{
          access_key_id: AWS_KEY,
          secret_access_key: AWS_SECRET,
          bucket: 'other-bucket',
          region: REGION,
        }],
      }),
    })
    const otherRegion = await denied({
      svc: makeSvc({
        tables: readyTables(),
        rpcData: [{
          access_key_id: AWS_KEY,
          secret_access_key: AWS_SECRET,
          bucket: BUCKET,
          region: 'sa-east-1',
        }],
      }),
    })
    expect(otherBucket.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(otherRegion.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(otherBucket.headObject).not.toHaveBeenCalled()
    expect(otherRegion.headObject).not.toHaveBeenCalled()

    const missing = await confirmChatUpload({
      req: makeReq({ confirmToken: chatToken() }),
      body: { confirmToken: chatToken() },
      svc: makeSvc({ tables: readyTables() }),
      env: { MEDIA_CHAT_UPLOAD_TOKEN_SECRET: HMAC_SECRET },
      now: () => FIXED_NOW,
      headObject: (input) => headCatalogObject({
        ...input,
        client: {
          send: vi.fn().mockRejectedValue(Object.assign(new Error('NoSuchKey secret'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          })),
          destroy: vi.fn(),
        },
      }),
    })
    expect(missing).toEqual({ status: 404, body: { error: 'Objeto não encontrado' } })
    expect(JSON.stringify(missing)).not.toContain('secret')

    const wrongSize = await denied({ headObject: headOf('image/jpeg', 1025) })
    const wrongType = await denied({ headObject: headOf('image/png', 1024) })
    expect(wrongSize.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(wrongType.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(wrongSize.result.body.media_url).toBeUndefined()
  })

  it('fecha falha AWS e revalida a sessão depois do HeadObject', async () => {
    const aws = await confirmChatUpload({
      req: makeReq({ confirmToken: chatToken() }),
      body: { confirmToken: chatToken() },
      svc: makeSvc({ tables: readyTables() }),
      env: { MEDIA_CHAT_UPLOAD_TOKEN_SECRET: HMAC_SECRET },
      now: () => FIXED_NOW,
      headObject: (input) => headCatalogObject({
        ...input,
        client: {
          send: vi.fn().mockRejectedValue(Object.assign(new Error('internal secret'), {
            name: 'InternalError',
            $metadata: { httpStatusCode: 500 },
          })),
          destroy: vi.fn(),
        },
      }),
    })
    expect(aws).toEqual({ status: 503, body: { error: 'Confirmação temporariamente indisponível' } })
    expect(JSON.stringify(aws)).not.toContain('internal secret')
    expect(aws).not.toBeInstanceOf(CatalogUploadError)

    const svc = makeSvc({ tables: readyTables() })
    let reads = 0
    svc.auth.getUser.mockImplementation(async () => {
      reads += 1
      if (reads >= 3) return { data: { user: null }, error: { message: 'jwt secret' } }
      return { data: { user: { id: USER_ID } }, error: null }
    })
    const headObject = headOf('image/jpeg')
    const replay = await confirmWith(chatToken(), { svc, headObject })
    expect(replay.result).toEqual({ status: 401, body: { error: 'Sessão inválida ou expirada' } })
    expect(headObject).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(replay.result)).not.toContain('jwt secret')
    expect(replay.result.body.media_url).toBeUndefined()
  })

  it('rejeita corpo extra, método indevido e não persiste nem apaga objeto', async () => {
    const extra = await confirmWith(chatToken(), {
      body: { confirmToken: chatToken(), media_url: 'https://evil.example/file' },
    })
    expect(extra.result).toEqual({ status: 400, body: { error: 'Pedido inválido' } })
    expect(extra.svc.auth.getUser).not.toHaveBeenCalled()
    expect(extra.svc.rpc).not.toHaveBeenCalled()
    expect(extra.headObject).not.toHaveBeenCalled()

    const res = {
      headers: {},
      statusCode: 0,
      body: null,
      setHeader(name, value) { this.headers[name] = value },
      status(code) { this.statusCode = code; return this },
      json(payload) { this.body = payload; return this },
    }
    await handleChatConfirm({ method: 'PUT', headers: {}, body: { confirmToken: 'x' } }, res, {})
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')

    const source = readFileSync(new URL('../confirmChatUpload.js', import.meta.url), 'utf8')
    expect(source).not.toContain('DeleteObject')
    expect(source).not.toContain('PutObject')
    expect(source).not.toContain('limitChecker')
    expect(source).not.toContain('chat_messages')
    expect(source).not.toContain('console.')
    expect(source).toContain('headCatalogObject')
    expect(source).toContain('derivePublicObjectUrl')
  })
})

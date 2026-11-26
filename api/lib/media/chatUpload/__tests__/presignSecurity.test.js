import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { presignChatUpload } from '../presignChatUpload.js'
import { handleChatPresign } from '../../../../media/uploads/chat/presign.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  CONVERSATION_ID,
  FIXED_NOW,
  HMAC_SECRET,
  INSTANCE_ID,
  OPERATION_A,
  OTHER_ID,
  REGION,
  acceptedPut,
  authorizedEnv,
  automationBody,
  makeChain,
  makeReq,
  makeSvc,
  manualBody,
  mockRes,
  readySvc,
  readyTables,
  scheduleBody,
} from './presignFixtures.js'

function run(body, extra = {}) {
  const svc = extra.svc ?? readySvc(extra.role ?? 'admin')
  const signPut = extra.signPut ?? vi.fn(acceptedPut)
  const promise = presignChatUpload({
    req: extra.req ?? makeReq(body),
    body,
    svc,
    env: extra.env ?? authorizedEnv(),
    now: () => FIXED_NOW,
    createOperationId: () => OPERATION_A,
    signPut,
  })
  return promise.then((result) => ({ result, svc, signPut }))
}

describe('segurança do presign do chat', () => {
  it('nega autorização antes de credencial e assinatura', async () => {
    const anonymous = await run(manualBody(), {
      req: { method: 'POST', headers: {}, body: manualBody() },
    })
    const inactive = await run(manualBody(), {
      svc: makeSvc({
        tables: {
          company_users: makeChain(null),
          companies: makeChain(null),
        },
      }),
    })
    const seller = await run(automationBody(), { role: 'seller' })
    for (const attempt of [anonymous, inactive, seller]) {
      expect(attempt.result.ok).toBeUndefined()
      expect(attempt.result.status).toBeGreaterThanOrEqual(401)
      expect(attempt.svc.rpc).not.toHaveBeenCalled()
      expect(attempt.signPut).not.toHaveBeenCalled()
    }
    expect(anonymous.result.status).toBe(401)
    expect(inactive.result.status).toBe(403)
    expect(seller.result.status).toBe(403)
    expect(seller.svc.from).not.toHaveBeenCalledWith('automation_flows')
  })

  it('nega cross-tenant sem resolver credenciais', async () => {
    const otherCompany = await run(manualBody({ companyId: OTHER_ID }), {
      svc: makeSvc({
        tables: {
          company_users: makeChain(null),
          companies: makeChain(null),
        },
      }),
    })
    const foreignConversation = await run(manualBody(), {
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
    const foreignInstance = await run(scheduleBody(), {
      svc: makeSvc({
        tables: {
          ...readyTables(),
          whatsapp_life_instances: makeChain({
            id: INSTANCE_ID,
            company_id: OTHER_ID,
            deleted_at: null,
            assigned_user_id: null,
            available_to_all: true,
          }),
        },
      }),
    })
    for (const attempt of [otherCompany, foreignConversation, foreignInstance]) {
      expect(attempt.result.status).toBeGreaterThanOrEqual(403)
      expect(attempt.svc.rpc).not.toHaveBeenCalled()
      expect(attempt.signPut).not.toHaveBeenCalled()
      expect(JSON.stringify(attempt.result.body)).not.toContain(OTHER_ID)
    }
    expect(foreignConversation.result).toEqual({
      status: 404,
      body: { error: 'Recurso não encontrado' },
    })
    expect(foreignInstance.result.status).toBe(404)
  })

  it('rejeita campos extras e corpo inválido antes da autorização', async () => {
    const extra = await run({ ...manualBody(), userId: OTHER_ID, impersonating: true, role: 'admin' })
    const operation = await run({ ...manualBody(), operationId: OPERATION_A })
    const empty = await run(null)
    const list = await run([])
    expect(extra.result).toEqual({ status: 400, body: { error: 'Pedido inválido' } })
    expect(operation.result.status).toBe(400)
    expect(empty.result.status).toBe(400)
    expect(list.result.status).toBe(400)
    expect(extra.svc.auth.getUser).not.toHaveBeenCalled()
    expect(operation.svc.auth.getUser).not.toHaveBeenCalled()
    expect(extra.svc.rpc).not.toHaveBeenCalled()
    expect(extra.signPut).not.toHaveBeenCalled()
  })

  it('recusa segredo ausente, curto ou de outro contexto sem credencial', async () => {
    const missing = await run(manualBody(), { env: {} })
    const short = await run(manualBody(), {
      env: { MEDIA_CHAT_UPLOAD_TOKEN_SECRET: 'curto' },
    })
    const catalogSecret = await run(manualBody(), {
      env: { MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: HMAC_SECRET },
    })
    for (const attempt of [missing, short, catalogSecret]) {
      expect(attempt.result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
      expect(attempt.svc.rpc).not.toHaveBeenCalled()
      expect(attempt.signPut).not.toHaveBeenCalled()
    }
  })

  it('fecha credencial inválida e falha de assinatura sem vazar detalhe', async () => {
    const invalid = await run(manualBody(), {
      svc: readySvc('admin', {
        rpcError: { message: 'secret rpc detail' },
      }),
    })
    expect(invalid.result).toEqual({ status: 500, body: { error: 'Upload indisponível' } })
    expect(JSON.stringify(invalid.result)).not.toContain('secret rpc detail')
    expect(JSON.stringify(invalid.result)).not.toContain(AWS_SECRET)
    expect(invalid.signPut).not.toHaveBeenCalled()

    const badUrl = await run(manualBody(), {
      signPut: async ({ key, credentials }) => ({
        putUrl: `https://evil.example/${key}`,
        putHeaders: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
      }),
    })
    expect(badUrl.result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
    expect(badUrl.result.body.confirmToken).toBeUndefined()
    expect(badUrl.result.body.putUrl).toBeUndefined()

    const res = mockRes()
    await handleChatPresign(makeReq(manualBody()), res, {
      svc: readySvc(),
      env: authorizedEnv(),
      now: () => FIXED_NOW,
      createOperationId: () => OPERATION_A,
      signPut: () => {
        throw new Error('signature secret detail')
      },
    })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Falha ao preparar upload' })
    expect(JSON.stringify(res.body)).not.toContain('signature secret')
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('responde 405 e mantém o presign sem quota nem fallback AWS', async () => {
    const svc = readySvc()
    const res = mockRes()
    await handleChatPresign({ method: 'GET', headers: {}, body: manualBody() }, res, {
      svc,
      env: authorizedEnv(),
    })
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(svc.rpc).not.toHaveBeenCalled()

    const source = readFileSync(new URL('../presignChatUpload.js', import.meta.url), 'utf8')
    expect(source).not.toContain('limitChecker')
    expect(source).not.toContain('assertStorageLimit')
    expect(source).not.toContain('AWS_ACCESS_KEY_ID')
    expect(source).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(source).not.toContain('console.')
    expect(BUCKET).toBe('example-bucket')
    expect(REGION).toBe('us-east-1')
    expect(AWS_KEY.startsWith('AKIA')).toBe(true)
  })
})

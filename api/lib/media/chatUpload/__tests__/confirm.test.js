import { describe, expect, it } from 'vitest'
import { handleChatConfirm } from '../../../../media/uploads/chat/confirm.js'
import {
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  FIXED_NOW,
  FLOW_ID,
  HMAC_SECRET,
  INSTANCE_ID,
  REGION,
  USER_ID,
  chatToken,
  confirmWith,
  headOf,
  makeReq,
  objectKey,
  readySvc,
} from './confirmHarness.js'

function publicUrl(fileName) {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${objectKey(fileName)}`
}

describe('confirm do upload do chat', () => {
  it('devolve somente a URL estável das três finalidades', async () => {
    const manual = await confirmWith(chatToken(), { contentType: 'image/jpeg' })
    const schedule = await confirmWith(chatToken({ purpose: 'chat_schedule' }), {
      role: 'manager',
      contentType: 'application/pdf',
    })
    const automation = await confirmWith(chatToken({ purpose: 'automation_audio' }), {
      role: 'manager',
      contentType: 'audio/webm',
    })

    expect(manual.result.status).toBe(200)
    expect(Object.keys(manual.result.body)).toEqual(['media_url'])
    expect(manual.result.body.media_url).toBe(publicUrl('foto.png'))
    expect(manual.result.body.media_url).not.toContain('?')
    expect(manual.headObject).toHaveBeenCalledWith(expect.objectContaining({
      key: objectKey('foto.png'),
    }))
    expect(schedule.result.body.media_url).toBe(publicUrl('contrato.pdf'))
    expect(automation.result.body.media_url).toBe(publicUrl('gravacao.webm'))
    expect(JSON.stringify(manual.result.body)).not.toContain(AWS_SECRET)
    expect(JSON.stringify(manual.result.body)).not.toContain(HMAC_SECRET)
    expect(manual.result.body.s3_key).toBeUndefined()
    expect(manual.result.body.confirmToken).toBeUndefined()
    expect(manual.result.body.media_url).toContain(COMPANY_ID)
    expect(manual.result.body.media_url).not.toContain(USER_ID)
    expect(schedule.result.body.media_url).not.toContain(INSTANCE_ID)
    expect(automation.result.body.media_url).not.toContain(FLOW_ID)
  })

  it('confirma SVG, HTML e áudio pelo contentType efetivo', async () => {
    const svg = await confirmWith(chatToken({
      messageType: 'image',
      originalFileName: 'icone.svg',
      mimeType: 'image/svg+xml',
      contentType: 'application/octet-stream',
    }), { contentType: 'application/octet-stream' })
    const html = await confirmWith(chatToken({
      messageType: 'document',
      originalFileName: 'pagina.html',
      mimeType: 'text/html',
      contentType: 'application/octet-stream',
    }), { contentType: 'application/octet-stream' })
    const codec = await confirmWith(chatToken({
      messageType: 'audio',
      originalFileName: 'gravacao.webm',
      mimeType: 'audio/webm',
      contentType: 'audio/webm',
    }), { contentType: 'audio/webm' })
    const activeStored = await confirmWith(chatToken({
      messageType: 'image',
      originalFileName: 'icone.svg',
      mimeType: 'image/svg+xml',
      contentType: 'application/octet-stream',
    }), { contentType: 'image/svg+xml' })
    const parameterized = await confirmWith(chatToken({
      messageType: 'audio',
      originalFileName: 'gravacao.webm',
      mimeType: 'audio/webm',
      contentType: 'audio/webm',
    }), { contentType: 'audio/webm;codecs=opus' })

    expect(svg.result.body.media_url).toBe(publicUrl('icone.svg'))
    expect(html.result.body.media_url).toBe(publicUrl('pagina.html'))
    expect(codec.result.body.media_url).toBe(publicUrl('gravacao.webm'))
    expect(activeStored.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(parameterized.result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
  })

  it('repete a mesma URL enquanto a autorização e os metadados conferem', async () => {
    const token = chatToken()
    const svc = readySvc()
    const headObject = headOf('image/jpeg')
    const first = await confirmWith(token, { svc, headObject })
    const second = await confirmWith(token, { svc, headObject })
    expect(first.result).toEqual({ status: 200, body: { media_url: publicUrl('foto.png') } })
    expect(second.result).toEqual(first.result)
    expect(headObject).toHaveBeenCalledTimes(2)
  })

  it('responde no-store no handler e só publica media_url', async () => {
    const token = chatToken()
    const res = mockRes()
    await handleChatConfirm(makeReq({ confirmToken: token }), res, {
      svc: readySvc(),
      env: { MEDIA_CHAT_UPLOAD_TOKEN_SECRET: HMAC_SECRET },
      now: () => FIXED_NOW,
      headObject: headOf('image/jpeg'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body).toEqual({ media_url: publicUrl('foto.png') })
  })
})

function mockRes() {
  const headers = {}
  return {
    headers,
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

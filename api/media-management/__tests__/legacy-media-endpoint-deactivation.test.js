import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const STUB = `export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(410).json({
    error: 'gone',
    message: 'Este endpoint foi desativado.'
  })
}
`

const HANDLERS = [
  'api/media-library/organize-file.js',
  'src/pages/api/media-library/organize-file.js',
  'api/media-management/files/organize.js',
  'src/pages/api/media-management/files/organize.js',
  'api/media-management/files/generate-upload-url.js',
  'pages/api/media-management/files/generate-upload-url.js',
  'api/media-management/files/save-s3-metadata.js',
  'pages/api/media-management/files/save-s3-metadata.js',
  'api/media-library/upload-to-folder.js',
  'pages/api/media-library/upload-to-folder.js',
  'src/pages/api/media-library/upload-to-folder.js',
  'api/media-management/files/upload.js',
  'pages/api/media-management/files/upload.js',
  'src/pages/api/media-management/files/upload.js',
  'api/media-management/files/upload-cache-bypass-final.js',
  'src/pages/api/media-management/files/upload-cache-bypass-final.js',
  'api/setup-s3-cors.js',
  'api/media-library/company/files.js',
]

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']

const CONTRACT = {
  error: 'gone',
  message: 'Este endpoint foi desativado.',
}

function createRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value
      return this
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

function createReq(method) {
  return {
    method,
    headers: { authorization: 'Bearer presente' },
    query: { company_id: '11111111-1111-1111-1111-111111111111' },
    body: { company_id: '22222222-2222-2222-2222-222222222222', s3_key: 'objeto' },
  }
}

describe('desativacao das rotas legadas de midia', () => {
  it('os dezoito handlers tem o mesmo conteudo inerte', () => {
    const contents = HANDLERS.map((rel) => readFileSync(path.join(ROOT, rel), 'utf8'))
    expect(new Set(contents).size).toBe(1)
    expect(contents[0]).toBe(STUB)
  })

  describe.each(HANDLERS)('%s', (rel) => {
    it('carrega sem configuracao externa e nao le a requisicao nem o ambiente', async () => {
      const href = pathToFileURL(path.join(ROOT, rel)).href
      const mod = await import(href)
      const req = new Proxy({}, {
        get() {
          throw new Error('handler leu a requisicao')
        },
      })
      const res = createRes()
      const previousEnv = process.env
      process.env = new Proxy({}, {
        get() {
          throw new Error('handler leu variavel de ambiente')
        },
      })
      try {
        const returned = mod.default(req, res)
        expect(returned).toBe(res)
      } finally {
        process.env = previousEnv
      }
      expect(res.statusCode).toBe(410)
      expect(res.headers['Cache-Control']).toBe('no-store')
      expect(res.body).toEqual(CONTRACT)
    })

    describe.each(METHODS)('%s', (method) => {
      it('responde o contrato 410', async () => {
        const href = `${pathToFileURL(path.join(ROOT, rel)).href}?method=${method}`
        const mod = await import(href)
        const req = createReq(method)
        const res = createRes()
        mod.default(req, res)
        expect(res.statusCode).toBe(410)
        expect(res.headers).toEqual({ 'Cache-Control': 'no-store' })
        expect(res.body).toEqual(CONTRACT)
        expect(req.headers.authorization).toBe('Bearer presente')
        expect(req.query.company_id).toBe('11111111-1111-1111-1111-111111111111')
        expect(req.body.s3_key).toBe('objeto')
      })
    })
  })
})

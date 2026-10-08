import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const entries = [
  'api/dashboard/summary.ts',
  'api/dashboard/snapshot-health.ts',
]

function runtimeSpecifiers(source: string): string[] {
  const specs: string[] = []
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(?:import|export)\s+type\b/.test(line)) continue
    if (!/^\s*(?:import|export)\b/.test(line)) continue
    const block = [line]
    let cursor = index
    while (!block.join('\n').includes(' from ') && !/['"][^'"]+['"]/.test(block.join('\n')) && cursor + 1 < lines.length) {
      cursor += 1
      block.push(lines[cursor])
      if (block.length > 20) break
    }
    const match = block.join('\n').match(/from\s+['"](\.[^'"]+)['"]/)
    if (match) specs.push(match[1])
  }
  return specs
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = specifier.endsWith('.js')
    ? [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`]
  for (const candidate of candidates) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      // tenta o próximo candidato
    }
  }
  return null
}

function localGraph(entryRel: string): string[] {
  const pending = [resolve(root, entryRel)]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || seen.has(file) || !file.startsWith(root)) continue
    seen.add(file)
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const specifier of runtimeSpecifiers(source)) {
      const next = resolveLocal(file, specifier)
      if (next) pending.push(next)
    }
  }
  return [...seen]
}

describe('carregamento ESM das funções do dashboard', () => {
  it('carrega summary e snapshot-health no Node sem empacotar', async () => {
    const files = [...new Set(entries.flatMap(localGraph))]
    const outdir = join(root, 'node_modules/.cache/dashboard-esm-load')
    rmSync(outdir, { recursive: true, force: true })
    mkdirSync(outdir, { recursive: true })

    await build({
      absWorkingDir: root,
      entryPoints: files.map(file => relative(root, file)),
      bundle: false,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      outdir,
      outbase: '.',
      logLevel: 'silent',
    })

    const script = `
      import summary from './api/dashboard/summary.js'
      import health from './api/dashboard/snapshot-health.js'
      if (typeof summary !== 'function' || typeof health !== 'function') {
        throw new Error('handler ausente')
      }
      const calls = []
      const res = () => ({
        setHeader() {},
        status(code) { this.code = code; return this },
        json(body) { calls.push(this.code); this.body = body; return this },
        end() {},
      })
      const req = { method: 'GET', headers: {}, query: {} }
      await summary(req, res())
      await health(req, res())
      if (calls.join() !== '401,401') throw new Error('esperado 401 antes da consulta: ' + calls.join())
    `

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: outdir,
      encoding: 'utf8',
    })
    rmSync(outdir, { recursive: true, force: true })

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
  }, 20_000)
})

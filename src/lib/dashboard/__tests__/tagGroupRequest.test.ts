import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getFeatureFlags } from '../../../hooks/dashboard/useFeatureFlags'
import { createRequestGate } from '../tagGroupRequest'

describe('resposta antiga e flag', () => {
  it('uma resposta anterior não substitui a consulta atual', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('a flag desligada é o padrão e o card só entra com ela ligada', () => {
    expect(getFeatureFlags().tagGroups).toBe(false)
    const page = readFileSync(resolve(process.cwd(), 'src/pages/NewDashboard.tsx'), 'utf8')
    expect(page).toContain('flags.tagGroups')
    expect(page).toContain('!flags.tagGroups')
  })
})

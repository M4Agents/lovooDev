import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const settingsSrc = readFileSync(join(here, '../Settings.tsx'), 'utf8')

describe('Settings — seletor Modelos (Fase A)', () => {
  it('SMS-01: MessageTemplatesPanel permanece montado com companyId original', () => {
    expect(settingsSrc).toContain("import { MessageTemplatesPanel } from '../components/Settings/MessageTemplatesPanel'")
    expect(settingsSrc).toContain('<MessageTemplatesPanel companyId={company.id} />')
  })

  it('SMS-02: seletor externo monta MetaOfficialTemplatesPanel de forma independente', () => {
    expect(settingsSrc).toContain("import { MetaOfficialTemplatesPanel } from '../components/Settings/MetaOfficialTemplatesPanel'")
    expect(settingsSrc).toContain("useState<'life' | 'meta'>('life')")
    expect(settingsSrc).toContain('<MetaOfficialTemplatesPanel />')
    expect(settingsSrc).toContain("t('integrations.whatsappNav.templatesSource.life')")
    expect(settingsSrc).toContain("t('integrations.whatsappNav.templatesSource.meta')")
  })

  it('SMS-03: painel Life não é editado por esta fase (montagem original preservada)', () => {
    const modelosBlock = settingsSrc.slice(
      settingsSrc.indexOf('{/* Modelos */}'),
      settingsSrc.indexOf('{/* Sub-aba: API */}'),
    )
    expect(modelosBlock).toContain('modelosSource === \'life\'')
    expect(modelosBlock).toContain('<MessageTemplatesPanel companyId={company.id} />')
    expect(modelosBlock).not.toContain('MessageTemplatesPanel companyId={company.id} source')
  })
})

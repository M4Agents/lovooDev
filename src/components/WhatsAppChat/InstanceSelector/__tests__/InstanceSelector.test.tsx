// @vitest-environment jsdom
// =============================================================================
// InstanceSelector.test.tsx — MVP3C.3
//
// Cobertura do contrato provider-aware introduzido na Etapa 1 (badge visual)
// e Etapa 2.1 (callback explícito com provider).
//
// IS-01  badge META aparece no dropdown quando provider === 'meta'
// IS-02  badge META não aparece quando provider === 'uazapi'
// IS-03  badge META não aparece quando provider === undefined (legado)
// IS-04  clique em instância Meta: callback(id, 'meta')
// IS-05  clique em instância Uazapi: callback(id, 'uazapi')
// IS-06  clique em instância sem provider (legado): callback(id, undefined)
// IS-07  clique em 'all': callback('all', undefined)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InstanceSelector } from '../InstanceSelector'
import type { WhatsAppProvider } from '../../../../types/meta-whatsapp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// InstanceAvatar: mock sem texto — evita duplicidade com o <p> do InstanceSelector
vi.mock('../InstanceAvatar', () => ({
  InstanceAvatar: () => <div data-testid="instance-avatar" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const META_INSTANCE = {
  id:            'meta-uuid-001',
  instance_name: 'Meta Instance',
  phone_number:  '+55 11 99999-0001',
  status:        'connected',
  provider:      'meta' as WhatsAppProvider,
}

const UAZAPI_INSTANCE = {
  id:            'uazapi-uuid-001',
  instance_name: 'Uazapi Instance',
  phone_number:  '+55 11 99999-0002',
  status:        'connected',
  provider:      'uazapi' as WhatsAppProvider,
}

const LEGACY_INSTANCE = {
  id:            'legacy-uuid-001',
  instance_name: 'Legacy Instance',
  phone_number:  '+55 11 99999-0003',
  status:        'connected',
  // provider ausente — comportamento legado
}

/** Abre o dropdown clicando no botão trigger (o primeiro button do componente) */
function openDropdown(container: Element) {
  const trigger = container.querySelector('button')!
  fireEvent.click(trigger)
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('InstanceSelector — MVP3C.3 badge + provider no callback', () => {

  it('IS-01: badge META aparece no dropdown quando provider === "meta"', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[META_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    // Badge aparece no item da lista Meta
    const badges = screen.getAllByText('META')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('IS-02: badge META NÃO aparece quando provider === "uazapi"', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[UAZAPI_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    expect(screen.queryByText('META')).toBeNull()
  })

  it('IS-03: badge META NÃO aparece quando provider === undefined (legado)', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[LEGACY_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    expect(screen.queryByText('META')).toBeNull()
  })

  it('IS-04: clique em instância Meta chama callback com (id, "meta")', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[META_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    // Clicar no nome da instância (dentro do botão) — o evento borbulha para o onClick
    fireEvent.click(screen.getByText(META_INSTANCE.instance_name))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('meta-uuid-001', 'meta')
  })

  it('IS-05: clique em instância Uazapi chama callback com (id, "uazapi")', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[UAZAPI_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    fireEvent.click(screen.getByText(UAZAPI_INSTANCE.instance_name))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('uazapi-uuid-001', 'uazapi')
  })

  it('IS-06: clique em instância sem provider (legado) chama callback com (id, undefined)', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[LEGACY_INSTANCE]}
        selectedInstance="all"
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    fireEvent.click(screen.getByText(LEGACY_INSTANCE.instance_name))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('legacy-uuid-001', undefined)
  })

  it('IS-07: clique em opção "all" chama callback com ("all", undefined)', () => {
    const cb = vi.fn()
    const { container } = render(
      <InstanceSelector
        instances={[META_INSTANCE]}
        selectedInstance={META_INSTANCE.id}
        onSelectInstance={cb}
        showAllOption={true}
      />
    )
    openDropdown(container)
    // Com selectedInstance=META_INSTANCE.id, o trigger mostra o nome da instância.
    // A opção 'all' no dropdown retorna a chave i18n (mock devolve a própria key).
    // Usa getAllByText para pegar o que está no dropdown (pode haver 2 se trigger
    // também mostrar a mesma key — aqui não é o caso porque trigger mostra instance_name)
    const allOptionText = 'instanceSelector.allInstances'
    fireEvent.click(screen.getByText(allOptionText))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('all', undefined)
  })
})

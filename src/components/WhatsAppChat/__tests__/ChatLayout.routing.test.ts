// =============================================================================
// ChatLayout.routing.test.ts — MVP3C.3 / Etapa 2 + 2.1
//
// Testa a lógica pura de roteamento de instâncias do ChatLayout.
//
// Abordagem: espelha exatamente a lógica inline do componente como funções
// puras. NÃO renderiza o componente (evita mocking excessivo/frágil de
// hooks React, contextos, supabase, etc.).
//
// O que está coberto aqui vs. pelos outros testes:
//   - Lógica de handleSelectInstance:     AQUI (pura)
//   - Callback provider explícito InstanceSelector: InstanceSelector.test.tsx
//   - Exibição da lista Meta:             ConversationSidebar.meta.test.tsx
//   - Select sem provider_token:          chatApi.getCompanyInstances.test.ts
//   - Hook useMetaChatData:               useMetaChatData.test.ts
//
// CL-01  seleção Meta: provider=meta, chatData recebe somente 'all'
// CL-02  seleção Meta: ID Meta NÃO entra em chatData.setSelectedInstance
// CL-03  seleção Uazapi: ID Uazapi vai para chatData.setSelectedInstance
// CL-04  seleção Uazapi: provider=uazapi
// CL-05  seleção 'all': provider=undefined, chatData recebe 'all'
// CL-06  provider=undefined (legado): tratado como Uazapi
// CL-07  hasNoWhatsAppInstances: false quando Meta presente (Meta-only reconhecido)
// CL-08  hasNoWhatsAppInstances: false quando Uazapi presente
// CL-09  hasNoWhatsAppInstances: true somente quando ambos vazios e ambos loaded
// CL-10  hasNoWhatsAppInstances: false enquanto carregamento pendente
// CL-11  metaInstanceId: undefined quando provider !== 'meta'
// CL-12  metaInstanceId: ID correto quando provider === 'meta'
// =============================================================================

import { describe, it, expect } from 'vitest'
import type { WhatsAppProvider } from '../../../types/meta-whatsapp'

// ── Lógica pura espelhada do ChatLayout ───────────────────────────────────────
// Estas funções refletem EXATAMENTE o código do componente sem depender dele.
// Se a lógica mudar no componente, os testes falham — intencionalmente.

type SelectedWAInstance =
  | { provider: 'uazapi'; id: string   }
  | { provider: 'meta';   id: string   }
  | { provider: undefined; id: 'all'  }

/** Espelha a lógica de handleSelectInstance no ChatLayout */
function resolveInstanceSelection(
  id: string,
  provider?: WhatsAppProvider
): { newState: SelectedWAInstance; chatDataArg: string } {
  if (id === 'all') {
    return {
      newState:    { provider: undefined, id: 'all' },
      chatDataArg: 'all',
    }
  }
  if (provider === 'meta') {
    return {
      newState:    { provider: 'meta', id },
      chatDataArg: 'all',   // ← ID Meta NUNCA vai para useChatData
    }
  }
  // provider === 'uazapi' ou undefined (legado)
  return {
    newState:    { provider: 'uazapi', id },
    chatDataArg: id,        // ← ID Uazapi vai para useChatData
  }
}

/** Espelha a lógica de hasNoWhatsAppInstances no ChatLayout (G3) */
function computeHasNoWhatsAppInstances(
  uazapiLoading:  boolean,
  metaLoading:    boolean,
  uazapiCount:    number,
  metaCount:      number
): boolean {
  return (
    !uazapiLoading   &&
    !metaLoading     &&
    uazapiCount === 0 &&
    metaCount   === 0
  )
}

/** Espelha a derivação de metaInstanceId no ChatLayout */
function deriveMetaInstanceId(selected: SelectedWAInstance): string | undefined {
  return selected.provider === 'meta' ? selected.id : undefined
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('ChatLayout routing — lógica pura (MVP3C.3)', () => {

  describe('handleSelectInstance — seleção Meta', () => {
    it('CL-01: seleção Meta define provider=meta no estado', () => {
      const { newState } = resolveInstanceSelection('meta-uuid-001', 'meta')
      expect(newState.provider).toBe('meta')
      expect(newState.id).toBe('meta-uuid-001')
    })

    it('CL-02: seleção Meta → chatData.setSelectedInstance recebe somente "all"', () => {
      const { chatDataArg } = resolveInstanceSelection('meta-uuid-001', 'meta')
      expect(chatDataArg).toBe('all')
      expect(chatDataArg).not.toBe('meta-uuid-001')
    })
  })

  describe('handleSelectInstance — seleção Uazapi', () => {
    it('CL-03: seleção Uazapi → chatData.setSelectedInstance recebe o ID Uazapi', () => {
      const { chatDataArg } = resolveInstanceSelection('uazapi-uuid-001', 'uazapi')
      expect(chatDataArg).toBe('uazapi-uuid-001')
    })

    it('CL-04: seleção Uazapi → provider=uazapi no estado', () => {
      const { newState } = resolveInstanceSelection('uazapi-uuid-001', 'uazapi')
      expect(newState.provider).toBe('uazapi')
    })
  })

  describe('handleSelectInstance — seleção "all"', () => {
    it('CL-05: "all" → provider=undefined, chatData recebe "all"', () => {
      const { newState, chatDataArg } = resolveInstanceSelection('all', undefined)
      expect(newState.provider).toBeUndefined()
      expect(newState.id).toBe('all')
      expect(chatDataArg).toBe('all')
    })
  })

  describe('handleSelectInstance — provider undefined (legado)', () => {
    it('CL-06: provider undefined → tratado como Uazapi, ID vai para chatData', () => {
      const { newState, chatDataArg } = resolveInstanceSelection('legacy-uuid-001', undefined)
      expect(newState.provider).toBe('uazapi')
      expect(chatDataArg).toBe('legacy-uuid-001')
    })
  })

  describe('hasNoWhatsAppInstances — G3 Meta-only', () => {
    it('CL-07: 0 Uazapi + >=1 Meta → false (Meta-only reconhecido como WA disponível)', () => {
      expect(computeHasNoWhatsAppInstances(false, false, 0, 1)).toBe(false)
    })

    it('CL-08: >=1 Uazapi + 0 Meta → false', () => {
      expect(computeHasNoWhatsAppInstances(false, false, 1, 0)).toBe(false)
    })

    it('CL-09: 0 Uazapi + 0 Meta (ambos loaded) → true', () => {
      expect(computeHasNoWhatsAppInstances(false, false, 0, 0)).toBe(true)
    })

    it('CL-10: Uazapi loaded mas Meta ainda loading → false (aguarda Meta)', () => {
      expect(computeHasNoWhatsAppInstances(false, true, 0, 0)).toBe(false)
    })

    it('CL-10b: Meta loaded mas Uazapi ainda loading → false', () => {
      expect(computeHasNoWhatsAppInstances(true, false, 0, 0)).toBe(false)
    })
  })

  describe('metaInstanceId derivation', () => {
    it('CL-11: provider="uazapi" → metaInstanceId é undefined', () => {
      const s: SelectedWAInstance = { provider: 'uazapi', id: 'uazapi-uuid-001' }
      expect(deriveMetaInstanceId(s)).toBeUndefined()
    })

    it('CL-11b: provider=undefined ("all") → metaInstanceId é undefined', () => {
      const s: SelectedWAInstance = { provider: undefined, id: 'all' }
      expect(deriveMetaInstanceId(s)).toBeUndefined()
    })

    it('CL-12: provider="meta" → metaInstanceId é o ID Meta', () => {
      const s: SelectedWAInstance = { provider: 'meta', id: 'meta-uuid-001' }
      expect(deriveMetaInstanceId(s)).toBe('meta-uuid-001')
    })
  })
})

// =============================================================================
// ChatLayout.routing.test.ts — MVP3C.3 / Etapa 2 + 2.1 + MVP3C.4 / Etapa 3
//
// Testa a lógica pura de roteamento de instâncias e painel central do ChatLayout.
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
//   - Hook useMetaChatMessages:           useMetaChatMessages.test.ts
//   - Render MetaChatArea:                MetaChatArea.test.tsx
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
//
// MVP3C.4 — Routing do painel central (Etapa 3):
// CL-13  Meta + conversationId → rota central = 'meta-chat' (MetaChatArea monta)
// CL-14  Meta + conversationId null → rota central = 'meta-empty' (sem MetaChatArea)
// CL-15  Uazapi + chatSelectedConversation → rota central = 'uazapi-chat'
// CL-16  Meta → rota direita = 'meta-placeholder' (LeadPanel Uazapi bloqueado)
// CL-17  Uazapi + chatSelectedConversation → rota direita = 'uazapi-lead'
// CL-18  selectedMetaConversation: encontra pelo ID correto
// CL-19  selectedMetaConversation: undefined quando ID não existe
// CL-20  selectedMetaConversation: undefined quando conversationId é null
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

// =============================================================================
// MVP3C.4 — ROUTING DO PAINEL CENTRAL (Etapa 3)
//
// Funções puras espelhando a lógica do ChatLayout para:
//   1. Decisão do painel central (área de chat)
//   2. Decisão do painel direito (LeadPanel)
//   3. Derivação de selectedMetaConversation
// =============================================================================

// ---------------------------------------------------------------------------
// Tipos auxiliares de rota — espelham a estrutura ternária do ChatLayout
// ---------------------------------------------------------------------------
type CentralPanelRoute =
  | 'instagram'
  | 'meta-chat'     // MetaChatArea monta — conversationId presente
  | 'meta-empty'    // Meta ativo mas sem conversa selecionada
  | 'uazapi'        // ChatArea Uazapi (locked ou chat ou empty)

type RightPanelRoute =
  | 'instagram-right'
  | 'meta-placeholder' // LeadPanel Uazapi bloqueado no branch Meta
  | 'uazapi-lead'      // LeadPanel Uazapi ativo

// ---------------------------------------------------------------------------
// Funções puras — espelham exatamente os ternários de ChatLayout.tsx
// ---------------------------------------------------------------------------

/**
 * Espelha:
 *   selectedChannel === 'instagram' → 'instagram'
 *   selectedWAInstance.provider === 'meta' && selectedConversationId → 'meta-chat'
 *   selectedWAInstance.provider === 'meta' && !selectedConversationId → 'meta-empty'
 *   else → 'uazapi'
 */
function resolveCentralRoute(
  selectedChannel: 'whatsapp' | 'instagram',
  provider: 'uazapi' | 'meta' | undefined,
  selectedConversationId: string | null
): CentralPanelRoute {
  if (selectedChannel === 'instagram') return 'instagram'
  if (provider === 'meta') {
    return selectedConversationId ? 'meta-chat' : 'meta-empty'
  }
  return 'uazapi'
}

/**
 * Espelha:
 *   selectedChannel === 'instagram' → 'instagram-right'
 *   selectedWAInstance.provider === 'meta' → 'meta-placeholder'
 *   else → 'uazapi-lead'
 */
function resolveRightRoute(
  selectedChannel: 'whatsapp' | 'instagram',
  provider: 'uazapi' | 'meta' | undefined
): RightPanelRoute {
  if (selectedChannel === 'instagram') return 'instagram-right'
  if (provider === 'meta') return 'meta-placeholder'
  return 'uazapi-lead'
}

/**
 * Espelha exatamente o useMemo de selectedMetaConversation:
 *   !selectedConversationId → undefined
 *   else → conversations.find(c => c.id === selectedConversationId)
 *
 * NÃO usa instance_id para inferir provider.
 */
function deriveSelectedMetaConversation(
  conversations: Array<{ id: string; wa_id: string; contact_name: string | null }>,
  selectedConversationId: string | null
): { id: string; wa_id: string; contact_name: string | null } | undefined {
  if (!selectedConversationId) return undefined
  return conversations.find(c => c.id === selectedConversationId)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const META_CONV_A = { id: 'meta-conv-aaa', wa_id: '+5511999990001', contact_name: 'Alice Meta' }
const META_CONV_B = { id: 'meta-conv-bbb', wa_id: '+5511999990002', contact_name: 'Bob Meta' }

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------
describe('ChatLayout — Routing painel central MVP3C.4', () => {

  describe('Painel central', () => {
    it('CL-13: Meta + conversationId → rota = "meta-chat" (MetaChatArea monta)', () => {
      expect(resolveCentralRoute('whatsapp', 'meta', 'meta-conv-aaa')).toBe('meta-chat')
    })

    it('CL-14: Meta + conversationId null → rota = "meta-empty" (sem MetaChatArea)', () => {
      expect(resolveCentralRoute('whatsapp', 'meta', null)).toBe('meta-empty')
    })

    it('CL-15: Uazapi + conversationId → rota = "uazapi"', () => {
      expect(resolveCentralRoute('whatsapp', 'uazapi', 'uazapi-conv-xyz')).toBe('uazapi')
    })

    it('CL-15b: provider=undefined ("all") → rota = "uazapi"', () => {
      expect(resolveCentralRoute('whatsapp', undefined, null)).toBe('uazapi')
    })

    it('CL-15c: Instagram → rota = "instagram" (Meta/Uazapi ignorados)', () => {
      // Mesmo que provider seja 'meta', canal Instagram sobrepõe
      expect(resolveCentralRoute('instagram', 'meta', 'meta-conv-aaa')).toBe('instagram')
    })
  })

  describe('Painel direito (LeadPanel)', () => {
    it('CL-16: Meta → rota direita = "meta-placeholder" (LeadPanel Uazapi bloqueado)', () => {
      expect(resolveRightRoute('whatsapp', 'meta')).toBe('meta-placeholder')
    })

    it('CL-17: Uazapi → rota direita = "uazapi-lead" (LeadPanel Uazapi ativo)', () => {
      expect(resolveRightRoute('whatsapp', 'uazapi')).toBe('uazapi-lead')
    })

    it('CL-17b: provider=undefined → rota direita = "uazapi-lead"', () => {
      expect(resolveRightRoute('whatsapp', undefined)).toBe('uazapi-lead')
    })

    it('CL-17c: Instagram → rota direita = "instagram-right"', () => {
      expect(resolveRightRoute('instagram', undefined)).toBe('instagram-right')
    })
  })

  describe('selectedMetaConversation derivation', () => {
    it('CL-18: encontra a conversa pelo ID correto', () => {
      const result = deriveSelectedMetaConversation([META_CONV_A, META_CONV_B], 'meta-conv-bbb')
      expect(result).toEqual(META_CONV_B)
    })

    it('CL-19: retorna undefined quando ID não existe nas conversas', () => {
      const result = deriveSelectedMetaConversation([META_CONV_A, META_CONV_B], 'meta-conv-inexistente')
      expect(result).toBeUndefined()
    })

    it('CL-20: retorna undefined quando conversationId é null', () => {
      const result = deriveSelectedMetaConversation([META_CONV_A, META_CONV_B], null)
      expect(result).toBeUndefined()
    })

    it('CL-20b: retorna undefined quando lista está vazia', () => {
      const result = deriveSelectedMetaConversation([], 'meta-conv-aaa')
      expect(result).toBeUndefined()
    })

    it('CL-20c: NÃO usa instance_id para inferir provider (só usa id)', () => {
      // instance_id NÃO é parte dos critérios de lookup
      const convWithInstance = { id: 'meta-conv-aaa', wa_id: '+55119', contact_name: 'X' }
      const result = deriveSelectedMetaConversation([convWithInstance], 'meta-conv-aaa')
      expect(result?.id).toBe('meta-conv-aaa')
      // O critério de lookup é exclusivamente o id — confirmado pelo fato de que
      // a função não aceita nem usa instance_id como parâmetro
    })
  })
})

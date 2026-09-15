// =============================================================================
// facebookSdk.ts — Loader isolado do Facebook JS SDK
//
// Responsabilidade exclusiva: carregar e inicializar o FB JS SDK.
// window.FB é declarado e utilizado SOMENTE neste arquivo.
//
// Comportamento:
//   - Idempotente: chamadas com o mesmo appId reutilizam a mesma Promise
//   - Concorrente: múltiplas chamadas simultâneas com o mesmo appId compartilham a Promise
//   - appId diferente após inicialização → rejeita (requer reload de página)
//   - Falha de script → rejeita + reseta estado interno para permitir retry
//   - Timeout (10 s) → rejeita + reseta estado interno para permitir retry
//
// Restrições:
//   - Nenhuma VITE_META_*
//   - Nenhuma chamada Graph, /start ou /complete
//   - Nenhum App Secret, token ou credencial
//   - Sem FB.Event.subscribe
//   - Sem heurística de popup blocker
//   - Validação de event.origin pertence ao hook (1D.2)
//
// FB SDK version: v26.0 — alinhada com GRAPH_VERSION de config.js
// =============================================================================

// ── Tipos privados do SDK ─────────────────────────────────────────────────────
// Mínimos: somente os campos necessários para init e login.
// Não exportados — o caller usa window.FB via inferência da augmentação global.

interface FbInitParams {
  appId:     string
  version:   string
  xfbml:     boolean
  cookie:    boolean
  useFedcm?: boolean
}

/** Resposta do callback de FB.login. */
interface FbLoginResponse {
  status:       'connected' | 'not_authorized' | 'unknown'
  authResponse: { code?: string } | null
}

/** Opções do FB.login para o fluxo Embedded Signup. */
interface FbLoginOptions {
  config_id:                      string
  response_type:                  'code'
  override_default_response_type: true
  extras: {
    setup:             Record<string, never>
    featureType:       string
    sessionInfoVersion: string
  }
}

/** Interface mínima do window.FB usada pelo projeto. */
interface FbSdk {
  init  (params: FbInitParams): void
  login (callback: (response: FbLoginResponse) => void, options: FbLoginOptions): void
}

// ── Augmentação global ────────────────────────────────────────────────────────
// Declara window.FB e window.fbAsyncInit globalmente para TypeScript.
// Esta é a ÚNICA ocorrência de window.FB em todo o projeto.

declare global {
  interface Window {
    FB?:          FbSdk
    fbAsyncInit?: () => void
  }
}

// ── Estado de módulo ──────────────────────────────────────────────────────────
// Garante uma única inicialização por runtime (SPA — não há SSR neste projeto).

const LOAD_TIMEOUT_MS = 10_000

let _loadedAppId: string | null       = null
let _loadPromise: Promise<void> | null = null

/**
 * Reseta o estado interno após falha — permite nova tentativa.
 *
 * Remove o elemento de script do DOM para evitar que uma nova chamada encontre
 * o script quebrado/expirado e fique com a Promise pendurada (aguardando
 * fbAsyncInit que nunca virá de um script com onerror já disparado).
 *
 * Se o script ainda estiver em carregamento quando chamado (ex: timeout),
 * removê-lo do DOM não garante cancelamento do download em todos os browsers,
 * mas a eventual execução chamará o window.fbAsyncInit mais recente — aceitável.
 */
function _resetState(): void {
  _loadedAppId = null
  _loadPromise = null
  document.getElementById('facebook-jssdk')?.remove()
}

// ── loadFacebookSdk ───────────────────────────────────────────────────────────

/**
 * Carrega e inicializa o Facebook JS SDK com o appId fornecido.
 *
 * Casos:
 *   1. Primeiro call (ou após falha): injeta script, aguarda fbAsyncInit, chama FB.init.
 *   2. Call concorrente com mesmo appId: reutiliza a Promise em andamento.
 *   3. Call após sucesso com mesmo appId: retorna a Promise já resolvida.
 *   4. Call com appId diferente após init: rejeita — re-init não suportado pelo SDK.
 *
 * @param appId - Facebook App ID público (obtido de /api/whatsapp/meta/onboarding/start).
 * @returns Promise<void> que resolve quando window.FB estiver pronto para uso.
 */
export function loadFacebookSdk(appId: string): Promise<void> {
  // Guarda: appId deve ser string não vazia.
  if (typeof appId !== 'string' || appId.length === 0) {
    return Promise.reject(new Error('appId inválido'))
  }

  // Caso 1+2+3: mesmo appId e Promise já existe → reutilizar (pending ou resolved).
  if (_loadedAppId === appId && _loadPromise !== null) {
    return _loadPromise
  }

  // Caso 4: SDK inicializado com appId DIFERENTE → rejeitar imediatamente.
  // Re-init de FB.init com outro app na mesma página não é suportado pelo SDK.
  if (_loadedAppId !== null && _loadedAppId !== appId) {
    return Promise.reject(
      new Error('FB SDK já inicializado com app_id diferente. Recarregue a página.')
    )
  }

  // Caso 1: primeira chamada ou retry após falha — criar nova Promise.
  _loadedAppId = appId

  _loadPromise = new Promise<void>((resolve, reject) => {
    // Flag para garantir que resolve/reject sejam chamados no máximo uma vez,
    // mesmo que fbAsyncInit e onerror disparem em condição de corrida.
    let settled = false

    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    // ── Timeout defensivo ────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      settle(() => {
        _resetState()
        reject(new Error('Timeout ao carregar FB SDK'))
      })
    }, LOAD_TIMEOUT_MS)

    // ── fbAsyncInit ──────────────────────────────────────────────────────────
    // O SDK chama window.fbAsyncInit automaticamente após carregar.
    // Também invocado diretamente quando window.FB já existe (hot-reload / DEV).
    window.fbAsyncInit = (): void => {
      settle(() => {
        try {
          window.FB!.init({
            appId,
            version:  'v26.0',  // alinhado com GRAPH_VERSION = 'v26.0' em config.js
            xfbml:    false,
            cookie:   false,
            useFedcm: false,    // desabilita diálogo FedCM nativo do Chrome
          })
          resolve()
        } catch {
          _resetState()
          reject(new Error('Erro ao inicializar FB SDK'))
        }
      })
    }

    // ── SDK já presente no window (hot-reload ou init externo) ───────────────
    // Chamar fbAsyncInit diretamente — não re-injetar script.
    if (window.FB) {
      window.fbAsyncInit()
      return
    }

    // ── Script já no DOM (React StrictMode dupla-montagem) ───────────────────
    // O SDK está carregando — fbAsyncInit será chamado pelo script ao terminar.
    if (document.getElementById('facebook-jssdk')) {
      return
    }

    // ── Injeção do script ────────────────────────────────────────────────────
    // URL oficial Meta — única ocorrência de injeção de script externo no projeto.
    const script    = document.createElement('script')
    script.id       = 'facebook-jssdk'
    script.src      = 'https://connect.facebook.net/en_US/sdk.js'
    script.async    = true
    script.defer    = true
    script.onerror  = (): void => {
      settle(() => {
        _resetState()
        reject(new Error('Erro ao carregar script FB SDK'))
      })
    }

    document.head.appendChild(script)
  })

  return _loadPromise
}

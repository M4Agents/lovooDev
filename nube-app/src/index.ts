/**
 * LovoCRM NubeSDK — Attribution Signal
 *
 * Envia um conversion_signal para o backend LovoCRM quando o visitante
 * preenche dados de contato no checkout Nuvemshop.
 *
 * Fluxo:
 *   1. customer:update dispara (com debounce de 1.5s)
 *   2. Validar: store_id, checkout_id e (email OU phone) presentes
 *   3. POST /api/nuvemshop-attribution-signal
 *   4. Se VISITOR_LINK_NOT_FOUND → uma nova tentativa após ~3s
 *
 * Garantia de idempotência:
 *   A garantia definitiva está no banco (UNIQUE company_id + checkout_id).
 *   O estado local (signalSent, timer) é apenas proteção contra chamadas
 *   excessivas no mesmo ciclo de vida do Worker.
 *
 * Regras PII:
 *   NUNCA logar email, phone, name ou qualquer dado pessoal.
 *   NUNCA incluir service_role ou credenciais no bundle.
 *
 * Feature flag:
 *   O endpoint verifica NUVEMSHOP_ATTRIBUTION_ENABLED no backend.
 *   Ausente ou falso → FEATURE_DISABLED → nenhum signal é criado.
 *   O NubeSDK não tem acesso à flag — a decisão é exclusivamente do backend.
 */

import type { NubeSDK, NubeSDKState } from '@tiendanube/nube-sdk-types';

// URL da API LovoCRM — única secret do bundle (URL pública, sem credenciais)
const ATTRIBUTION_API = 'https://app.lovoocrm.com/api/nuvemshop-attribution-signal';

// Timeout do debounce (ms) — evita burst de chamadas durante preenchimento do form
const DEBOUNCE_MS = 1500;

// Delay da segunda tentativa quando VISITOR_LINK_NOT_FOUND (ms)
const RETRY_DELAY_MS = 3000;

/** Conjunto de checkout_ids para os quais o signal já foi enviado com sucesso neste Worker. */
const sentCheckouts = new Set<string>();

/** Timer ativo de debounce (referência para cancelamento). */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Extrai checkout_id de forma determinística.
 * Usa state.cart.id (igual ao checkout_id na URL).
 * Fallback: parse da URL apenas se cart.id não disponível.
 */
function getCheckoutId(state: Readonly<NubeSDKState>): string | null {
  const cartIdRaw = state.cart?.id;
  // cart.id pode ser string ou number dependendo da versão dos tipos NubeSDK
  if (cartIdRaw != null) {
    const asStr = String(cartIdRaw).trim();
    if (/^\d+$/.test(asStr) && asStr !== '0') return asStr;
  }
  // Fallback: extrair da URL para robustez
  const match = state.location?.url?.match(/\/checkout\/v3\/[^/]+\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 * Envia o attribution signal para o backend.
 * Nunca loga valores de PII (email, phone, name).
 * Retorna o reason de falha ou null se bem-sucedido.
 */
async function postSignal(payload: {
  store_id:    number;
  checkout_id: string;
  email:       string | null;
  phone:       string | null;
  name:        string | null;
}): Promise<{ success: boolean; reason?: string }> {
  try {
    const res = await fetch(ATTRIBUTION_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn('[lovocrm] attribution response não-ok', { status: res.status });
      return { success: false, reason: 'HTTP_ERROR' };
    }

    const json = await res.json() as { success?: boolean; reason?: string; signal_id?: string };
    return { success: !!json.success, reason: json.reason };
  } catch {
    return { success: false, reason: 'FETCH_ERROR' };
  }
}

/**
 * Orquestra envio e retry único para VISITOR_LINK_NOT_FOUND.
 * Fail-open: nenhuma exceção pode propagar para o runtime NubeSDK.
 */
async function trySendSignal(payload: {
  store_id:    number;
  checkout_id: string;
  email:       string | null;
  phone:       string | null;
  name:        string | null;
}): Promise<void> {
  const localKey = `${payload.store_id}:${payload.checkout_id}`;

  // Proteção local: evitar chamada dupla no mesmo Worker para o mesmo checkout
  if (sentCheckouts.has(localKey)) return;

  const result = await postSignal(payload);

  if (result.success) {
    sentCheckouts.add(localKey);
    console.log('[lovocrm] attribution signal ok', { checkout_id: payload.checkout_id });
    return;
  }

  // VISITOR_LINK_NOT_FOUND: bridge pode não ter chegado ainda — uma nova tentativa
  if (result.reason === 'VISITOR_LINK_NOT_FOUND') {
    console.log('[lovocrm] attribution retry agendado', { checkout_id: payload.checkout_id });
    setTimeout(async () => {
      if (sentCheckouts.has(localKey)) return;
      const retry = await postSignal(payload);
      if (retry.success) {
        sentCheckouts.add(localKey);
        console.log('[lovocrm] attribution retry ok', { checkout_id: payload.checkout_id });
      } else {
        // Fail-open: segunda tentativa esgotada, não bloquear checkout
        console.log('[lovocrm] attribution retry falhou', { reason: retry.reason, checkout_id: payload.checkout_id });
      }
    }, RETRY_DELAY_MS);
    return;
  }

  // Qualquer outra falha (FEATURE_DISABLED, STORE_NOT_FOUND, etc.) — sem retry
  console.log('[lovocrm] attribution signal falhou', { reason: result.reason });
}

export function App(nube: NubeSDK): void {
  // customer:update dispara enquanto o usuário preenche o form.
  // Debounce de 1.5s para evitar burst de chamadas.
  nube.on('customer:update', (state: Readonly<NubeSDKState>) => {
    const storeId    = state.store?.id;
    const checkoutId = getCheckoutId(state);
    const contact    = state.customer?.contact;
    const email      = contact?.email?.trim() || null;
    const phone      = contact?.phone?.trim() || null;
    const name       = contact?.name?.trim()  || null;

    // Pré-condições mínimas: store, checkout e pelo menos email ou phone
    if (!storeId || !checkoutId || (!email && !phone)) return;

    // Cancelar debounce anterior se ainda pendente
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const payload = { store_id: storeId, checkout_id: checkoutId, email, phone, name };

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // NÃO usar await aqui (callback NubeSDK é síncrono)
      trySendSignal(payload).catch(() => {
        // fail-open: nunca propagar erro para o runtime NubeSDK
      });
    }, DEBOUNCE_MS);
  });

  // Limpar timer pendente na navegação entre steps
  nube.on('location:updated', () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });
}

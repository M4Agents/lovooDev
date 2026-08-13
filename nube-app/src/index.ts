/**
 * LovoCRM NubeSDK — Fase A: Validação de Correlação
 *
 * PROPÓSITO: apenas coleta dados técnicos de correlação para validação da arquitetura.
 * NÃO persiste dados, NÃO envia sinais, NÃO interfere no checkout.
 *
 * Dados capturados (somente técnicos, sem PII):
 *   - state.location.url  (URL da página)
 *   - checkout_id         (extraído da URL)
 *   - state.cart.id       (identificador do carrinho)
 *   - state.store.id      (identificador da loja)
 *   - checkout step       (start / payment / success)
 *   - asyncLocalStorage   (resultado da leitura de lovocrm_visitor_id — SIM/NÃO)
 *
 * NÃO loga: email, telefone, nome, endereço, CPF ou qualquer dado pessoal.
 */

import type { NubeSDK, NubeSDKState } from '@tiendanube/nube-sdk-types';

const PREFIX = '[lovocrm-nube-fase-a]';

function extractCheckoutId(url: string): string | null {
  // Padrão: /checkout/v3/{step}/{checkout_id}/...
  const match = url.match(/\/checkout\/v3\/[^/]+\/(\d+)\//);
  return match ? match[1] : null;
}

function getStep(state: Readonly<NubeSDKState>): string {
  const page = state.location.page;
  if (page.type === 'checkout') return page.data.step;
  return page.type;
}

function logTechnicalData(
  label: string,
  state: Readonly<NubeSDKState>,
  asyncVisitorId?: string | null
): void {
  const url = state.location.url;
  const checkoutId = extractCheckoutId(url);
  const cartId = state.cart?.id ?? null;
  const storeId = state.store?.id ?? null;
  const step = getStep(state);

  console.group(`${PREFIX} ${label}`);
  console.log('location.url  :', url);
  console.log('checkout_id   :', checkoutId ?? '(não encontrado na URL)');
  console.log('cart.id       :', cartId ?? '(null)');
  console.log('store.id      :', storeId ?? '(null)');
  console.log('step          :', step);

  if (asyncVisitorId !== undefined) {
    const readable = asyncVisitorId !== null ? 'SIM — valor presente' : 'NÃO — null (scoped ou ausente)';
    console.log('asyncLocalStorage[lovocrm_visitor_id]:', readable);
  }

  // Diagnóstico de correlação
  const idMatch =
    checkoutId !== null && cartId !== null
      ? checkoutId === cartId
        ? '✓ checkout_id == cart.id'
        : `✗ checkout_id (${checkoutId}) ≠ cart.id (${cartId})`
      : '(não foi possível comparar — um ou ambos nulos)';
  console.log('correlação    :', idMatch);
  console.groupEnd();
}

export function App(nube: NubeSDK): void {
  const browser = nube.getBrowserAPIs();

  // 1. Captura inicial: assim que o app carrega
  nube.on('checkout:ready', async (state) => {
    let asyncVisitorId: string | null = null;
    try {
      asyncVisitorId = await browser.asyncLocalStorage.getItem('lovocrm_visitor_id');
    } catch {
      asyncVisitorId = null;
    }
    logTechnicalData('checkout:ready', state, asyncVisitorId);
  });

  // 2. Captura a cada transição de step (start → payment → success)
  nube.on('location:updated', (state) => {
    const page = state.location.page;
    if (page.type !== 'checkout') return;
    logTechnicalData('location:updated (checkout)', state);
  });

  // 3. Captura quando o customer preenche dados
  //    Loga APENAS confirmação de presença (SIM/NÃO), sem valor
  nube.on('customer:update', async (state) => {
    const contact = state.customer?.contact;
    const hasEmail = contact?.email != null && contact.email !== '';
    const hasPhone = contact?.phone != null && contact.phone !== '';
    const hasName  = contact?.name  != null && contact.name  !== '';

    // Reler asyncLocalStorage a cada customer:update para detectar mudança
    let asyncVisitorId: string | null = null;
    try {
      asyncVisitorId = await browser.asyncLocalStorage.getItem('lovocrm_visitor_id');
    } catch {
      asyncVisitorId = null;
    }

    logTechnicalData('customer:update', state, asyncVisitorId);

    // Confirma presença de contato (SIM/NÃO — sem logar o valor)
    console.log(`${PREFIX} contato presente: email=${hasEmail} phone=${hasPhone} name=${hasName}`);
  });

  // 4. Captura no sucesso do pedido
  nube.on('order:update', (state) => {
    logTechnicalData('order:update (success)', state);
    // eventPayload pode conter order.id — logar se presente
    const payload = state.eventPayload as Record<string, unknown> | null;
    if (payload?.id) {
      console.log(`${PREFIX} order.id (eventPayload):`, payload.id);
    }
  });
}

// =============================================================================
// cartHandler — placeholder (Fase 10)
//
// Responsável por processar eventos checkout/* da Nuvemshop:
//   checkout/abandoned → carrinho abandonado com URL de recuperação
//
// ESTA FASE (Fase 4): apenas registra o evento recebido.
// FASE 10: upsert em leads com nuvemshop_checkout_id e checkout_url.
//          checkout_url é dado sensível de negócio — nunca logar.
// =============================================================================

/**
 * @param {{ companyId: string, storeId: string, topic: string, payload: object, correlationId: string, workerId: string }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function cartHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // NUNCA logar payload completo — pode conter checkout_url (dado sensível)
  console.log('[cartHandler] received topic=%s companyId=%s storeId=%s resourceId=%s corr=%s',
    topic, companyId, storeId, payload?.id ?? 'n/a', correlationId);

  // TODO (Fase 10): buscar checkout completo via GET /checkouts/{id}
  // TODO (Fase 10): upsert em leads (checkout_url NUNCA vai para logs)

  return { ok: true };
}

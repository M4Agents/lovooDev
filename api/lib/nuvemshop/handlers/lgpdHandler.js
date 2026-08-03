// =============================================================================
// lgpdHandler — placeholder (Fase 18)
//
// Responsável por processar eventos de dados pessoais (LGPD/GDPR):
//   store/redact         → excluir dados da loja
//   customers/redact     → excluir dados de um cliente específico
//   customers/data_request → retornar dados de um cliente
//
// ESTA FASE (Fase 4): apenas registra o evento recebido.
// FASE 18: implementar conforme exigências da Nuvemshop e LGPD.
//
// Segurança:
//   - Nenhum dado pessoal deve ser logado neste handler
//   - Implementação requer revisão jurídica e de segurança
// =============================================================================

/**
 * @param {{ companyId: string, storeId: string, topic: string, payload: object, correlationId: string, workerId: string }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function lgpdHandler(ctx) {
  const { companyId, storeId, topic, correlationId } = ctx;

  // NUNCA logar payload — contém dados pessoais sensíveis
  console.log('[lgpdHandler] received topic=%s companyId=%s storeId=%s corr=%s',
    topic, companyId, storeId, correlationId);

  // TODO (Fase 18): implementar conforme LGPD + exigências da plataforma Nuvemshop

  return { ok: true };
}

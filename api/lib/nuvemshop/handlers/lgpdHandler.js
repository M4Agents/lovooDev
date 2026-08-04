// =============================================================================
// lgpdHandler — Conformidade LGPD/GDPR (Nuvemshop)
//
// Processa eventos de dados pessoais obrigatórios para aprovação do app:
//   store/redact          → loja solicita exclusão de todos os seus dados
//   customers/redact      → cliente solicita exclusão dos seus dados
//   customers/data_request → cliente solicita cópia dos seus dados
//
// Etapa 1 (atual): registra a solicitação na tabela de auditoria e responde 200.
//   Suficiente para aprovação técnica do app pela Nuvemshop.
//
// Etapa 2 (futura): implementar anonimização real dos dados pessoais.
//   Obrigatória antes de abrir o app para novos merchants em escala.
//
// Segurança:
//   - NUNCA logar payload completo — contém dados pessoais sensíveis
//   - customer_email armazenado apenas como hash SHA-256 (não reversível)
//   - Falha no registro de auditoria nunca bloqueia o 200 de resposta
// =============================================================================

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';

/**
 * Gera hash SHA-256 de um email para auditoria sem armazenar o dado real.
 * @param {string|null} email
 * @returns {string|null}
 */
function hashEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * @param {{ companyId: string, storeId: string, topic: string, payload: object, correlationId: string }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function lgpdHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // NUNCA logar payload — contém dados pessoais sensíveis
  console.log(JSON.stringify({
    level:         'info',
    event:         'lgpd_request_received',
    topic,
    company_id:    companyId,
    store_id:      storeId,
    correlation_id: correlationId,
  }));

  // ── Extrair apenas IDs (sem PII direta) ──────────────────────────────────
  const customerId    = payload?.customer?.id    ? String(payload.customer.id)    : null;
  const customerEmail = payload?.customer?.email ? hashEmail(payload.customer.email) : null;

  // ── Registrar na tabela de auditoria (best-effort) ───────────────────────
  // Falha não bloqueia o 200 — a Nuvemshop não deve fazer retry por erro interno nosso.
  try {
    const svc = getSupabaseAdmin();
    const { error } = await svc
      .from('nuvemshop_lgpd_requests')
      .insert({
        company_id:     companyId,
        store_id:       storeId,
        topic,
        customer_id:    customerId,
        customer_email: customerEmail,
        status:         'received',
        correlation_id: correlationId,
        received_at:    new Date().toISOString(),
      });

    if (error) {
      console.error(JSON.stringify({
        level:         'error',
        event:         'lgpd_audit_insert_failed',
        topic,
        company_id:    companyId,
        store_id:      storeId,
        correlation_id: correlationId,
        error:          error.message,
      }));
    } else {
      console.log(JSON.stringify({
        level:         'info',
        event:         'lgpd_request_registered',
        topic,
        company_id:    companyId,
        store_id:      storeId,
        correlation_id: correlationId,
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      level:         'error',
      event:         'lgpd_audit_exception',
      topic,
      company_id:    companyId,
      store_id:      storeId,
      correlation_id: correlationId,
      error:          err?.message,
    }));
  }

  // TODO (Etapa 2): implementar anonimização real conforme LGPD.
  // customers/redact     → anonimizar lead pelo customer_id/email
  // store/redact         → anonimizar todos os dados da conexão
  // customers/data_request → compilar e registrar dados do cliente

  return { ok: true };
}

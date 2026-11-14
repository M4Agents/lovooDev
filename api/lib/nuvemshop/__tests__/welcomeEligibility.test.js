import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyIdentity,
  evaluateSyncedPurchases,
  paymentStatusOf,
} from '../welcomeEligibility.js';
import { publicSignupClosed } from '../welcomePopupAccess.js';

const paid = { status: 'won', nuvemshop_payment_data: { payment_status: 'paid' } };
const wonOnly = { status: 'won', nuvemshop_payment_data: null };
const refunded = { status: 'lost', nuvemshop_payment_data: { payment_status: 'refunded' } };
const partial = { status: 'open', nuvemshop_payment_data: { payment_status: 'partially_refunded' } };

describe('elegibilidade pelo histórico sincronizado', () => {
  it('não usa status won como prova de pagamento', () => {
    expect(paymentStatusOf(wonOnly)).toBeNull();
    expect(evaluateSyncedPurchases([wonOnly]).eligibility).toBe('payment_inconclusive');
    expect(evaluateSyncedPurchases([wonOnly]).eligibility).not.toBe('eligible_limited');
  });

  it('trata compra paga como inelegível, mesmo junto de won', () => {
    expect(evaluateSyncedPurchases([wonOnly, paid]).eligibility).toBe('ineligible_paid');
  });

  it('não concede quando há reembolso e a regra ainda não foi decidida', () => {
    expect(evaluateSyncedPurchases([refunded]).eligibility).toBe('pending_refund_rule');
    expect(evaluateSyncedPurchases([partial]).eligibility).toBe('pending_refund_rule');
    expect(evaluateSyncedPurchases([paid, refunded]).eligibility).toBe('ineligible_paid');
  });

  it('registra a limitação quando nenhum pedido aparece', () => {
    const result = evaluateSyncedPurchases([]);
    expect(result.eligibility).toBe('eligible_limited');
    expect(result.limitation).toMatch(/não comprova primeira compra/);
  });

  it('não trata pedido com pagamento inconclusivo como ausência', () => {
    const pending = { status: 'won', nuvemshop_payment_data: { payment_status: 'pending' } };
    const unknown = { status: 'open', nuvemshop_payment_data: { payment_status: 'success' } };
    const pendingResult = evaluateSyncedPurchases([pending]);
    const unknownResult = evaluateSyncedPurchases([unknown]);

    expect(pendingResult.eligibility).toBe('payment_inconclusive');
    expect(unknownResult.eligibility).toBe('payment_inconclusive');
    expect(pendingResult.limitation).toMatch(/não é tratado como ausência/);
    expect(evaluateSyncedPurchases([paid, pending]).eligibility).toBe('ineligible_paid');
    expect(evaluateSyncedPurchases([refunded, pending]).eligibility).toBe('pending_refund_rule');
  });

  it('não mescla e-mail e telefone de leads diferentes', () => {
    expect(classifyIdentity([10], [11])).toEqual({ identity: 'conflict', leadId: null });
    expect(classifyIdentity([10], [10])).toEqual({ identity: 'reuse', leadId: 10 });
    expect(classifyIdentity([], [])).toEqual({ identity: 'none', leadId: null });
  });
});

describe('endpoint público', () => {
  it('permanece fechado enquanto enabled é false', () => {
    expect(publicSignupClosed({
      enabled: false,
      allowed_origins: ['https://valleron.store'],
      consent_text: 'Aceito',
      consent_version: '2026-11',
      coupon_code: 'BEMVINDO10',
    }).code).toBe('publication_blocked');
  });

  it('não abre cadastro real mesmo com a configuração completa', () => {
    expect(publicSignupClosed({
      enabled: true,
      allowed_origins: ['https://valleron.store'],
      consent_text: 'Aceito',
      consent_version: '2026-11',
      coupon_code: 'BEMVINDO10',
    }).code).toBe('public_registration_unavailable');
  });
});

describe('migration do teste', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../../../../supabase/migrations/20261114130000_nuvemshop_welcome_test_submissions.sql'),
    'utf8',
  );

  it('isola o teste e não remove o bloqueio de publicação', () => {
    expect(sql).toContain('CREATE TABLE public.nuvemshop_welcome_test_submissions');
    expect(sql).not.toMatch(/DROP CONSTRAINT chk_nv_welcome_unpublished|enabled = true/);
    expect(sql).toContain('private.nuvemshop_welcome_origins_valid(allowed_origins)');
    expect(sql).toContain('GRANT USAGE ON SCHEMA private TO service_role');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION private.nuvemshop_welcome_origins_valid(text[]) TO service_role');
    expect(sql).not.toMatch(/GRANT CREATE ON SCHEMA private|GRANT ALL ON SCHEMA private|GRANT EXECUTE ON ALL FUNCTIONS/i);
    expect(sql).not.toMatch(/REVOKE ALL ON FUNCTION private\.lead_|ALTER FUNCTION private\.lead_|OWNER TO/);
    expect(sql).toContain('payment_inconclusive');
    expect(sql).not.toMatch(/ARRAY\s*\(\s*SELECT/);
    expect(sql).toContain('aplicar esta migration aditiva antes de publicar');
    expect(sql).not.toMatch(/automation_state|coupon_code|lead\.created/i);
    expect(sql).toContain('FOR SELECT');
    expect(sql).not.toMatch(/FOR INSERT|FOR UPDATE|FOR DELETE/);
    expect(sql).toContain('GRANT ALL ON TABLE public.nuvemshop_welcome_test_submissions TO service_role');
    expect(sql).toContain('prazo de retenção');
  });
});

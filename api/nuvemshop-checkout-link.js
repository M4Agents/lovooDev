// =============================================================================
// POST /api/nuvemshop-checkout-link
//
// Recebe beacon do m4track quando detecta URL de checkout Nuvemshop.
// Grava a associação visitor_id × checkout_id na bridge visitor_checkout_links.
//
// Autorização automática: qualquer empresa com integração Nuvemshop ativa
// (nuvemshop_connections.status = 'active') é elegível — sem allowlist manual.
// Novas empresas são cobertas automaticamente ao conectar a Nuvemshop via OAuth.
//
// Fluxo de validação:
//   1. Validar método e payload
//   2. Validar formato de tracking_code, visitor_id, checkout_id
//   3. Verificar kill switch global (NUVEMSHOP_BRIDGE_ENABLED)
//   4. Resolver company_id pelo tracking_code (landing_pages ativa)
//   5. Validar que visitor_id pertence ao mesmo company_id
//   6. Validar que company_id possui integração Nuvemshop ativa
//   7. Verificar vínculo existente (company_id, checkout_id):
//      — Inexistente → INSERT
//      — Mesmo visitor → already_linked (idempotente)
//      — Outro visitor → VISITOR_CONFLICT, não sobrescrever
//
// Segurança:
//   — tracking_code é público; não é autenticação suficiente isoladamente
//   — visitor_id validado por ownership real (visitors → landing_pages → company_id)
//   — integração Nuvemshop ativa é verificação obrigatória adicional
//   — company_id nunca vem do request
//   — service_role exclusivo para operações de banco
//   — Responde sempre HTTP 200 (beacon não deve falhar o checkout)
// =============================================================================

import { getSupabaseAdmin }              from './lib/automation/supabaseAdmin.js';
import { hasActiveNuvemshopIntegration } from './lib/nuvemshop/checkIntegration.js';

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGIT_RE = /^\d+$/;
const MAX_CHECKOUT_ID_LEN = 20;
const MAX_PAYLOAD_BYTES   = 1024;

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
}

function isValidUUID(str) {
  return typeof str === 'string' && UUID_RE.test(str);
}

function isValidCheckoutId(str) {
  return (
    typeof str === 'string' &&
    str.length > 0 &&
    str.length <= MAX_CHECKOUT_ID_LEN &&
    DIGIT_RE.test(str)
  );
}

function sanitizeError(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err.slice(0, 200);
  if (err instanceof Error) return (err.message || 'Error').slice(0, 200);
  return 'unknown';
}

/**
 * Kill switch global da bridge.
 * Ausente ou qualquer valor diferente de 'false' → bridge habilitada.
 * NUVEMSHOP_BRIDGE_ENABLED=false → desliga globalmente em emergência.
 * Nota: a alteração desta variável tem efeito após o próximo deployment da Function.
 */
function isBridgeGloballyEnabled() {
  return process.env.NUVEMSHOP_BRIDGE_ENABLED !== 'false';
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body || {};

    // 1. Rejeitar payloads excessivos (proteção anti-abuso mínima)
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
      res.status(200).json({ success: false, reason: 'PAYLOAD_TOO_LARGE' });
      return;
    }

    // 2. Extrair e validar campos
    const tracking_code = typeof body.tracking_code === 'string' ? body.tracking_code.trim() : '';
    const visitor_id    = typeof body.visitor_id    === 'string' ? body.visitor_id.trim()    : '';
    const checkout_id   = typeof body.checkout_id   === 'string' ? body.checkout_id.trim()   : '';

    if (!tracking_code || !visitor_id || !checkout_id) {
      res.status(200).json({ success: false, reason: 'MISSING_FIELDS' });
      return;
    }

    if (!isValidUUID(tracking_code) || !isValidUUID(visitor_id)) {
      res.status(200).json({ success: false, reason: 'INVALID_FORMAT' });
      return;
    }

    if (!isValidCheckoutId(checkout_id)) {
      res.status(200).json({ success: false, reason: 'INVALID_FORMAT' });
      return;
    }

    // 3. Kill switch global (sem DB call — avaliado antes de qualquer I/O)
    if (!isBridgeGloballyEnabled()) {
      res.status(200).json({ success: false, reason: 'FEATURE_DISABLED' });
      return;
    }

    // 4. Resolver company_id pelo tracking_code (landing page ativa)
    const company_id = await resolveCompanyId(tracking_code);
    if (!company_id) {
      res.status(200).json({ success: false, reason: 'INVALID_TRACKING_CODE' });
      return;
    }

    // 5. Validar ownership: visitor_id deve pertencer ao mesmo company_id
    const ownershipOk = await validateVisitorOwnership(visitor_id, company_id);
    if (!ownershipOk) {
      console.warn('[checkout-link] visitor_id não pertence ao company_id', {
        checkout_id,
        company_id,
      });
      res.status(200).json({ success: false, reason: 'VISITOR_MISMATCH' });
      return;
    }

    // 6. Validar que a empresa possui integração Nuvemshop ativa
    const svc = getSupabaseAdmin();
    const hasNuvemshop = await hasActiveNuvemshopIntegration(company_id, svc);
    if (!hasNuvemshop) {
      res.status(200).json({ success: false, reason: 'NO_ACTIVE_NUVEMSHOP' });
      return;
    }

    // 7. Gravar ou verificar vínculo existente
    const result = await upsertBridge({ company_id, checkout_id, visitor_id });
    res.status(200).json(result);
  } catch (err) {
    console.error('[checkout-link] exception:', sanitizeError(err));
    // fail-open: nunca propagar erro para o m4track
    res.status(200).json({ success: false, reason: 'INTERNAL_ERROR' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCompanyId(tracking_code) {
  try {
    const svc = getSupabaseAdmin();
    const { data, error } = await svc
      .from('landing_pages')
      .select('company_id')
      .eq('tracking_code', tracking_code)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (error || !data?.company_id) return null;
    return data.company_id;
  } catch {
    return null;
  }
}

/**
 * Valida que o visitor_id foi registrado por uma landing_page da mesma empresa.
 * Cadeia: visitors.landing_page_id → landing_pages.company_id
 */
async function validateVisitorOwnership(visitor_id, company_id) {
  try {
    const svc = getSupabaseAdmin();

    // Passo 1: obter landing_page_id do visitor
    const { data: visitor, error: vErr } = await svc
      .from('visitors')
      .select('landing_page_id')
      .eq('visitor_id', visitor_id)
      .limit(1)
      .maybeSingle();

    if (vErr || !visitor?.landing_page_id) return false;

    // Passo 2: verificar que a landing page pertence ao company_id esperado
    const { data: lp, error: lpErr } = await svc
      .from('landing_pages')
      .select('id')
      .eq('id', visitor.landing_page_id)
      .eq('company_id', company_id)
      .limit(1)
      .maybeSingle();

    if (lpErr || !lp) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * INSERT na bridge, respeitando a constraint UNIQUE(company_id, checkout_id).
 * — Mesmo visitor_id → idempotente (already_linked)
 * — Visitor_id diferente → VISITOR_CONFLICT, não sobrescreve
 *
 * Race condition: dois requests simultâneos podem passar pelo SELECT sem
 * encontrar registro e tentar INSERT ao mesmo tempo. O erro 23505
 * (unique violation pela constraint uq_vcl_company_checkout) é capturado,
 * relido e tratado como already_linked ou VISITOR_CONFLICT conforme o
 * visitor_id gravado — nunca como sucesso silencioso ou sobrescrita.
 */
async function upsertBridge({ company_id, checkout_id, visitor_id }) {
  try {
    const svc = getSupabaseAdmin();

    // Verificar vínculo existente antes do INSERT
    const { data: existing, error: selErr } = await svc
      .from('visitor_checkout_links')
      .select('visitor_id')
      .eq('company_id', company_id)
      .eq('checkout_id', checkout_id)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      console.error('[checkout-link] erro ao verificar bridge:', selErr.message);
      return { success: false, reason: 'INTERNAL_ERROR' };
    }

    if (existing) {
      if (existing.visitor_id === visitor_id) {
        return { success: true, status: 'already_linked' };
      }
      // Conflito de identidade — não sobrescrever
      console.warn('[checkout-link] VISITOR_CONFLICT detectado', { company_id, checkout_id });
      return { success: false, reason: 'VISITOR_CONFLICT' };
    }

    const { error: insErr } = await svc
      .from('visitor_checkout_links')
      .insert({ company_id, checkout_id, visitor_id });

    if (insErr) {
      // Race condition: outro request ganhou o INSERT simultaneamente
      if (insErr.code === '23505') {
        const { data: raceRow } = await svc
          .from('visitor_checkout_links')
          .select('visitor_id')
          .eq('company_id', company_id)
          .eq('checkout_id', checkout_id)
          .limit(1)
          .maybeSingle();

        if (raceRow?.visitor_id === visitor_id) {
          return { success: true, status: 'already_linked' };
        }
        console.warn('[checkout-link] VISITOR_CONFLICT por race condition', { company_id, checkout_id });
        return { success: false, reason: 'VISITOR_CONFLICT' };
      }

      console.error('[checkout-link] erro ao inserir bridge:', insErr.message);
      return { success: false, reason: 'INTERNAL_ERROR' };
    }

    return { success: true, status: 'linked' };
  } catch (err) {
    console.error('[checkout-link] upsert exception:', sanitizeError(err));
    return { success: false, reason: 'INTERNAL_ERROR' };
  }
}

// =============================================================================
// POST /api/nuvemshop-checkout-link
//
// Recebe beacon do m4track quando detecta URL de checkout Nuvemshop.
// Grava a associação visitor_id × checkout_id na bridge visitor_checkout_links.
//
// Fluxo:
//   1. Validar formato dos campos obrigatórios
//   2. Resolver company_id pelo tracking_code (landing_pages ativa)
//   3. Verificar feature flag (NUVEMSHOP_ATTRIBUTION_ALLOWLIST)
//      — com flag OFF: retorna FEATURE_DISABLED, nada é gravado
//   4. Validar que o visitor_id pertence ao mesmo company_id
//   5. Verificar vínculo existente (company_id, checkout_id):
//      — Inexistente → INSERT
//      — Mesmo visitor → already_linked (idempotente)
//      — Outro visitor → VISITOR_CONFLICT, não sobrescrever
//
// Segurança:
//   — tracking_code é público; não autoriza ação sem resolução do company_id
//   — visitor_id é validado por ownership real no banco
//   — company_id nunca vem do cliente
//   — Responde sempre HTTP 200 (beacon não deve falhar o checkout)
//   — service_role exclusivo para operações de banco
// =============================================================================

import { getSupabaseAdmin } from './lib/automation/supabaseAdmin.js';

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

function getAllowlist() {
  return (process.env.NUVEMSHOP_ATTRIBUTION_ALLOWLIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
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

    // Rejeitar payloads excessivos (proteção anti-abuso mínima)
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
      res.status(200).json({ success: false, reason: 'PAYLOAD_TOO_LARGE' });
      return;
    }

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

    // Resolver company_id pelo tracking_code (landing page ativa)
    const company_id = await resolveCompanyId(tracking_code);
    if (!company_id) {
      res.status(200).json({ success: false, reason: 'INVALID_TRACKING_CODE' });
      return;
    }

    // Feature flag — com flag OFF nada é gravado
    const allowlist = getAllowlist();
    if (!allowlist.includes(company_id)) {
      res.status(200).json({ success: false, reason: 'FEATURE_DISABLED' });
      return;
    }

    // Validar ownership: visitor_id deve pertencer ao mesmo company_id
    const ownershipOk = await validateVisitorOwnership(visitor_id, company_id);
    if (!ownershipOk) {
      console.warn('[checkout-link] visitor_id não pertence ao company_id', {
        checkout_id,
        company_id,
      });
      res.status(200).json({ success: false, reason: 'VISITOR_MISMATCH' });
      return;
    }

    // Gravar ou verificar vínculo existente
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
      // Possível race condition no INSERT (outro request ganhou a corrida)
      if (insErr.code === '23505') {
        // Unique violation: reler e retornar resultado correto
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

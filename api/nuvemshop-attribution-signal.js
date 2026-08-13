// =============================================================================
// POST /api/nuvemshop-attribution-signal
//
// Recebe o attribution signal do NubeSDK (Web Worker do checkout Nuvemshop).
// Resolve o visitor_id via bridge, cria conversion_signal para enriquecimento
// do lead quando customerSync/checkoutSync processar o webhook.
//
// Fluxo:
//   1. Validar store_id, checkout_id e presença de email ou phone
//   2. Verificar kill switch global (NUVEMSHOP_ATTRIBUTION_ENABLED)
//      — ausente ou diferente de 'true': FEATURE_DISABLED, nenhum signal criado
//   3. Resolver company_id via nuvemshop_connections (status='active')
//      — company_id nunca vem do cliente
//   4. Buscar visitor_id na bridge por (company_id, checkout_id)
//      — Se não encontrado: VISITOR_LINK_NOT_FOUND (sem fallback)
//   5. Resolver tracking_code via visitor → visitors → landing_pages
//      — usa first-touch do visitor para contexto de tracking correto
//   6. Criar conversion_signal via public_create_conversion_signal
//      — passa checkout_id para idempotência no RPC
//
// Efeito de public_create_conversion_signal (não passivo):
//   Ao criar o signal, o RPC tenta localizar lead recente (<2h) por email/phone
//   e, se encontrar, já atualiza visitor_id e UTMs e marca o signal como consumido.
//   Isso significa que ativar NUVEMSHOP_ATTRIBUTION_ENABLED já pode enriquecer leads.
//
// Regras críticas:
//   — NUNCA usar visitor mais recente da empresa como fallback
//   — NUNCA usar behavior_events como fallback de identidade
//   — NUNCA usar proximidade temporal como identidade
//   — company_id nunca vem do cliente (resolvido via store_id no banco)
//   — service_role exclusivo para lookup de bridge, visitor e empresa
//   — tracking_code resolvido via cadeia visitor → landing_page (determinístico)
// =============================================================================

import { getSupabaseAdmin } from './lib/automation/supabaseAdmin.js';

const MAX_PAYLOAD_BYTES = 2048;

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
}

function sanitizeError(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err.slice(0, 200);
  if (err instanceof Error) return (err.message || 'Error').slice(0, 200);
  return 'unknown';
}

/**
 * Kill switch global de attribution.
 * Somente string explícita 'true' habilita durante período de homologação.
 * Ausente → OFF. 'false' → OFF. 'true' → ON.
 * Após homologação global, pode-se decidir que ausente = ON.
 */
function isAttributionGloballyEnabled() {
  return process.env.NUVEMSHOP_ATTRIBUTION_ENABLED === 'true';
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

    // Rejeitar payloads excessivos
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
      res.status(200).json({ success: false, reason: 'PAYLOAD_TOO_LARGE' });
      return;
    }

    // store_id pode chegar como número (NubeSDK) ou string
    const store_id_raw = body.store_id;
    const store_id =
      typeof store_id_raw === 'number'
        ? store_id_raw
        : typeof store_id_raw === 'string'
        ? parseInt(store_id_raw, 10)
        : NaN;

    // checkout_id pode chegar como número (state.cart.id) ou string
    const checkout_id_raw = body.checkout_id;
    const checkout_id =
      typeof checkout_id_raw === 'number'
        ? String(checkout_id_raw)
        : typeof checkout_id_raw === 'string'
        ? checkout_id_raw.trim()
        : '';

    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 320) : null;
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 50)  : null;
    const name  = typeof body.name  === 'string' && body.name.trim()  ? body.name.trim().slice(0, 255)  : null;

    // Validações de formato
    if (!store_id || isNaN(store_id) || store_id <= 0) {
      res.status(200).json({ success: false, reason: 'INVALID_STORE_ID' });
      return;
    }

    if (!checkout_id || !/^\d+$/.test(checkout_id) || checkout_id.length > 20) {
      res.status(200).json({ success: false, reason: 'INVALID_CHECKOUT_ID' });
      return;
    }

    if (!email && !phone) {
      res.status(200).json({ success: false, reason: 'MISSING_CONTACT' });
      return;
    }

    // Kill switch global — sem DB call, avaliado antes de qualquer I/O
    if (!isAttributionGloballyEnabled()) {
      res.status(200).json({ success: false, reason: 'FEATURE_DISABLED' });
      return;
    }

    const svc = getSupabaseAdmin();

    // Resolver company_id via nuvemshop_connections (conexão ativa)
    // company_id nunca vem do request
    const { data: conn, error: connErr } = await svc
      .from('nuvemshop_connections')
      .select('company_id')
      .eq('nuvemshop_store_id', String(store_id))
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (connErr || !conn?.company_id) {
      res.status(200).json({ success: false, reason: 'STORE_NOT_FOUND' });
      return;
    }

    const company_id = conn.company_id;

    // Buscar visitor_id na bridge (correlação determinística por checkout)
    // NUNCA usar visitor mais recente, behavior_events ou proximidade temporal
    const { data: link, error: linkErr } = await svc
      .from('visitor_checkout_links')
      .select('visitor_id')
      .eq('company_id', company_id)
      .eq('checkout_id', checkout_id)
      .limit(1)
      .maybeSingle();

    if (linkErr || !link?.visitor_id) {
      console.warn('[attribution-signal] VISITOR_LINK_NOT_FOUND', { company_id, checkout_id });
      res.status(200).json({ success: false, reason: 'VISITOR_LINK_NOT_FOUND' });
      return;
    }

    const visitor_id = link.visitor_id;

    // Resolver tracking_code pelo first-touch do visitor (determinístico)
    // Cadeia: persistent visitor_id → visitors → landing_page_id → tracking_code
    // Evita ambiguidade quando empresa tem múltiplas landing_pages ativas.
    const { data: vtc, error: vtcErr } = await svc
      .from('visitors')
      .select('landing_page_id')
      .eq('visitor_id', visitor_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (vtcErr || !vtc?.landing_page_id) {
      console.error('[attribution-signal] visitor sem landing_page_id', { company_id, checkout_id });
      res.status(200).json({ success: false, reason: 'VISITOR_LANDING_NOT_FOUND' });
      return;
    }

    const { data: lp, error: lpErr } = await svc
      .from('landing_pages')
      .select('tracking_code')
      .eq('id', vtc.landing_page_id)
      .eq('company_id', company_id)
      .eq('status', 'active')
      .maybeSingle();

    if (lpErr || !lp?.tracking_code) {
      console.error('[attribution-signal] landing_page sem tracking_code ativo', { company_id, checkout_id });
      res.status(200).json({ success: false, reason: 'LANDING_PAGE_NOT_FOUND' });
      return;
    }

    // Criar conversion_signal via RPC pública (anon key)
    // Passa checkout_id para idempotência: signal duplicado retorna o existente.
    // ATENÇÃO: se lead recente (<2h) existir, o RPC já enriquece visitor_id e UTMs.
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      console.error('[attribution-signal] variáveis Supabase ausentes');
      res.status(200).json({ success: false, reason: 'INTERNAL_ERROR' });
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(supabaseUrl, supabaseKey);

    const { data: signalData, error: signalErr } = await anon.rpc('public_create_conversion_signal', {
      p_tracking_code:          lp.tracking_code,
      p_persistent_visitor_id:  visitor_id,
      p_session_id:             null,
      p_phone:                  phone,
      p_email:                  email,
      p_name:                   name,
      p_checkout_id:            checkout_id,
    });

    if (signalErr) {
      // Não logar signalErr.message diretamente — pode conter parâmetros Postgres com PII.
      console.error('[attribution-signal] RPC signal falhou', { company_id, checkout_id, code: signalErr.code });
      res.status(200).json({ success: false, reason: 'SIGNAL_FAILED' });
      return;
    }

    const signal = Array.isArray(signalData) ? signalData[0] : signalData;

    if (!signal?.success) {
      const reason = typeof signal?.error_code === 'string' && signal.error_code
        ? signal.error_code
        : 'SIGNAL_FAILED';
      res.status(200).json({ success: false, reason });
      return;
    }

    console.log('[attribution-signal] signal criado', {
      signal_id:      signal.signal_id,
      linked_lead_id: signal.linked_lead_id ?? null,
      company_id,
      checkout_id,
    });

    res.status(200).json({
      success:        true,
      signal_id:      signal.signal_id,
      linked_lead_id: signal.linked_lead_id ?? null,
    });
  } catch (err) {
    console.error('[attribution-signal] exception:', sanitizeError(err));
    // fail-open: nunca propagar erro para o NubeSDK
    res.status(200).json({ success: false, reason: 'INTERNAL_ERROR' });
  }
}

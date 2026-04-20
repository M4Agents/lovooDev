// =============================================================================
// POST /api/credit-orders/create
//
// Cria um pedido de compra de créditos avulsos de IA.
//
// BODY (JSON):
//   { "package_id": "<uuid>" }
//
// VALIDAÇÕES BACKEND:
//   1. JWT + resolveCreditsContext → effectiveCompanyId (nunca aceita do body)
//   2. package_id validado no banco (is_active AND is_available_for_sale)
//   3. Snapshots lidos do banco — nenhum valor financeiro vem do frontend
//   4. Bloqueio de duplicata: rejeita se já existir order ativa (pending_payment
//      ou checkout_created) para o mesmo company_id + package_id criada há < 30min
//
// RESPOSTA (201):
//   { "ok": true, "order_id": string, "status": "pending_payment", "checkout_url": null }
//   checkout_url será preenchido na Fase 2 (Stripe)
//
// ERRO (409):
//   { "ok": false, "code": "order_already_pending", "order_id": string }
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

const DUPLICATE_WINDOW_MINUTES = 30

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Parsear body ──────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ ok: false, error: 'Body inválido' })
  }

  const { package_id } = body

  if (!package_id || typeof package_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'package_id é obrigatório' })
  }

  // ── Parsear query params (empresa pai pode operar em nome de filha) ───────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  // ── Auth + multi-tenant ───────────────────────────────────────────────────
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId, userId } = ctx

  // ── Validar package_id no banco ───────────────────────────────────────────
  // Lê credits e price para snapshot — nunca confia em valores do frontend
  const { data: pkg, error: pkgError } = await svc
    .from('credit_packages')
    .select('id, name, credits, price')
    .eq('id', package_id)
    .eq('is_active', true)
    .eq('is_available_for_sale', true)
    .maybeSingle()

  if (pkgError) {
    return res.status(500).json({ ok: false, error: 'Erro ao validar pacote' })
  }

  if (!pkg) {
    return res.status(404).json({ ok: false, error: 'Pacote não encontrado ou indisponível para compra' })
  }

  // ── Bloqueio de duplicata ─────────────────────────────────────────────────
  // Impede múltiplos checkouts abertos para o mesmo company + package na janela de 30min
  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString()

  const { data: existing, error: dupError } = await svc
    .from('credit_orders')
    .select('id, status')
    .eq('company_id', effectiveCompanyId)
    .eq('package_id', package_id)
    .in('status', ['pending_payment', 'checkout_created'])
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (dupError) {
    return res.status(500).json({ ok: false, error: 'Erro ao verificar pedidos existentes' })
  }

  if (existing) {
    return res.status(409).json({
      ok:       false,
      code:     'order_already_pending',
      error:    `Já existe um pedido ativo para este pacote. Aguarde ${DUPLICATE_WINDOW_MINUTES} minutos ou cancele o pedido anterior.`,
      order_id: existing.id,
    })
  }

  // ── Criar order com snapshots ─────────────────────────────────────────────
  // userId já validado e disponível via resolveCreditsContext (sem chamada extra)
  const { data: order, error: insertError } = await svc
    .from('credit_orders')
    .insert({
      company_id:       effectiveCompanyId,
      package_id:       pkg.id,
      credits_snapshot: pkg.credits,
      price_snapshot:   pkg.price,
      status:           'pending_payment',
      requested_by:     userId,
      metadata:         {},
    })
    .select('id, status')
    .single()

  if (insertError) {
    return res.status(500).json({ ok: false, error: 'Erro ao criar pedido' })
  }

  // Fase 2: aqui seria chamado stripe.checkout.sessions.create() e
  // o status seria atualizado para 'checkout_created' com stripe_session_id.
  // Por ora, retorna checkout_url: null (Fase 1).

  return res.status(201).json({
    ok:           true,
    order_id:     order.id,
    status:       order.status,
    checkout_url: null,
  })
}

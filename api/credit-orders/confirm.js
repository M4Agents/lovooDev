// =============================================================================
// POST /api/credit-orders/confirm
//
// FASE 1 APENAS — Endpoint interno e temporário para confirmação de pagamento.
//
// !! ATENÇÃO !!
//   - Este endpoint NÃO deve ser exposto ao frontend
//   - Protegido por header X-Internal-Secret (env var INTERNAL_API_SECRET)
//   - Sem o header correto, retorna HTTP 401 imediatamente
//   - Na Fase 2 (Stripe), este endpoint é SUBSTITUÍDO por POST /api/webhooks/stripe
//     que recebe eventos reais e verifica stripe-signature
//
// BODY (JSON):
//   { "order_id": "<uuid>" }
//
// A RPC confirm_credit_order_payment executa atomicamente:
//   - SELECT ... FOR UPDATE (serializa concorrência)
//   - Valida status IN ('pending_payment', 'checkout_created')
//   - Valida paid_at IS NULL
//   - Incrementa extra_credits em company_credits
//   - Insere em credit_transactions (type=purchase, metadata completo)
//   - Atualiza credit_orders (status=paid, paid_at=now())
//
// RESPOSTA (200):
//   { "ok": true }
//   { "ok": true, "already_paid": true }  — idempotência: order já confirmada
//
// RESPOSTA (422):
//   { "ok": false, "code": "order_not_confirmable", "current_status": string }
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Validar header de segurança interno ──────────────────────────────────
  const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
  const receivedSecret = req.headers['x-internal-secret'] ?? ''

  if (!internalSecret || receivedSecret !== internalSecret) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' })
  }

  // ── Parsear body ──────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ ok: false, error: 'Body inválido' })
  }

  const { order_id } = body

  if (!order_id || typeof order_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'order_id é obrigatório' })
  }

  // ── Criar cliente service_role ────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!url.trim() || !key.trim()) {
    return res.status(500).json({ ok: false, error: 'Configuração de servidor incompleta' })
  }

  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Chamar RPC confirm_credit_order_payment ───────────────────────────────
  const { data, error } = await svc.rpc('confirm_credit_order_payment', {
    p_order_id: order_id,
  })

  if (error) {
    console.error('[confirm_credit_order] RPC error:', error.message)
    return res.status(500).json({ ok: false, error: 'Erro ao confirmar pedido' })
  }

  if (!data?.success) {
    if (data?.error === 'order_not_found') {
      return res.status(404).json({ ok: false, error: 'Pedido não encontrado' })
    }

    if (data?.error === 'order_not_confirmable') {
      return res.status(422).json({
        ok:             false,
        code:           'order_not_confirmable',
        error:          'Pedido não pode ser confirmado no status atual',
        current_status: data.current_status,
      })
    }

    return res.status(422).json({ ok: false, error: data?.error ?? 'Erro ao confirmar pedido' })
  }

  return res.status(200).json({
    ok:           true,
    already_paid: data.already_paid ?? false,
  })
}

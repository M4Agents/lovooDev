// =============================================================================
// POST /api/nuvemshop/coupons/create
//
// Cria um cupom de desconto na loja Nuvemshop a partir do CRM.
//
// Body esperado:
//   {
//     company_id:        string,   UUID da empresa (obrigatório)
//     store_id:          string,   ID da loja Nuvemshop (obrigatório)
//     code:              string,   Código do cupom (obrigatório)
//     type:              string,   'percentage' | 'absolute' | 'shipping'
//     value:             number,   Valor do desconto (obrigatório, positivo)
//     max_uses?:         number,   Limite de usos (null = ilimitado)
//     valid?:            boolean,  Ativo (default true)
//     start_date?:       string,   YYYY-MM-DD
//     end_date?:         string,   YYYY-MM-DD
//     min_price?:        number,   Valor mínimo do pedido
//     includes_shipping?: boolean  Desconto no frete
//   }
//
// Segurança:
//   - JWT obrigatório via Authorization: Bearer
//   - company_id validado contra membership real do usuário
//   - RBAC: apenas admin e manager podem criar cupons
//   - Nenhuma chamada direta do frontend à API Nuvemshop
//
// Erros mapeados:
//   400 → dados inválidos ou faltando
//   401 → sem autenticação ou token expirado
//   403 → sem permissão para esta operação
//   404 → conexão Nuvemshop não encontrada ou inativa
//   409 → código de cupom já existente
//   429 → rate limit da API Nuvemshop
//   502 → falha temporária na API Nuvemshop
// =============================================================================

import { getSupabaseAdmin }           from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller }    from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { createCoupon }               from '../../lib/nuvemshop/couponSync.js';

// Roles que podem criar cupons: admin e manager (não seller)
const COUPON_CREATE_ROLES = ['super_admin', 'system_admin', 'admin', 'manager'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { company_id: companyId, store_id: storeId, ...couponData } = req.body ?? {};

  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });
  if (!storeId)   return res.status(400).json({ error: 'store_id é obrigatório' });

  const svc = getSupabaseAdmin();

  // ── RBAC: validar JWT + membership + role ─────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: COUPON_CREATE_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const correlationId = `coupon-create-${companyId}-${Date.now()}`;

  // ── Delegar ao couponSync ─────────────────────────────────────────────────
  const result = await createCoupon({
    companyId,
    storeId,
    couponData,
    userId:        auth.userId,
    correlationId,
    svc,
  });

  if (!result.ok) {
    const { code, message, status, field } = result.error;
    return res.status(status ?? 500).json({ error: message, code, ...(field ? { field } : {}) });
  }

  return res.status(201).json({ coupon: result.coupon });
}

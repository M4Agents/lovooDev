// =============================================================================
// GET /api/nuvemshop/coupons/list
//
// Lista cupons ativos da loja Nuvemshop vinculada ao CRM.
//
// Query params:
//   company_id   string    UUID da empresa (obrigatório)
//   store_id     string    ID da loja Nuvemshop (obrigatório)
//   page?        number    Página (default 1)
//   per_page?    number    Itens por página (default 20, max 50)
//
// Segurança:
//   - JWT obrigatório via Authorization: Bearer
//   - company_id validado contra membership real do usuário
//   - RBAC: todos os roles que podem visualizar a integração
//   - Nenhuma chamada direta do frontend à API Nuvemshop
//
// Resposta:
//   { coupons: [...], page: number, per_page: number }
//
// Erros mapeados:
//   400 → parâmetros faltando
//   401 → sem autenticação ou token expirado
//   403 → sem permissão
//   404 → conexão Nuvemshop não encontrada ou inativa
//   429 → rate limit da API Nuvemshop
//   502 → falha temporária na API Nuvemshop
// =============================================================================

import { getSupabaseAdmin }           from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, ALLOWED_ROLES } from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { listCoupons }                from '../../lib/nuvemshop/couponSync.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const {
    company_id: companyId,
    store_id:   storeId,
    page,
    per_page:   perPage,
  } = req.query ?? {};

  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });
  if (!storeId)   return res.status(400).json({ error: 'store_id é obrigatório' });

  const svc = getSupabaseAdmin();

  // ── RBAC: validar JWT + membership + role ─────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const correlationId = `coupon-list-${companyId}-${Date.now()}`;

  // ── Delegar ao couponSync ─────────────────────────────────────────────────
  const result = await listCoupons({
    companyId,
    storeId,
    page:    page    ? Number(page)    : 1,
    perPage: perPage ? Number(perPage) : 20,
    correlationId,
    svc,
  });

  if (!result.ok) {
    const { code, message, status } = result.error;
    return res.status(status ?? 500).json({ error: message, code });
  }

  return res.status(200).json({
    coupons:  result.coupons,
    page:     result.page,
    per_page: result.perPage,
  });
}

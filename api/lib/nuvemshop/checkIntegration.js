// =============================================================================
// checkIntegration — Serviço de verificação de status da integração Nuvemshop
//
// Responsabilidade: verificar se uma empresa possui integração Nuvemshop
// ativa, histórica ou inexistente. Usado por qualquer endpoint que precise
// condicionar funcionalidades ao status da integração.
//
// ── Três estados previstos no plano v5.1 ─────────────────────────────────────
//   'none'         → Empresa nunca conectou Nuvemshop
//                    → Nenhum elemento da integração deve ser exibido
//   'active'       → Integração ativa e funcionando
//                    → Todos os elementos habilitados
//   'disconnected' → Integração desconectada (histórico preservado)
//                    → Elementos em modo somente leitura com aviso
//
// ── Uso ──────────────────────────────────────────────────────────────────────
//   import { getCompanyIntegrationStatus } from './checkIntegration.js';
//
//   const status = await getCompanyIntegrationStatus(companyId, svc);
//   if (status.state === 'none') return; // esconder elementos NS
//
// ── Segurança ────────────────────────────────────────────────────────────────
//   - company_id é obrigatório; nunca assumir acesso global
//   - svc deve ser o cliente service_role (apenas backend)
//   - Nunca expor access_token ou dados sensíveis nesta função
// =============================================================================

/**
 * @typedef {{ state: 'none'|'active'|'disconnected', hasEver: boolean, storeName: string|null, storeId: string|null }} IntegrationStatus
 */

/**
 * Retorna o status da integração Nuvemshop de uma empresa.
 *
 * Busca a conexão mais recente (por updated_at) para determinar o estado atual.
 * Usa a conexão ativa se existir; caso contrário, usa a mais recente de qualquer status.
 *
 * @param {string} companyId  UUID da empresa
 * @param {import('@supabase/supabase-js').SupabaseClient} svc  service_role client
 * @returns {Promise<IntegrationStatus>}
 */
export async function getCompanyIntegrationStatus(companyId, svc) {
  if (!companyId) {
    return { state: 'none', hasEver: false, storeName: null, storeId: null };
  }

  // Busca apenas os campos necessários para determinar o estado — nunca access_token
  const { data: connections } = await svc
    .from('nuvemshop_connections')
    .select('id, status, store_name, nuvemshop_store_id, updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (!connections?.length) {
    return { state: 'none', hasEver: false, storeName: null, storeId: null };
  }

  // Prioridade: conexão ativa
  const active = connections.find((c) => c.status === 'active');
  if (active) {
    return {
      state:     'active',
      hasEver:   true,
      storeName: active.store_name ?? null,
      storeId:   active.nuvemshop_store_id ?? null,
    };
  }

  // Sem conexão ativa mas há histórico
  const latest = connections[0];
  return {
    state:     'disconnected',
    hasEver:   true,
    storeName: latest.store_name ?? null,
    storeId:   latest.nuvemshop_store_id ?? null,
  };
}

/**
 * Verifica se uma empresa possui integração ativa.
 * Utilitário de curto-circuito para endpoints que só precisam do boolean.
 *
 * @param {string} companyId
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @returns {Promise<boolean>}
 */
export async function hasActiveNuvemshopIntegration(companyId, svc) {
  if (!companyId) return false;

  const { data } = await svc
    .from('nuvemshop_connections')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return !!data;
}

/**
 * Verifica se uma empresa já conectou Nuvemshop alguma vez (ativa OU histórica).
 * Usado para decidir se mostrar elementos de integração em listas e filtros.
 *
 * @param {string} companyId
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @returns {Promise<boolean>}
 */
export async function hasEverConnectedNuvemshop(companyId, svc) {
  if (!companyId) return false;

  const { data } = await svc
    .from('nuvemshop_connections')
    .select('id')
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();

  return !!data;
}

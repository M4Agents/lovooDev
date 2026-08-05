// =============================================================================
// categorySync — Sync Service de Categorias Nuvemshop
//
// Responsabilidade exclusiva: operações de escrita em catalog_categories.
// Não faz chamadas à API Nuvemshop (responsabilidade do Handler).
//
// ── Estratégia de identidade (Plano v5.1) ─────────────────────────────────
// Identidade determinada por: UNIQUE(company_id, nuvemshop_category_id)
//
// Política de conflito de nomes:
//   1. Upsert por (company_id, nuvemshop_category_id):
//      - Se já existe → UPDATE nome/dados (fonte autoritativa: Nuvemshop)
//      - Se não existe → INSERT
//   2. Se o INSERT conflitar com UNIQUE(company_id, type, name):
//      → INSERT com sufixo ' [NS-{id}]' para evitar colisão.
//        Log estruturado registra o caso para rastreabilidade.
//
//   ⚠ Não há associação automática entre categorias manuais e categorias
//   da Nuvemshop com base em igualdade de nome. Isso é intencional:
//   a correspondência por nome seria não-determinística e quebraria o
//   isolamento entre dados manuais e dados sincronizados.
//   A categoria Nuvemshop é sempre criada com seu próprio registro,
//   preservando o histórico do dado manual.
//
// ── Soft Delete e Reativação (Plano v5.1) ─────────────────────────────────
// NUNCA excluir fisicamente categorias que possuem histórico.
//
// Soft delete: deleted_at = now(), is_active = false, sync_status = 'deleted'
//   - UUID interno preservado
//   - Relacionamentos em products.category_id permanecem válidos
//   - Consultas de listagem ativa excluem automaticamente
//
// Reativação: quando uma categoria deletada reaparece (reconciliação / webhook):
//   - deleted_at = NULL (restaurado pelo upsert)
//   - is_active = true
//   - sync_status = 'synced'
//   - O MESMO UUID interno é reutilizado (ON CONFLICT por nuvemshop_category_id)
//   - Relacionamentos existentes (products.category_id) restaurados sem re-vinculação
//   - Todo o histórico é preservado
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';

// ── Utilitários ────────────────────────────────────────────────────────────────

/**
 * Extrai texto preferindo PT → ES → EN → primeiro disponível.
 * A API Nuvemshop retorna campos de texto como objetos multilíngues.
 */
function extractMultilingual(obj) {
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? obj : null;
  }
  return obj.pt ?? obj.es ?? obj.en
    ?? Object.values(obj).find(v => v && typeof v === 'string')
    ?? null;
}

function buildName(categoryData) {
  const raw = extractMultilingual(categoryData.name);
  return raw?.trim() || `Categoria Nuvemshop #${categoryData.id}`;
}

// ── upsertCategory ─────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza uma categoria sincronizada da Nuvemshop.
 *
 * Estratégia de conflito descrita no cabeçalho deste arquivo.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   categoryData: object,  // Objeto completo retornado pela API Nuvemshop
 *   svc?:         object   // supabaseAdmin (injetável para testes)
 * }} params
 * @returns {Promise<{
 *   ok:           boolean,
 *   categoryUuid: string,
 *   action:       'created'|'updated'|'created_with_suffix',
 *   name:         string
 * }>}
 */
export async function upsertCategory({ companyId, storeId, categoryData, svc: _svc }) {
  const svc              = _svc ?? getSupabaseAdmin();
  const nuvemshopId      = String(categoryData.id);
  const rawName          = buildName(categoryData);
  const type             = 'product';
  const now              = new Date().toISOString();
  const nsParentId       = categoryData.parent?.id ? String(categoryData.parent.id) : null;

  // ── Passo 1: Upsert autoritativo por (company_id, nuvemshop_category_id) ──
  // UPDATE se já existir (sem alterar UUID — preserva relacionamentos e histórico).
  // INSERT se não existir.
  // deleted_at = null garante reativação automática de categorias que reapareceram.
  const { data: upserted, error: upsertErr } = await svc
    .from('catalog_categories')
    .upsert(
      {
        company_id:            companyId,
        nuvemshop_category_id: nuvemshopId,
        nuvemshop_store_id:    storeId,
        nuvemshop_parent_id:   nsParentId,
        type,
        name:                  rawName,
        is_active:             true,
        sort_order:            categoryData.position ?? 0,
        nuvemshop_sync_status: 'synced',
        deleted_at:            null,
        updated_at:            now,
      },
      { onConflict: 'company_id,nuvemshop_category_id', ignoreDuplicates: false },
    )
    .select('id, created_at, updated_at')
    .single();

  if (!upsertErr) {
    const isNew = Math.abs(
      new Date(upserted.created_at).getTime() - new Date(upserted.updated_at).getTime()
    ) < 2000;

    // Resolver parent_id interno e vincular produtos órfãos em paralelo.
    await Promise.all([
      resolveParentId({ svc, companyId, categoryUuid: upserted.id, nsParentId }),
      linkOrphanProducts({ svc, companyId, nuvemshopCategoryId: nuvemshopId, categoryUuid: upserted.id }),
    ]);

    return { ok: true, categoryUuid: upserted.id, action: isNew ? 'created' : 'updated', name: rawName };
  }

  // ── Passo 2: Conflito de nome (23505) → INSERT com sufixo ─────────────────
  // Não há associação automática por nome: um registro Nuvemshop é sempre criado
  // separado de um registro manual com mesmo nome. Isso preserva o isolamento dos dados.
  if (upsertErr.code !== '23505') {
    throw new Error(`[categorySync.upsertCategory] DB error: ${upsertErr.message} (code=${upsertErr.code})`);
  }

  const nameWithSuffix = `${rawName} [NS-${nuvemshopId}]`;

  console.warn(JSON.stringify({
    level:         'warn',
    event:         'category_name_conflict_suffix_applied',
    nuvemshop_id:  nuvemshopId,
    company_id:    companyId,
    original_name: rawName,
    suffix_name:   nameWithSuffix,
    reason:        'name_already_exists_for_this_company_and_type',
  }));

  const { data: fallback, error: fallbackErr } = await svc
    .from('catalog_categories')
    .upsert(
      {
        company_id:            companyId,
        nuvemshop_category_id: nuvemshopId,
        nuvemshop_store_id:    storeId,
        nuvemshop_parent_id:   nsParentId,
        type,
        name:                  nameWithSuffix,
        is_active:             true,
        sort_order:            categoryData.position ?? 0,
        nuvemshop_sync_status: 'synced',
        deleted_at:            null,
        updated_at:            now,
      },
      { onConflict: 'company_id,nuvemshop_category_id', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (fallbackErr) {
    throw new Error(`[categorySync.upsertCategory] suffix_insert_failed: ${fallbackErr.message}`);
  }

  await Promise.all([
    resolveParentId({ svc, companyId, categoryUuid: fallback.id, nsParentId }),
    linkOrphanProducts({ svc, companyId, nuvemshopCategoryId: nuvemshopId, categoryUuid: fallback.id }),
  ]);

  return { ok: true, categoryUuid: fallback.id, action: 'created_with_suffix', name: nameWithSuffix };
}

// ── resolveParentId ───────────────────────────────────────────────────────────

/**
 * Resolve o UUID interno da categoria-pai e o salva em parent_id.
 *
 * Quando a categoria-pai ainda não foi sincronizada, o campo fica null
 * e será resolvido no próximo ciclo de sync (idempotente).
 *
 * @param {{ svc, companyId, categoryUuid: string, nsParentId: string|null }}
 */
async function resolveParentId({ svc, companyId, categoryUuid, nsParentId }) {
  if (!nsParentId) return; // categoria raiz — sem pai

  const { data: parent } = await svc
    .from('catalog_categories')
    .select('id')
    .eq('company_id', companyId)
    .eq('nuvemshop_category_id', nsParentId)
    .maybeSingle();

  if (!parent) return; // pai ainda não sincronizado — será resolvido depois

  await svc
    .from('catalog_categories')
    .update({ parent_id: parent.id, updated_at: new Date().toISOString() })
    .eq('id', categoryUuid);
}

// ── linkOrphanProducts ────────────────────────────────────────────────────────

/**
 * Após o upsert de uma categoria, vincula retroativamente produtos que:
 *   - Têm esta categoria em nuvemshop_categories (JSONB) mas category_id = null
 *
 * Cenário típico: produto chegou via webhook antes da categoria ser sincronizada.
 * O productSync salva nuvemshop_categories para exatamente este caso.
 *
 * Idempotente: só atualiza produtos que ainda não têm category_id.
 * Não sobrescreve category_id já definido (respeitando vínculo anterior).
 *
 * @param {{ svc, companyId, nuvemshopCategoryId: string, categoryUuid: string }}
 * @returns {Promise<number>} — quantidade de produtos vinculados
 */
async function linkOrphanProducts({ svc, companyId, nuvemshopCategoryId, categoryUuid }) {
  const { data, error } = await svc
    .from('products')
    .update({ category_id: categoryUuid, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('external_source', 'nuvemshop')
    .is('category_id', null)
    .contains('nuvemshop_categories', [nuvemshopCategoryId])
    .select('id');

  if (error) {
    console.warn(JSON.stringify({
      level:                  'warn',
      event:                  'category_orphan_link_failed',
      company_id:             companyId,
      nuvemshop_category_id:  nuvemshopCategoryId,
      category_uuid:          categoryUuid,
      error:                  error.message,
    }));
    return 0;
  }

  const linked = data?.length ?? 0;
  if (linked > 0) {
    console.log(JSON.stringify({
      level:                  'info',
      event:                  'category_orphan_products_linked',
      company_id:             companyId,
      nuvemshop_category_id:  nuvemshopCategoryId,
      category_uuid:          categoryUuid,
      products_linked:        linked,
    }));
  }

  return linked;
}

// ── softDeleteCategory ─────────────────────────────────────────────────────────

/**
 * Marca uma categoria como deletada (soft delete). NUNCA executa DELETE físico.
 *
 * UUID interno preservado. Relacionamentos (products.category_id) continuam
 * válidos — produtos vinculados mantêm a referência intacta e permanecem
 * disponíveis em históricos de pedidos e oportunidades.
 *
 * Idempotente: se a categoria não for encontrada, retorna ok: true, found: false.
 *
 * @param {{
 *   companyId:            string,
 *   storeId:              string,
 *   nuvemshopCategoryId:  string,
 *   svc?:                 object
 * }} params
 * @returns {Promise<{ ok: boolean, found: boolean }>}
 */
export async function softDeleteCategory({ companyId, storeId, nuvemshopCategoryId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('catalog_categories')
    .update({
      is_active:             false,
      nuvemshop_sync_status: 'deleted',
      deleted_at:            now,
      updated_at:            now,
    })
    .eq('company_id', companyId)
    .eq('nuvemshop_category_id', nuvemshopCategoryId)
    .eq('nuvemshop_store_id', storeId)
    .select('id');

  if (error) {
    throw new Error(`[categorySync.softDeleteCategory] DB error: ${error.message}`);
  }

  return { ok: true, found: (updated?.length ?? 0) > 0 };
}

// ── reactivateCategory ─────────────────────────────────────────────────────────

/**
 * Restaura uma categoria deletada que reapareceu na Nuvemshop.
 *
 * Implementado via upsertCategory: o ON CONFLICT por nuvemshop_category_id
 * atualiza o registro existente, setando deleted_at = null e is_active = true.
 * O MESMO UUID interno é reutilizado — histórico e relacionamentos preservados.
 *
 * @param {{
 *   companyId:    string,
 *   storeId:      string,
 *   categoryData: object,
 *   svc?:         object
 * }} params
 */
export async function reactivateCategory({ companyId, storeId, categoryData, svc: _svc }) {
  const result = await upsertCategory({ companyId, storeId, categoryData, svc: _svc });
  return { ...result, reactivated: true };
}

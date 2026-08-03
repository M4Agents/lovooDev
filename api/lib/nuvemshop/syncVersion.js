// =============================================================================
// syncVersion — Versões centralizadas de sincronização da integração Nuvemshop
//
// Fonte de verdade única para versões de schema e sincronização.
// Importado por qualquer worker ou serviço que precise de controle de versão.
//
// ── Regra de incremento ───────────────────────────────────────────────────────
//   CURRENT_SYNC_VERSION: incrementar quando o FORMATO do checkpoint mudar,
//     os recursos sincronizados mudarem, ou a estratégia de paginação mudar.
//     Empresas com versão anterior receberão reset automático de checkpoint
//     na próxima execução do reconcile worker.
//
//   SCHEMA_VERSION: incrementar quando houver MUDANÇA DE SCHEMA no banco
//     relevante para a reconciliação (ex: novas colunas em leads, products).
//     Permite detectar incompatibilidades entre worker e banco de dados.
//
// ── Nunca decrementar versões ─────────────────────────────────────────────────
//   Versões são monotonicamente crescentes. Retrocompatibilidade é responsabilidade
//   do novo código, não do número de versão.
//
// Uso:
//   import { CURRENT_SYNC_VERSION, SCHEMA_VERSION } from './syncVersion.js';
// =============================================================================

/** Versão do schema de reconciliação (formato de checkpoint e estratégia de sync). */
export const CURRENT_SYNC_VERSION = '1.0';

/** Versão do schema do banco de dados esperada pelo worker de reconciliação. */
export const SCHEMA_VERSION = '1';

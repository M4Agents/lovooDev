// =============================================================================
// api/lib/agents/catalogMatcher.js
//
// Identifica o produto ou serviço de interesse na mensagem do lead.
//
// RESPONSABILIDADE ÚNICA:
//   Dado o texto da mensagem e o catálogo filtrado, retornar o item mais
//   relevante (produto OU serviço) sem chamar LLM ou serviço externo.
//
// ALGORITMO (3 níveis em ordem):
//   1. Match exato      — nome do item aparece literalmente na mensagem
//   2. Match por tokens — todas as palavras-chave (≥5 chars) do nome
//                        aparecem na mensagem
//   3. Sem match        — retorna null (catálogo completo é enviado)
//
// NORMALIZAÇÃO:
//   - Lowercase
//   - Remoção de acentos (NFD + remoção de combining marks)
//
// PRIORIDADE quando múltiplos matches:
//   1. Itens com availability_status = 'available' primeiro
//   2. Menor distância (mais tokens do nome presentes)
//
// SEGURANÇA:
//   - Não acessa banco de dados
//   - Não executa código arbitrário da mensagem
//   - Multi-tenant: recebe apenas o catálogo já filtrado por company_id
// =============================================================================

// ── Normalização ──────────────────────────────────────────────────────────────

/**
 * Normaliza texto para comparação: lowercase + remove acentos + trim.
 */
function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove combining diacritical marks
    .toLowerCase()
    .trim();
}

/**
 * Extrai tokens significativos (≥5 chars) de um texto normalizado.
 * Ignora palavras muito curtas para evitar false positives.
 */
function tokenize(text) {
  return normalize(text)
    .split(/[\s\-_,./|]+/)
    .filter(t => t.length >= 5);
}

// ── Estratégias de match ──────────────────────────────────────────────────────

/**
 * Match exato: nome do item aparece inteiramente na mensagem (após normalização).
 */
function exactMatch(normalizedMessage, normalizedItemName) {
  if (!normalizedItemName) return false;
  return normalizedMessage.includes(normalizedItemName);
}

/**
 * Match por tokens: todos os tokens significativos do nome do item
 * aparecem na mensagem.
 * Retorna a quantidade de tokens correspondentes (0 = sem match).
 */
function tokenMatch(normalizedMessage, normalizedItemName) {
  const nameTokens = tokenize(normalizedItemName);
  if (nameTokens.length === 0) return 0;

  const matched = nameTokens.filter(token => normalizedMessage.includes(token));
  // Todos os tokens do nome devem estar presentes
  return matched.length === nameTokens.length ? matched.length : 0;
}

// ── Score de prioridade ───────────────────────────────────────────────────────

/**
 * Retorna score de prioridade para desempate:
 * - Itens disponíveis têm score maior
 * - Exato > Token
 */
function priorityScore(item, matchType, tokenCount) {
  const availabilityBonus = item.availability_status === 'available' ? 1000 : 0;
  const typeBonus         = matchType === 'exact' ? 500 : tokenCount * 10;
  return availabilityBonus + typeBonus;
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Identifica o item do catálogo mais relevante para a mensagem do lead.
 *
 * @param {string} message  - Texto da mensagem do lead
 * @param {{ products: object[], services: object[] }} catalog - Catálogo filtrado
 * @returns {object|null} Item de interesse (produto ou serviço) ou null
 */
export function matchCatalogItem(message, catalog) {
  if (!message || typeof message !== 'string') return null;

  const products = catalog?.products ?? [];
  const services = catalog?.services ?? [];
  const allItems = [...products, ...services];

  if (allItems.length === 0) return null;

  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return null;

  const candidates = [];

  for (const item of allItems) {
    const normalizedName = normalize(item.name);
    if (!normalizedName) continue;

    if (exactMatch(normalizedMessage, normalizedName)) {
      const score = priorityScore(item, 'exact', 0);
      candidates.push({ item, score });
      continue;
    }

    const tCount = tokenMatch(normalizedMessage, normalizedName);
    if (tCount > 0) {
      const score = priorityScore(item, 'token', tCount);
      candidates.push({ item, score });
    }
  }

  if (candidates.length === 0) return null;

  // Ordenar por score descrescente — maior score = item mais relevante
  candidates.sort((a, b) => b.score - a.score);

  return candidates[0].item;
}

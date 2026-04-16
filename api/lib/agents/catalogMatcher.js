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
//   3. Match fuzzy      — tokens do nome com distância de edição ≤ threshold
//                        (tolerância a typos e variações de grafia)
//
// DETECÇÃO DE AMBIGUIDADE:
//   Após calcular scores, todos os itens com score >= best_score * 0.7
//   são considerados candidatos relevantes. Se houver mais de 1, o resultado
//   é marcado como ambíguo (isAmbiguous = true) e o agente deve perguntar ao
//   lead qual item deseja, em vez de assumir automaticamente.
//
// RETORNO:
//   { bestMatch, topCandidates, isAmbiguous }
//   - bestMatch:      item de maior score (ou null se nenhum match)
//   - topCandidates:  todos os itens com score >= best_score * 0.7
//   - isAmbiguous:    true quando topCandidates.length > 1
//
// NORMALIZAÇÃO:
//   - Lowercase
//   - Remoção de acentos (NFD + remoção de combining marks)
//
// SEGURANÇA:
//   - Não acessa banco de dados
//   - Não executa código arbitrário da mensagem
//   - Não usa dependências externas
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

// ── Match fuzzy (Levenshtein) ─────────────────────────────────────────────────

/**
 * Distância de edição entre dois strings (algoritmo de Levenshtein).
 * Implementação pura em JS, sem dependências externas.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Otimização: array de linha única (evita matriz completa)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // inserção
        prev[j] + 1,            // remoção
        prev[j - 1] + cost      // substituição
      );
    }
    prev = curr;
  }

  return prev[b.length];
}

/**
 * Threshold de distância por tamanho do token:
 *   5–6 chars → dist ≤ 1  (ex: "solar" ≠ "solac" — apenas 1 erro tolerado)
 *   ≥7 chars  → dist ≤ 2  (ex: "eletrecista" ≈ "eletricista" — distância 2)
 */
function maxDistForToken(token) {
  return token.length <= 6 ? 1 : 2;
}

/**
 * Match fuzzy por tokens: verifica se cada token do nome do item tem um
 * token "próximo" na mensagem (distância de edição ≤ threshold).
 *
 * Threshold de correspondência mínima:
 *   1–3 tokens → 100% exigido  (Math.ceil de 70% arredonda para o total)
 *   4+ tokens  → 70% exigido   (ex: 4 tokens → threshold 3; 5 tokens → 4)
 *
 * Exemplos para item com 2 tokens ["eletricista","instalador"]:
 *   "eletricista" → 1/2 = 50% < 100% → NÃO bate
 *   "eletricista instalador" → 2/2 = 100% → bate
 *
 * Retorna { matched, total } onde matched=0 indica ausência de match.
 * Tokens que já aparecem exatamente na mensagem são aceitos sem Levenshtein.
 */
function fuzzyTokenMatch(normalizedMessage, normalizedItemName) {
  const nameTokens = tokenize(normalizedItemName);
  const total = nameTokens.length;
  if (total === 0) return { matched: 0, total: 0 };

  const msgTokens = tokenize(normalizedMessage);
  if (msgTokens.length === 0) return { matched: 0, total };

  let matched = 0;

  for (const nameToken of nameTokens) {
    // Tenta exato primeiro (sem custo de Levenshtein)
    if (normalizedMessage.includes(nameToken)) {
      matched++;
      continue;
    }

    // Fuzzy: verifica cada token da mensagem
    const maxDist = maxDistForToken(nameToken);
    const hasFuzzyMatch = msgTokens.some(
      msgToken => levenshtein(nameToken, msgToken) <= maxDist
    );

    if (hasFuzzyMatch) matched++;
  }

  // Threshold: mínimo 70% dos tokens — Math.ceil garante que para itens
  // com 1–3 tokens ainda se exige 100%, e para 4+ tokens se aceita 70%.
  const threshold = Math.max(1, Math.ceil(total * 0.7));
  return { matched: matched >= threshold ? matched : 0, total };
}

// ── Score de prioridade ───────────────────────────────────────────────────────

/**
 * Retorna score de prioridade para desempate:
 * - Itens disponíveis têm score maior
 * - Exato (500) > Token (tokenCount × 10) > Fuzzy (tokenCount × 4)
 */
function priorityScore(item, matchType, tokenCount) {
  const availabilityBonus = item.availability_status === 'available' ? 1000 : 0;
  let typeBonus;
  if (matchType === 'exact') {
    typeBonus = 500;
  } else if (matchType === 'token') {
    typeBonus = tokenCount * 10;
  } else {
    // fuzzy — score menor que token match (tokenCount × 4 < tokenCount × 10)
    typeBonus = tokenCount * 4;
  }
  return availabilityBonus + typeBonus;
}

// ── Resultado vazio ───────────────────────────────────────────────────────────

const EMPTY_RESULT = { bestMatch: null, topCandidates: [], isAmbiguous: false };

// ── Matcher relaxado para comparação ─────────────────────────────────────────

/**
 * Busca itens do catálogo que tenham ao menos 1 token significativo presente
 * na mensagem (exato ou fuzzy). Usado exclusivamente quando intenção de
 * comparação foi detectada e o matcher padrão não produziu candidatos.
 *
 * Threshold: 1 token basta — permite capturar "eletricista ou energia solar?"
 * mesmo quando nenhum nome de item aparece completo na mensagem.
 *
 * Retorna itens ordenados por tokens correspondentes (mais relevante primeiro).
 * Máximo de 2 retornados — comparação significativa apenas entre pares.
 *
 * @param {string} message
 * @param {{ products: object[], services: object[] }} catalog
 * @returns {object[]} até 2 itens de catálogo
 */
export function findComparisonItems(message, catalog) {
  if (!message || typeof message !== 'string') return [];

  const products = catalog?.products ?? [];
  const services = catalog?.services ?? [];
  const allItems = [...products, ...services];

  if (allItems.length === 0) return [];

  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return [];

  const msgTokens = tokenize(normalizedMessage);
  if (msgTokens.length === 0) return [];

  const candidates = [];

  for (const item of allItems) {
    const normalizedName = normalize(item.name);
    if (!normalizedName) continue;

    const nameTokens = tokenize(normalizedName);
    if (nameTokens.length === 0) continue;

    let matchedCount = 0;

    for (const nameToken of nameTokens) {
      if (normalizedMessage.includes(nameToken)) {
        matchedCount++;
        continue;
      }
      const maxDist = maxDistForToken(nameToken);
      if (msgTokens.some(mt => levenshtein(nameToken, mt) <= maxDist)) {
        matchedCount++;
      }
    }

    if (matchedCount >= 1) {
      const availabilityBonus = item.availability_status === 'available' ? 100 : 0;
      candidates.push({ item, score: matchedCount * 10 + availabilityBonus });
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.score - a.score);

  // Retorna no máximo 2 — comparação faz sentido apenas entre pares
  return candidates.slice(0, 2).map(c => c.item);
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Identifica o(s) item(ns) do catálogo mais relevante(s) para a mensagem do lead.
 *
 * @param {string} message  - Texto da mensagem do lead
 * @param {{ products: object[], services: object[] }} catalog - Catálogo filtrado
 * @returns {{ bestMatch: object|null, topCandidates: object[], isAmbiguous: boolean }}
 */
export function matchCatalogItem(message, catalog) {
  if (!message || typeof message !== 'string') return EMPTY_RESULT;

  const products = catalog?.products ?? [];
  const services = catalog?.services ?? [];
  const allItems = [...products, ...services];

  if (allItems.length === 0) return EMPTY_RESULT;

  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return EMPTY_RESULT;

  const candidates = [];

  for (const item of allItems) {
    const normalizedName = normalize(item.name);
    if (!normalizedName) continue;

    if (exactMatch(normalizedMessage, normalizedName)) {
      candidates.push({ item, score: priorityScore(item, 'exact', 0) });
      continue;
    }

    const tCount = tokenMatch(normalizedMessage, normalizedName);
    if (tCount > 0) {
      candidates.push({ item, score: priorityScore(item, 'token', tCount) });
      continue;
    }

    const { matched: fCount, total: fTotal } = fuzzyTokenMatch(normalizedMessage, normalizedName);
    if (fCount > 0) {
      console.log('[MATCH:fuzzy]', {
        item_name:      item.name,
        matched_tokens: fCount,
        total_tokens:   fTotal,
        ratio:          (fCount / fTotal).toFixed(2),
      });
      candidates.push({ item, score: priorityScore(item, 'fuzzy', fCount) });
    }
  }

  if (candidates.length === 0) return EMPTY_RESULT;

  // Ordenar por score descrescente — maior score = item mais relevante
  candidates.sort((a, b) => b.score - a.score);

  const bestScore = candidates[0].score;

  // Candidatos relevantes: score >= 70% do melhor score
  // Detecta itens de qualidade similar que indicam ambiguidade na mensagem.
  const topCandidates = candidates
    .filter(c => c.score >= bestScore * 0.7)
    .map(c => c.item);

  const isAmbiguous = topCandidates.length > 1;

  return { bestMatch: candidates[0].item, topCandidates, isAmbiguous };
}

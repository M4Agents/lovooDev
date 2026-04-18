/**
 * kbContentValidator.js
 *
 * Detecta conteúdo operacional indevido em knowledge_base de agentes.
 * Não bloqueia — gera score e flags para observabilidade via log.
 *
 * Uso:
 *   const result = detectOperationalContent(text);
 *   if (result.score >= OPERATIONAL_SCORE_THRESHOLD) {
 *     console.warn('[KB_VALIDATOR]', result);
 *   }
 */

// ── Padrões de detecção ───────────────────────────────────────────────────────

const PATTERNS = [
  {
    flag:  'phone',
    score: 2,
    regex: /\(\d{2}\)\s*\d{4,5}-?\d{4}|\+\d{1,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{4,5}[\s-]?\d{4}/,
  },
  {
    flag:  'email',
    score: 1,
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  },
  {
    flag:  'url',
    score: 1,
    regex: /https?:\/\/\S+|www\.[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}/,
  },
  {
    flag:  'price',
    score: 3,
    regex: /R\$\s*[\d.,]+|\$\s*[\d.,]+|\d+[.,]\d{2}\b/,
  },
  {
    flag:  'price_keyword',
    score: 2,
    regex: /\bpreço\b|\bvalor\b|\bpromoção\b|\bdesconto\b/i,
  },
  {
    flag:  'schedule',
    score: 2,
    regex: /\bhorário\b|\bfuncionamento\b|\babre\b|\bfecha\b|\bseg\.?\s*a\s*sex\b/i,
  },
  {
    flag:  'delivery',
    score: 1,
    regex: /\bentrega\b|\bprazo\b|\bfrete\b|\benviamos\b/i,
  },
]

/** Score mínimo para classificar o conteúdo como suspeito. */
export const OPERATIONAL_SCORE_THRESHOLD = 3

/**
 * Analisa `text` e retorna score acumulado + flags detectadas.
 * Função pura — sem side effects.
 *
 * @param {string} text - Conteúdo da knowledge_base (já sanitizado/trimado).
 * @returns {{ score: number, flags: string[] }}
 */
export function detectOperationalContent(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { score: 0, flags: [] }
  }

  const flags = []
  let score   = 0

  for (const { flag, score: pts, regex } of PATTERNS) {
    if (regex.test(text)) {
      flags.push(flag)
      score += pts
    }
  }

  return { score, flags }
}

// =====================================================
// Chunker de texto — documentos RAG dos Agentes Lovoo
//
// Responsabilidade: converter texto bruto em chunks
// adequados para embedding e retrieval vetorial.
//
// Estratégia (MVP):
//   - Divide por parágrafos (dupla quebra de linha)
//   - Acumula até TARGET_CHARS (≈ 500 tokens)
//   - Overlap de OVERLAP_CHARS ao iniciar próximo chunk
//   - Parágrafos maiores que TARGET_CHARS são fatiados por linha/força
//   - Sempre retorna índice correto para doc_version
//
// Formatos suportados: text/plain, text/markdown
//   (Markdown não é stripped no MVP — conteúdo é embeddado como está)
// =====================================================

// ≈ 500 tokens × 4 chars/token
const TARGET_CHARS = 2000

// ≈ 50 tokens × 4 chars/token
const OVERLAP_CHARS = 200

export type TextChunk = {
  content: string
  chunk_index: number
  metadata: Record<string, unknown>
}

/**
 * Extrai texto legível de um Buffer.
 * Para TXT e MD: decode UTF-8.
 * Normaliza finais de linha para \n.
 */
export function extractText(buffer: Buffer): string {
  return buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Divide um texto em chunks com overlap para RAG.
 *
 * Algoritmo:
 *   1. Normaliza e divide em parágrafos
 *   2. Acumula parágrafos no buffer até TARGET_CHARS
 *   3. Quando o buffer está cheio:
 *      a. Salva o chunk atual
 *      b. Inicia próximo com overlap (últimos OVERLAP_CHARS do chunk anterior)
 *   4. Parágrafos individualmente maiores que TARGET_CHARS são fatiados por linha,
 *      com fallback a fatia forçada de caracteres
 */
export function splitIntoChunks(text: string): TextChunk[] {
  const normalized = text.trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const rawChunks: string[] = []
  let buffer = ''

  for (const para of paragraphs) {
    // Parágrafo individual maior que TARGET: fatiar antes de acumular
    const parts = para.length > TARGET_CHARS ? splitLongParagraph(para) : [para]

    for (const part of parts) {
      if (!part) continue

      const candidate = buffer ? buffer + '\n\n' + part : part

      if (candidate.length <= TARGET_CHARS) {
        buffer = candidate
      } else {
        if (buffer) {
          rawChunks.push(buffer)
          const overlap = extractOverlap(buffer)
          buffer = overlap ? overlap + '\n\n' + part : part
        } else {
          // part sozinho ainda excede TARGET — fatiar
          const forced = forceSplit(part)
          rawChunks.push(...forced.slice(0, -1))
          buffer = forced[forced.length - 1] ?? ''
        }
      }
    }
  }

  if (buffer.trim()) {
    rawChunks.push(buffer.trim())
  }

  // Garante ao menos um chunk se há conteúdo
  if (rawChunks.length === 0 && normalized) {
    rawChunks.push(normalized.slice(0, TARGET_CHARS))
  }

  return rawChunks
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content, i) => ({
      content,
      chunk_index: i,
      metadata: { char_length: content.length },
    }))
}

// ── Helpers internos ──────────────────────────────────────────────────────────

/** Retorna os últimos OVERLAP_CHARS do chunk como início do próximo. */
function extractOverlap(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text
  const slice = text.slice(-OVERLAP_CHARS)
  // Preferir cortar num espaço para não quebrar palavras
  const spaceIdx = slice.indexOf(' ')
  return spaceIdx > 0 ? slice.slice(spaceIdx + 1) : slice
}

/**
 * Fatia um parágrafo longo primeiro por linhas, depois por caracteres.
 * Retorna partes de no máximo TARGET_CHARS.
 */
function splitLongParagraph(para: string): string[] {
  const lines = para.split('\n').filter(Boolean)
  const parts: string[] = []
  let acc = ''

  for (const line of lines) {
    const candidate = acc ? acc + '\n' + line : line
    if (candidate.length <= TARGET_CHARS) {
      acc = candidate
    } else {
      if (acc) parts.push(acc)
      acc = line.length > TARGET_CHARS ? '' : line
      if (line.length > TARGET_CHARS) {
        parts.push(...forceSplit(line))
      }
    }
  }

  if (acc) parts.push(acc)
  return parts.length ? parts : forceSplit(para)
}

/** Fatia forçada por tamanho fixo com overlap. */
function forceSplit(text: string): string[] {
  const parts: string[] = []
  let pos = 0
  while (pos < text.length) {
    const end = Math.min(pos + TARGET_CHARS, text.length)
    parts.push(text.slice(pos, end))
    pos = end - OVERLAP_CHARS
    if (pos <= 0 || pos >= text.length) break
  }
  return parts.filter(Boolean)
}

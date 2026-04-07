// =====================================================
// Retriever de contexto RAG — Agentes Lovoo globais
//
// Responsabilidade:
//   Dado um agente e uma query, retornar os chunks mais
//   relevantes da base de conhecimento e o contextText
//   pronto para injeção no system prompt do runner.
//
// Fluxo:
//   1. Gerar embedding da query (text-embedding-3-small)
//   2. Chamar RPC match_agent_chunks via service_role
//   3. Filtrar por min_similarity em TypeScript (não no SQL)
//   4. Montar contextText para o runner
//
// Nunca chamar do frontend.
// O runner decide quando chamar — com base em knowledge_mode.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOpenAIClient } from './../../lib/openai/client.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const DEFAULT_TOP_K         = 5
const DEFAULT_MIN_SIMILARITY = 0     // sem filtro por padrão — runner usa todos os chunks

const EMBEDDING_MODEL = 'text-embedding-3-small'

// ── Tipos públicos ────────────────────────────────────────────────────────────

/**
 * Subconjunto do agente necessário para retrieval.
 * O resolver retorna um objeto compatível; o runner passa aqui.
 */
export type RetrievableAgent = {
  id: string
  knowledge_base_config?: Record<string, unknown>
}

export type RetrievedChunk = {
  id: string
  content: string
  metadata: Record<string, unknown>
  similarity: number
}

export type RetrieveResult = {
  chunks: RetrievedChunk[]
  /**
   * Texto pronto para injeção no system prompt.
   * Formato:
   *   [Documentação relevante]
   *   ---
   *   {conteúdo do chunk}
   *   ---
   *   ...
   *   [Fim da documentação]
   *
   * Retorna string vazia se não houver chunks.
   */
  contextText: string
}

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Retriever principal ───────────────────────────────────────────────────────

/**
 * Recupera os chunks mais relevantes para a query e monta o contexto
 * pronto para injeção no system prompt do runner.
 *
 * @param agent   - Agente com id e knowledge_base_config opcional
 * @param query   - Texto da query (userMessage + extra_context do runner)
 * @returns       - chunks ordenados por similaridade + contextText montado
 */
export async function retrieveAgentContext(
  agent: RetrievableAgent,
  query: string
): Promise<RetrieveResult> {
  const empty: RetrieveResult = { chunks: [], contextText: '' }

  // ── Guardrails de entrada ─────────────────────────────────────────────────

  if (!agent.id?.trim()) {
    return empty
  }

  if (!query.trim()) {
    return empty
  }

  // ── Extrair configuração de retrieval ─────────────────────────────────────

  const config = agent.knowledge_base_config ?? {}

  const topK: number =
    typeof config.top_k === 'number' && config.top_k > 0
      ? Math.min(Math.floor(config.top_k), 20) // teto de 20 para segurança
      : DEFAULT_TOP_K

  const minSimilarity: number =
    typeof config.min_similarity === 'number' &&
    config.min_similarity >= 0 &&
    config.min_similarity <= 1
      ? config.min_similarity
      : DEFAULT_MIN_SIMILARITY

  // ── Verificar dependências ────────────────────────────────────────────────

  const openai = getOpenAIClient()
  if (!openai) return empty

  const svc = getServiceSupabase()
  if (!svc) return empty

  // ── 1. Gerar embedding da query ───────────────────────────────────────────

  let queryEmbedding: number[]
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.trim(),
    })
    queryEmbedding = response.data[0].embedding
  } catch {
    // Falha de embedding: retorna vazio — runner usará fallback
    return empty
  }

  // ── 2. Chamar RPC match_agent_chunks (service_role) ───────────────────────
  //
  // A RPC filtra internamente:
  //   - d.status = 'ready'
  //   - c.doc_version = d.version
  // Garante que apenas chunks ativos e da versão correta são retornados.

  let rawChunks: Array<{
    id: string
    content: string
    metadata: Record<string, unknown>
    similarity: number
  }> = []

  try {
    const { data, error } = await svc.rpc('match_agent_chunks', {
      p_agent_id:        agent.id,
      p_query_embedding: queryEmbedding,
      p_top_k:           topK,
    })

    if (error || !Array.isArray(data)) {
      return empty
    }

    rawChunks = data as typeof rawChunks
  } catch {
    return empty
  }

  // ── 3. Filtrar por min_similarity em TypeScript ───────────────────────────
  //
  // Por decisão arquitetural, o filtro de relevância mínima fica no código,
  // não no SQL — permite ajuste sem migration e mantém a RPC simples.

  const filtered =
    minSimilarity > 0
      ? rawChunks.filter((c) => c.similarity >= minSimilarity)
      : rawChunks

  if (filtered.length === 0) {
    return empty
  }

  // ── 4. Montar contextText ─────────────────────────────────────────────────

  const sections = filtered.map((c) => c.content.trim()).filter(Boolean)

  const contextText =
    sections.length > 0
      ? ['[Documentação relevante]', ...sections.flatMap((s) => ['---', s]), '---', '[Fim da documentação]'].join(
          '\n'
        )
      : ''

  return {
    chunks:      filtered,
    contextText,
  }
}

// ── Helpers de montagem (exportados para uso nos testes futuros) ──────────────

/**
 * Monta contextText a partir de um array de chunks já filtrados.
 * Exportado para permitir composição no runner sem chamar retrieval.
 */
export function buildContextText(chunks: RetrievedChunk[]): string {
  const sections = chunks.map((c) => c.content.trim()).filter(Boolean)
  if (sections.length === 0) return ''

  return [
    '[Documentação relevante]',
    ...sections.flatMap((s) => ['---', s]),
    '---',
    '[Fim da documentação]',
  ].join('\n')
}

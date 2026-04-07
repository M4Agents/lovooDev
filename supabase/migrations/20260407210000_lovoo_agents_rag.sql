-- =====================================================
-- Agentes Lovoo — RAG opcional por agente
--
-- Esta migration:
--   1. Habilita a extensão pgvector
--   2. Adiciona knowledge_mode em lovoo_agents
--   3. Cria lovoo_agent_documents (metadados + versionamento)
--   4. Cria lovoo_agent_chunks (conteúdo + embedding)
--   5. Cria índice HNSW vetorial
--   6. Cria RPC match_agent_chunks (server-side only)
--   7. Configura RLS
--
-- Empresa pai: dcc99d3d-9def-4b93-aeb2-1a3be5f15413
-- RAG global — sem company_id nas tabelas de RAG.
-- Compatível com futuro RAG multi-tenant via tabelas separadas.
-- =====================================================

-- ── 1. Extensão pgvector ──────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. knowledge_mode em lovoo_agents ────────────────────────────────────────
--
-- Default 'inline' preserva comportamento atual de todos os agentes existentes.
-- Sem alteração de dados, sem breaking change.

ALTER TABLE public.lovoo_agents
  ADD COLUMN IF NOT EXISTS knowledge_mode TEXT NOT NULL DEFAULT 'inline'
    CHECK (knowledge_mode IN ('none', 'inline', 'rag', 'hybrid'));

-- ── 3. Tabela lovoo_agent_documents ──────────────────────────────────────────
--
-- Metadados dos documentos do RAG global.
-- Sem company_id — escopo é o sistema Lovoo (empresa pai).
--
-- Campos de versionamento:
--   version             → versão ativa (processada com sucesso)
--   pending_version     → versão em processamento; NULL quando ocioso
--   content_hash        → SHA-256 hex — detecta conteúdo não alterado
--   processing_started_at → detectar processamento preso (> 15min → alerta UI)
--   last_processed_at   → último processamento bem-sucedido
--
-- Constraint de integridade:
--   pending_version só pode ser version + 1 — impede estados impossíveis.

CREATE TABLE public.lovoo_agent_documents (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID        NOT NULL
                                   REFERENCES public.lovoo_agents(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  storage_path         TEXT        NOT NULL,
  file_type            TEXT        NOT NULL
                                   CHECK (file_type IN ('text/plain', 'text/markdown')),
  file_size            INTEGER     NOT NULL CHECK (file_size > 0),
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'processing', 'ready', 'error')),
  error_message        TEXT,
  chunk_count          INTEGER     NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  version              INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
  pending_version      INTEGER     CHECK (pending_version IS NULL OR pending_version >= 2),
  content_hash         TEXT,
  processing_started_at TIMESTAMPTZ,
  last_processed_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_pending_version_is_next
    CHECK (pending_version IS NULL OR pending_version = version + 1)
);

-- Índice composto cobre prefixo agent_id e buscas por (agent_id, status).
-- Índice simples em agent_id seria redundante — não criado.
CREATE INDEX idx_lovoo_agent_documents_agent_status
  ON public.lovoo_agent_documents (agent_id, status);

CREATE TRIGGER update_lovoo_agent_documents_updated_at
  BEFORE UPDATE ON public.lovoo_agent_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. Tabela lovoo_agent_chunks ──────────────────────────────────────────────
--
-- Chunks com embedding inline.
-- doc_version é a chave de consistência:
--   retriever filtra chunks WHERE doc_version = document.version
--   durante reprocessamento, chunks novos têm doc_version = pending_version
--   e são invisíveis ao retriever até a promoção atômica.
--
-- CASCADE DELETE via document_id remove todos os chunks ao deletar o documento.
-- agent_id denormalizado evita join extra no hot path de retrieval.

CREATE TABLE public.lovoo_agent_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID        NOT NULL
                            REFERENCES public.lovoo_agents(id) ON DELETE CASCADE,
  document_id   UUID        NOT NULL
                            REFERENCES public.lovoo_agent_documents(id) ON DELETE CASCADE,
  doc_version   INTEGER     NOT NULL,
  chunk_index   INTEGER     NOT NULL,
  content       TEXT        NOT NULL,
  embedding     vector(1536) NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lovoo_agent_chunks_document
  ON public.lovoo_agent_chunks (document_id, doc_version);

CREATE INDEX idx_lovoo_agent_chunks_agent
  ON public.lovoo_agent_chunks (agent_id);

-- ── 5. Índice HNSW vetorial ───────────────────────────────────────────────────
--
-- HNSW escolhido sobre ivfflat:
--   - Funciona bem em qualquer volume (ivfflat precisa de massa crítica)
--   - Documentos de sistema têm volume baixo a moderado
--   - m=16, ef_construction=64: bom equilíbrio qualidade/performance para este caso

CREATE INDEX idx_lovoo_agent_chunks_embedding
  ON public.lovoo_agent_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 6. RPC match_agent_chunks ────────────────────────────────────────────────
--
-- Função de retrieval vetorial.
-- Chamada exclusivamente pelo retriever.ts server-side via service_role.
-- SECURITY DEFINER para garantir acesso às tabelas sem depender do caller.
--
-- Filtros de consistência:
--   d.status = 'ready'         → ignora documentos em processamento ou com erro
--   c.doc_version = d.version  → ignora chunks de versões antigas ou em promoção
--
-- Não usa threshold mínimo (p_min_similarity removido):
--   retorna sempre top_k para o runner decidir uso do contexto.

CREATE OR REPLACE FUNCTION public.match_agent_chunks(
  p_agent_id        UUID,
  p_query_embedding vector(1536),
  p_top_k           INTEGER DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  metadata    JSONB,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.lovoo_agent_chunks c
  JOIN public.lovoo_agent_documents d ON d.id = c.document_id
  WHERE c.agent_id    = p_agent_id
    AND d.status      = 'ready'
    AND c.doc_version = d.version
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_top_k;
$$;

-- Revogar acesso à função de todos os roles de cliente.
-- REVOKE FROM PUBLIC cobre todos, mas authenticated e anon são explícitos
-- para garantir que grants futuros automáticos do Supabase não reabram o acesso.
REVOKE ALL ON FUNCTION public.match_agent_chunks(UUID, vector(1536), INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_agent_chunks(UUID, vector(1536), INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_agent_chunks(UUID, vector(1536), INTEGER) FROM anon;

-- ── 7. RLS — lovoo_agent_documents ───────────────────────────────────────────
--
-- CRUD restrito à empresa pai (admin/super_admin).
-- Mesmo padrão de lovoo_agents — dois caminhos legado + novo.
-- Chunks NUNCA ficam visíveis a usuários autenticados via frontend.

ALTER TABLE public.lovoo_agent_documents ENABLE ROW LEVEL SECURITY;

-- Bloco reutilizável (inline): usuário é admin/super_admin da empresa pai?
-- Caminho a) company_users | Caminho b) dono legado via companies.user_id

CREATE POLICY "lovoo_agent_documents_select"
  ON public.lovoo_agent_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id             = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id        = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );

CREATE POLICY "lovoo_agent_documents_insert"
  ON public.lovoo_agent_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id             = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id        = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );

CREATE POLICY "lovoo_agent_documents_update"
  ON public.lovoo_agent_documents FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id             = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id        = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  )
  WITH CHECK (true);

CREATE POLICY "lovoo_agent_documents_delete"
  ON public.lovoo_agent_documents FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id             = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id        = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );

-- ── 8. RLS — lovoo_agent_chunks ───────────────────────────────────────────────
--
-- RLS ativo SEM nenhuma policy para autenticados.
-- Efeito: qualquer SELECT/INSERT/UPDATE/DELETE via client autenticado = negado.
-- O backend usa service_role (bypassa RLS) — único caminho de acesso legítimo.
-- Chunks e embeddings nunca chegam ao frontend.

ALTER TABLE public.lovoo_agent_chunks ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Nuvemshop Integration — Migration (Fase 3 → correção nonce)
--
-- PROBLEMA com abordagem anterior:
--   Armazenar oauth_nonce em nuvemshop_connections não garante single-use
--   na PRIMEIRA autorização (não existe registro na tabela ainda).
--
-- SOLUÇÃO: Tabela dedicada nuvemshop_oauth_states
--   1. initiate.js insere o nonce ANTES de redirecionar.
--   2. callback.js faz DELETE atômico — 0 linhas = state já consumido.
--   3. Funciona na primeira conexão e em todas as reconexões.
--   4. TTL natural: registros expirados são limpos em cada initiate.
-- =============================================================================

-- 1. Remover coluna oauth_nonce de nuvemshop_connections
--    (era armazenamento inadequado de estado transiente OAuth)
ALTER TABLE public.nuvemshop_connections
  DROP COLUMN IF EXISTS oauth_nonce;

-- 2. Criar tabela dedicada de states OAuth single-use
CREATE TABLE IF NOT EXISTS public.nuvemshop_oauth_states (
  nonce       TEXT        PRIMARY KEY,
  company_id  UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nuvemshop_oauth_states IS
  'States OAuth Nuvemshop single-use. Criado em initiate.js, consumido (DELETE) em callback.js.';

CREATE INDEX IF NOT EXISTS idx_nvoauth_company
  ON public.nuvemshop_oauth_states(company_id);

CREATE INDEX IF NOT EXISTS idx_nvoauth_expires
  ON public.nuvemshop_oauth_states(expires_at);

-- 3. RLS — sem acesso direto para usuários autenticados
--    Operações exclusivamente via service_role no backend
ALTER TABLE public.nuvemshop_oauth_states ENABLE ROW LEVEL SECURITY;

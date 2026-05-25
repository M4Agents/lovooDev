-- =============================================================================
-- Migration: instagram_data_deletion_requests
--
-- Tabela para rastrear solicitações de exclusão de dados recebidas da Meta.
-- Necessária para implementar a status page obrigatória pelo protocolo Meta.
--
-- Acesso: SOMENTE via service_role (backend).
--   - Sem policies SELECT para authenticated
--   - Status page pública lê via service_role no endpoint
--
-- Campos:
--   instagram_user_id  : ID Instagram do usuário que solicitou exclusão
--   confirmation_code  : UUID único retornado à Meta e usado na status page
--   status             : received | completed | not_found
--   affected_companies : array de company_ids afetados (pode ser vazio)
--   created_at / completed_at : ciclo de vida da solicitação
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.instagram_data_deletion_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_user_id  TEXT        NOT NULL,
  confirmation_code  TEXT        NOT NULL UNIQUE,
  status             TEXT        NOT NULL DEFAULT 'received'
                                 CHECK (status IN ('received', 'completed', 'not_found')),
  affected_companies UUID[]      NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ig_data_deletion_confirmation
  ON public.instagram_data_deletion_requests (confirmation_code);

CREATE INDEX IF NOT EXISTS idx_ig_data_deletion_user_id
  ON public.instagram_data_deletion_requests (instagram_user_id);

-- Habilitar RLS — sem policies para usuários autenticados
-- Acesso apenas via service_role (backend)
ALTER TABLE public.instagram_data_deletion_requests ENABLE ROW LEVEL SECURITY;

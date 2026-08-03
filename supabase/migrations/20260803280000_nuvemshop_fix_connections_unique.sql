-- =============================================================================
-- Nuvemshop Integration — Migration R6/6 (revisão fundação)
-- Correção: constraint UNIQUE em nuvemshop_connections
--
-- DECISÃO ARQUITETURAL:
--   A constraint inicial UNIQUE(company_id) força uma loja por empresa a nível de DB.
--   Após análise, foi adotada a seguinte estratégia:
--
--   UNIQUE(company_id, nuvemshop_store_id)
--     → Permite múltiplas lojas por empresa no futuro (schema não precisa mudar)
--     → Permite manter histórico de conexões anteriores (audit, LGPD)
--     → Desconexões ficam com status = 'disconnected' e são preservadas
--
--   + Partial unique index WHERE status = 'active'
--     → Garante que apenas UMA loja esteja ativa por empresa a qualquer momento
--     → Enforced em DB — não depende de validação em aplicação
--     → Reconectar uma loja já existente (mesmo store_id): apenas UPDATE status
--     → Conectar nova loja: exige desconectar a anterior primeiro
--
-- DIFERENÇA PRÁTICA:
--   UNIQUE(company_id):            impede historizar conexões, complica LGPD
--   UNIQUE(company_id, store_id):  permite histórico, suporta múltiplas lojas futuras
--   + índice parcial (active):     garante single-active sem perder histórico
--
-- IMPACTO:
--   Zero dados a migrar (tabela recém-criada, sem registros em produção)
-- =============================================================================

-- 1. Remover constraint original que impedía histórico
ALTER TABLE public.nuvemshop_connections
  DROP CONSTRAINT IF EXISTS uq_nuvemshop_connections_company;

-- 2. Adicionar constraint que permite histórico mas garante unicidade por loja
ALTER TABLE public.nuvemshop_connections
  ADD CONSTRAINT uq_nuvemshop_connections_company_store
    UNIQUE (company_id, nuvemshop_store_id);

-- 3. Partial unique index: apenas uma conexão ATIVA por empresa por vez
--    Impede conectar duas lojas diferentes simultaneamente.
--    Não impede manter registro de lojas anteriores desconectadas.
CREATE UNIQUE INDEX idx_nvconn_single_active_per_company
  ON public.nuvemshop_connections(company_id)
  WHERE status = 'active';

COMMENT ON CONSTRAINT uq_nuvemshop_connections_company_store
  ON public.nuvemshop_connections IS
  'Uma empresa pode ter apenas uma conexão por store_id. Histórico de conexões anteriores é preservado com status=disconnected.';

COMMENT ON INDEX idx_nvconn_single_active_per_company IS
  'Garante que apenas uma loja Nuvemshop esteja ativa por empresa. Partial index WHERE status=active.';

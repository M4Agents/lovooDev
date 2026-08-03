-- =============================================================================
-- Nuvemshop Integration — Migration R1/6 (revisão fundação)
-- Alterações estruturais: tabela leads
--
-- Adiciona campos de integração Nuvemshop ao lead.
-- Todos os campos são nullable — sem impacto em dados existentes.
-- Sem regras de negócio: apenas estrutura.
--
-- Responsabilidade de escrita: service_role (handlers das fases 8 e 10).
-- Responsabilidade de leitura: RLS existente da tabela leads.
--
-- nuvemshop_checkout_url é dado sensível de negócio:
--   - Nunca incluir em respostas de API por padrão
--   - Exibir apenas mediante ação explícita do usuário autorizado
--   - Nunca logar
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS nuvemshop_customer_id   TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_store_id       TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_checkout_id    TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_checkout_url   TEXT,
  ADD COLUMN IF NOT EXISTS nuvemshop_sync_status    TEXT;

ALTER TABLE public.leads
  ADD CONSTRAINT chk_leads_nuvemshop_sync_status
    CHECK (nuvemshop_sync_status IS NULL OR nuvemshop_sync_status IN ('synced', 'pending', 'error', 'deleted'));

-- Índices para lookups por integração
CREATE INDEX IF NOT EXISTS idx_leads_nuvemshop_customer
  ON public.leads(company_id, nuvemshop_customer_id)
  WHERE nuvemshop_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_nuvemshop_checkout
  ON public.leads(company_id, nuvemshop_checkout_id)
  WHERE nuvemshop_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_nuvemshop_sync_status
  ON public.leads(company_id, nuvemshop_sync_status)
  WHERE nuvemshop_sync_status IS NOT NULL;

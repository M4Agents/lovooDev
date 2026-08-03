-- =============================================================================
-- Nuvemshop Integration — Migration Fase 8
-- Campos de contato da Nuvemshop em leads
--
-- A tabela leads não possui campos para:
--   - document: CPF/CNPJ do cliente (campo 'identification' na API Nuvemshop)
--   - marketing_opt_in: aceite de e-mails marketing (campo 'accepts_marketing')
--
-- Ambos são nullable — sem impacto em dados existentes.
-- Responsabilidade de escrita: service_role via customerSync (Fase 8).
-- Responsabilidade de leitura: RLS existente da tabela leads.
--
-- LGPD: marketing_opt_in nunca deve ser inferred — somente persistido
-- quando retornado explicitamente pela API Nuvemshop.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS document         TEXT,
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN;

COMMENT ON COLUMN public.leads.document IS
  'Documento do cliente (CPF, CNPJ ou equivalente). '
  'Preenchido pela integração Nuvemshop com o campo identification. '
  'Não exibir em listagens por padrão — dado sensível (LGPD).';

COMMENT ON COLUMN public.leads.marketing_opt_in IS
  'Aceite de comunicações marketing pelo cliente. '
  'Preenchido pela integração Nuvemshop com accepts_marketing. '
  'NULL = não informado; true = aceitou; false = recusou. '
  'Nunca inferir — persistir apenas quando retornado explicitamente pela API.';

-- Índice para filtros de marketing (campanhas opt-in)
CREATE INDEX IF NOT EXISTS idx_leads_marketing_opt_in
  ON public.leads(company_id, marketing_opt_in)
  WHERE marketing_opt_in IS NOT NULL;

-- =============================================================================
-- NubeSDK Attribution — Bridge visitor_id × checkout_id
--
-- Objetivo: persistir a associação entre o visitor_id gerado pelo m4track
-- e o checkout_id da Nuvemshop, possibilitando que o NubeSDK resolva
-- o visitor_id de forma determinística ao emitir o attribution signal.
--
-- Acesso: exclusivo via service_role no backend.
-- Nenhuma RPC pública de escrita é criada nesta migration.
-- Nenhuma policy para anon ou authenticated.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.visitor_checkout_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  checkout_id text        NOT NULL,
  visitor_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_vcl_company_checkout
    UNIQUE (company_id, checkout_id)
);

-- Lookup inverso (visitor → checkouts) para diagnóstico e auditoria
CREATE INDEX IF NOT EXISTS idx_vcl_visitor_id
  ON public.visitor_checkout_links (visitor_id);

-- Suporte a limpeza futura por TTL (cron ou pg_cron)
CREATE INDEX IF NOT EXISTS idx_vcl_created_at
  ON public.visitor_checkout_links (created_at);

COMMENT ON TABLE public.visitor_checkout_links IS
  'Bridge determinística visitor_id × checkout_id gerada pelo m4track no checkout Nuvemshop.
   Gravada pelo backend (/api/nuvemshop-checkout-link) via service_role.
   Lida pelo backend (/api/nuvemshop-attribution-signal) para resolver visitor_id.
   Sem acesso direto para anon ou authenticated.';

-- RLS habilitado — sem policies = nenhum acesso via PostgREST
ALTER TABLE public.visitor_checkout_links ENABLE ROW LEVEL SECURITY;

-- Garantia explícita de zero acesso para roles públicas
REVOKE ALL ON TABLE public.visitor_checkout_links FROM PUBLIC;
REVOKE ALL ON TABLE public.visitor_checkout_links FROM anon;
REVOKE ALL ON TABLE public.visitor_checkout_links FROM authenticated;
GRANT ALL ON TABLE public.visitor_checkout_links TO service_role;

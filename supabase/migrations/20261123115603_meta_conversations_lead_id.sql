-- =============================================================================
-- META-L1.4B — vínculo explícito meta_conversations.lead_id
-- Timestamp: 20261123115603
-- PostgreSQL 15.8 (catálogo confirmado em META-L1.4A.2)
--
-- Aditivo. Sem UNIQUE em leads. Sem alteração de policies, grants de tabela,
-- Uazapi, Instagram ou RPC de vinculação.
-- authenticated permanece só com SELECT em meta_conversations.
--
-- Integridade de tenant:
--   A FK simples garante existência de leads.id.
--   As duas funções abaixo garantem company_id igual, sob READ COMMITTED,
--   com lock de linha no lead (não SELECT solto).
--
-- Referência de concorrência (documentação PostgreSQL 15, §13.2.1):
--   SELECT FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE, após esperar o lock,
--   reavalia a linha na versão já commitada (EvalPlanQual) e devolve essa
--   versão. DELETE concorrente faz a linha desaparecer do SELECT.
--   Cada comando SQL seguinte (incl. SPI em função VOLATILE) recebe snapshot
--   novo. Por isso o EXISTS no trigger de leads enxerga o vínculo recém
--   commitado, e o SELECT FOR NO KEY UPDATE na conversa enxerga o company_id
--   já transferido.
--   FOR KEY SHARE é insuficiente: não conflita com UPDATE de coluna não-chave
--   (company_id não faz parte de leads_pkey).
-- =============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;

-- -----------------------------------------------------------------------------
-- 1. Coluna nullable — conversas atuais permanecem sem vínculo
-- -----------------------------------------------------------------------------

ALTER TABLE public.meta_conversations
  ADD COLUMN lead_id integer NULL;

COMMENT ON COLUMN public.meta_conversations.lead_id IS
  'Lead CRM vinculado por ação explícita do operador. NULL = sem vínculo. '
  'Nunca preenchido por telefone, wa_id ou contact_name. Isolamento por '
  'company_id garantido pelos triggers trg_meta_conversations_enforce_lead_tenant '
  'e trg_leads_protect_meta_conversation_tenant.';

-- -----------------------------------------------------------------------------
-- 2. FK simples. DELETE do lead anula só lead_id (company_id da conversa fica).
--    Padrão: chat_conversations_lead_id_fkey (SET NULL), não o NO ACTION do IG.
-- -----------------------------------------------------------------------------

ALTER TABLE public.meta_conversations
  ADD CONSTRAINT meta_conversations_lead_id_fkey
  FOREIGN KEY (lead_id)
  REFERENCES public.leads(id)
  ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3. Índice parcial — lookup e EXISTS do trigger em leads
-- -----------------------------------------------------------------------------

CREATE INDEX idx_meta_conversations_company_id_lead_id
  ON public.meta_conversations (company_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Funções no schema private (não exposto ao PostgREST).
--    INVOKER na conversa: o gravador atual é service_role.
--    DEFINER na proteção do lead: o EXISTS não pode depender do RLS SELECT
--    de meta_conversations. Não devolve linhas; só recusa o UPDATE.
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.enforce_meta_conversation_lead_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog
AS $fn$
DECLARE
  v_lead_company_id uuid;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.company_id
    INTO v_lead_company_id
    FROM public.leads AS l
   WHERE l.id = NEW.lead_id
   FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Lead % inexistente para vínculo Meta', NEW.lead_id
      USING ERRCODE = '23503',
            SCHEMA  = 'public',
            TABLE   = 'meta_conversations',
            COLUMN  = 'lead_id';
  END IF;

  IF v_lead_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'Vínculo Meta recusado: lead e conversa pertencem a empresas diferentes'
      USING ERRCODE = '23514',
            SCHEMA  = 'public',
            TABLE   = 'meta_conversations',
            COLUMN  = 'lead_id';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION private.enforce_meta_conversation_lead_tenant() IS
  'BEFORE INSERT/UPDATE de meta_conversations.lead_id ou company_id. '
  'SELECT FOR NO KEY UPDATE em public.leads serializa com UPDATE/DELETE do lead. '
  'VOLATILE SECURITY INVOKER. search_path = pg_catalog.';

CREATE OR REPLACE FUNCTION private.protect_meta_conversation_lead_on_company_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.meta_conversations AS mc
     WHERE mc.lead_id = OLD.id
     LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Não é permitido alterar company_id de lead vinculado a conversa Meta'
      USING ERRCODE = '23514',
            SCHEMA  = 'public',
            TABLE   = 'leads',
            COLUMN  = 'company_id';
  END IF;

  RETURN NEW;
END;
$fn$;

ALTER FUNCTION private.protect_meta_conversation_lead_on_company_change()
  OWNER TO postgres;

COMMENT ON FUNCTION private.protect_meta_conversation_lead_on_company_change() IS
  'BEFORE UPDATE OF company_id em leads. Recusa transferência de tenant se '
  'existir meta_conversations.lead_id = leads.id. SECURITY DEFINER só para o '
  'EXISTS do vínculo; não grava conversas e não devolve dados de outro tenant.';

REVOKE ALL ON FUNCTION private.enforce_meta_conversation_lead_tenant()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_meta_conversation_lead_tenant()
  TO service_role;

REVOKE ALL ON FUNCTION private.protect_meta_conversation_lead_on_company_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.protect_meta_conversation_lead_on_company_change()
  TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Triggers. ENABLE ALWAYS: defesa contra session_replication_role = replica.
--    No primary atual o Realtime usa REPLICA IDENTITY, não replica role.
--    WHEN reduz o custo: unlink e updates irrelevantes não chamam a função.
--    O trigger em leads NÃO trava meta_conversations (evita deadlock ABBA).
--    A serialização é o lock da linha de leads, adquirido pelo vínculo.
-- -----------------------------------------------------------------------------

CREATE TRIGGER trg_meta_conversations_enforce_lead_tenant
  BEFORE INSERT OR UPDATE OF lead_id, company_id
  ON public.meta_conversations
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION private.enforce_meta_conversation_lead_tenant();

ALTER TABLE public.meta_conversations
  ENABLE ALWAYS TRIGGER trg_meta_conversations_enforce_lead_tenant;

CREATE TRIGGER trg_leads_protect_meta_conversation_tenant
  BEFORE UPDATE OF company_id
  ON public.leads
  FOR EACH ROW
  WHEN (OLD.company_id IS DISTINCT FROM NEW.company_id)
  EXECUTE FUNCTION private.protect_meta_conversation_lead_on_company_change();

ALTER TABLE public.leads
  ENABLE ALWAYS TRIGGER trg_leads_protect_meta_conversation_tenant;

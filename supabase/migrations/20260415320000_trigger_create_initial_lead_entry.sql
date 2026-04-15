-- MIGRATION: Trigger para registrar a primeira entrada do lead em lead_entries
--
-- Contexto:
--   handleLeadReentry já registra reentradas (segunda entrada em diante).
--   Este trigger registra a PRIMEIRA entrada de novos leads automaticamente,
--   cobrindo todos os pontos de entrada do sistema sem alterar endpoints individuais.
--
-- Ordem de execução dos triggers AFTER INSERT em leads (alfabética):
--   1. lead_duplicate_check       → define is_duplicate via UPDATE
--   2. webhook_trigger_on_lead_insert → dispara webhooks configurados
--   3. z_add_lead_to_funnel       → cria oportunidade no funil padrão
--   4. zz_create_initial_lead_entry (ESTE) → cria primeira lead_entry
--
-- O nome 'zz_' garante execução APÓS lead_duplicate_check ter atualizado is_duplicate.
-- A função relê is_duplicate do banco (não usa NEW) para capturar o valor já atualizado.

CREATE OR REPLACE FUNCTION create_initial_lead_entry_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_duplicate BOOLEAN;
  v_source       TEXT;
BEGIN
  -- Ler is_duplicate já atualizado pelo trigger lead_duplicate_check.
  -- NEW.is_duplicate ainda reflete o valor no momento do INSERT original,
  -- antes do UPDATE feito por lead_duplicate_check.
  SELECT is_duplicate INTO v_is_duplicate FROM leads WHERE id = NEW.id;

  IF COALESCE(v_is_duplicate, false) THEN
    -- Lead marcado como duplicata: skip.
    -- A reentrada será tratada pelo handleLeadReentry no backend.
    RETURN NEW;
  END IF;

  -- Mapeamento conservador: origin técnico → source semântico de negócio.
  -- origin_channel permanece NULL: valor técnico de leads.origin não é dado de canal/marketing.
  v_source := CASE NEW.origin
    WHEN 'webhook_ultra_simples' THEN 'webhook'
    WHEN 'whatsapp'              THEN 'whatsapp'
    WHEN 'api'                   THEN 'webhook'
    ELSE                              'manual'
  END;

  INSERT INTO lead_entries (
    company_id,
    lead_id,
    source,
    origin_channel,
    external_event_id,
    idempotency_key,
    metadata,
    created_at
  ) VALUES (
    NEW.company_id,
    NEW.id,
    v_source,
    NULL,                        -- sem dado real de canal disponível no trigger
    NULL,                        -- sem event_id externo na primeira entrada
    'init_' || NEW.id::text,    -- chave determinística e única por lead
    '{}',
    NEW.created_at               -- data real da entrada original no sistema
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Sem SQL dinâmico. Escopo estrito: SELECT em leads + INSERT em lead_entries.
-- Owner: postgres (superuser Supabase) — não delegar a role de tenant.

CREATE TRIGGER zz_create_initial_lead_entry
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION create_initial_lead_entry_fn();

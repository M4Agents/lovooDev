-- =============================================================================
-- Migration: Reconhecer origin = 'instagram' em create_initial_lead_entry_fn
--
-- Contexto:
--   A função create_initial_lead_entry_fn (trigger zz_create_initial_lead_entry)
--   usa um CASE para mapear leads.origin → lead_entries.source.
--   Sem este ajuste, leads criados com origin='instagram' caem em 'manual',
--   gerando source incorreto na primeira entrada do lead.
--
-- Alteração:
--   Adicionar WHEN 'instagram' THEN 'instagram' ao CASE existente.
--   Nenhum outro behavior é modificado.
--
-- Compatibilidade:
--   - 'webhook_ultra_simples' → 'webhook'    (preservado)
--   - 'whatsapp'              → 'whatsapp'   (preservado)
--   - 'api'                   → 'webhook'    (preservado)
--   - 'file_import'           → (cai em ELSE → 'manual') (preservado)
--   - 'manual'                → (cai em ELSE → 'manual') (preservado)
-- =============================================================================

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
  v_source := CASE NEW.origin
    WHEN 'webhook_ultra_simples' THEN 'webhook'
    WHEN 'whatsapp'              THEN 'whatsapp'
    WHEN 'api'                   THEN 'webhook'
    WHEN 'instagram'             THEN 'instagram'
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
    'init_' || NEW.id::text,     -- chave determinística e única por lead
    '{}',
    NEW.created_at               -- data real da entrada original no sistema
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Sem SQL dinâmico. Escopo estrito: SELECT em leads + INSERT em lead_entries.
-- O trigger zz_create_initial_lead_entry existente continua ativo; não precisa
-- ser recriado pois aponta para a função por nome (CREATE OR REPLACE suficiente).

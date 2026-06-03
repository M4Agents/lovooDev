-- =====================================================
-- MIGRATION: Adicionar campos de restrição WhatsApp
-- =====================================================
-- Arquivo : 20260603120000_add_restriction_fields_to_whatsapp_life_instances.sql
-- Tabela  : public.whatsapp_life_instances
-- Objetivo: Registrar restrições temporárias de envio impostas pelo WhatsApp
--           (ex: WHATSAPP_REACHOUT_TIMELOCK, error 463) detectadas via Uazapi.
--           Os campos permitem que o sistema exiba alertas na UI e evite
--           tentativas de envio desnecessárias enquanto a restrição estiver ativa.
--
-- Regras  : Apenas ADD COLUMN com colunas nullable.
--           Nenhuma coluna existente é alterada ou removida.
--           Nenhuma constraint existente é alterada.
--           Nenhuma policy ou RLS é modificada.
--           Idempotente via IF NOT EXISTS.
-- =====================================================

-- restriction_key: Identificador do tipo de restrição retornado pela Uazapi.
--   Ex: 'WHATSAPP_REACHOUT_TIMELOCK'
--   null = sem restrição ativa
ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS restriction_key TEXT NULL;

-- restriction_since: Momento em que a restrição foi detectada pela primeira vez.
--   Permite calcular há quanto tempo a conta está restrita.
ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS restriction_since TIMESTAMPTZ NULL;

-- restriction_checked_at: Última vez que o sistema verificou o estado de restrição.
--   Atualizado tanto na detecção reativa (falha de envio) quanto no polling proativo.
ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS restriction_checked_at TIMESTAMPTZ NULL;

-- restriction_payload: Payload JSON completo retornado pela Uazapi no momento da falha.
--   Preserva diagnósticos detalhados para análise futura (ex: limits, quality_rating).
ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS restriction_payload JSONB NULL;

-- =====================================================
-- COMENTÁRIOS DE COLUNA (pg_catalog)
-- =====================================================
COMMENT ON COLUMN public.whatsapp_life_instances.restriction_key IS
  'Identificador da restrição ativa retornado pela Uazapi (ex: WHATSAPP_REACHOUT_TIMELOCK). NULL quando não há restrição.';

COMMENT ON COLUMN public.whatsapp_life_instances.restriction_since IS
  'Timestamp da primeira detecção da restrição ativa. NULL quando não há restrição.';

COMMENT ON COLUMN public.whatsapp_life_instances.restriction_checked_at IS
  'Timestamp da última verificação de estado de restrição (detecção reativa ou polling proativo).';

COMMENT ON COLUMN public.whatsapp_life_instances.restriction_payload IS
  'Payload JSON completo da resposta Uazapi no momento em que a restrição foi detectada.';

-- =====================================================
-- ROLLBACK (NÃO EXECUTAR AQUI — VER ABAIXO)
-- =====================================================
-- Para reverter esta migration, executar:
--
--   ALTER TABLE public.whatsapp_life_instances
--     DROP COLUMN IF EXISTS restriction_key,
--     DROP COLUMN IF EXISTS restriction_since,
--     DROP COLUMN IF EXISTS restriction_checked_at,
--     DROP COLUMN IF EXISTS restriction_payload;
--
-- Seguro: as colunas são nullable, sem dados críticos.
-- =====================================================

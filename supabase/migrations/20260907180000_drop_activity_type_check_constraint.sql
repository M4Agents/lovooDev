-- =====================================================
-- MIGRATION: Remover CHECK constraint de activity_type
-- Data: 07/09/2026
-- Motivo: O CHECK constraint hardcoded impede o uso de tipos
--         de atividade customizados (custom_activity_types).
--         A coluna agora aceita tanto os valores legados
--         ('call', 'meeting', etc.) quanto UUIDs de tipos custom.
-- =====================================================

-- Remover constraint que limitava activity_type a 7 valores fixos
ALTER TABLE lead_activities DROP CONSTRAINT IF EXISTS valid_activity_type;

-- Expandir coluna para comportar UUIDs (36 chars) com margem
ALTER TABLE lead_activities ALTER COLUMN activity_type TYPE VARCHAR(100);

COMMENT ON COLUMN lead_activities.activity_type IS
  'ID (UUID) do tipo em custom_activity_types. Registros legados podem conter valores como ''call'', ''meeting'', etc.';

-- =====================================================
-- MIGRATION: phone_normalized em leads
-- Data: 02/04/2026
-- Objetivo: Adiciona coluna gerada phone_normalized para
--           substituir REGEXP_REPLACE inline nos JOINs da RPC,
--           tornando o JOIN entre leads ↔ chat_contacts sargable
--           (capaz de usar índice).
--
-- RISCO: ALTER TABLE com coluna GENERATED STORED adquire
--        ACCESS EXCLUSIVE LOCK durante a geração dos valores.
--        Para tabelas grandes, executar em janela de baixo uso.
--        O índice é criado com CONCURRENTLY para não bloquear
--        leituras e escritas após o ALTER.
--
-- ROLLBACK: DROP INDEX IF EXISTS idx_leads_phone_normalized_company;
--           ALTER TABLE leads DROP COLUMN IF EXISTS phone_normalized;
-- =====================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT
  GENERATED ALWAYS AS (REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_phone_normalized_company
  ON leads (phone_normalized, company_id)
  WHERE deleted_at IS NULL;

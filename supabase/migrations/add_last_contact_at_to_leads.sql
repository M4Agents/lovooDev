-- =====================================================
-- MIGRATION: Adicionar campo last_contact_at na tabela leads
-- Data: 04/03/2026
-- Objetivo: Armazenar data do último contato com o lead
-- =====================================================

-- 1. Adicionar coluna last_contact_at
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMP WITH TIME ZONE;

-- 2. Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_leads_last_contact_at 
ON leads(last_contact_at DESC);

-- 3. Popular campo com dados históricos das últimas mensagens do chat
-- Busca a última mensagem de cada lead baseado no telefone
UPDATE leads
SET last_contact_at = subquery.last_message_at
FROM (
  SELECT 
    l.id as lead_id,
    MAX(cm.created_at) as last_message_at
  FROM leads l
  INNER JOIN chat_conversations cc ON cc.contact_phone = REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')
  INNER JOIN chat_messages cm ON cm.conversation_id = cc.id
  WHERE l.phone IS NOT NULL
    AND l.phone != ''
  GROUP BY l.id
) AS subquery
WHERE leads.id = subquery.lead_id;

-- 4. Comentário na coluna
COMMENT ON COLUMN leads.last_contact_at IS 'Data e hora do último contato/mensagem com o lead (via chat)';

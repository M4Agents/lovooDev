-- Migration: Adicionar lead_id em chat_conversations
-- Data: 2026-03-10

ALTER TABLE chat_conversations 
ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_lead_id 
ON chat_conversations(lead_id, company_id);

UPDATE chat_conversations cc
SET lead_id = (
  SELECT l.id 
  FROM leads l 
  WHERE l.company_id = cc.company_id 
    AND REGEXP_REPLACE(l.phone, '\D', '', 'g') = cc.contact_phone
  LIMIT 1
)
WHERE lead_id IS NULL;

COMMENT ON COLUMN chat_conversations.lead_id IS 
'ID do lead vinculado. Adicionado em 2026-03-10.';

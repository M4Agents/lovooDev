-- Fase 1: índices de performance ausentes
-- Verificados contra estado real do banco antes da criação.
-- chat_contacts(company_id, phone_number) e leads(company_id, phone) já cobertos.

-- 1. whatsapp_life_instances: lookup por company + status (sync cron, chatApi)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wli_company_status_active
  ON public.whatsapp_life_instances (company_id, status)
  WHERE deleted_at IS NULL;

-- 2. whatsapp_life_instances: fallback lookup por phone_number (uazapi-webhook-final.js)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wli_phone_connected
  ON public.whatsapp_life_instances (phone_number)
  WHERE status = 'connected' AND deleted_at IS NULL;

-- 3. chat_messages: ordering por timestamp (LeadPanel.tsx usa timestamp, não created_at)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_conv_timestamp_asc
  ON public.chat_messages (conversation_id, "timestamp" ASC);

-- 4. chat_messages: lookup por media_url (API chat-media + BibliotecaV2)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_company_media_url
  ON public.chat_messages (company_id, media_url)
  WHERE media_url IS NOT NULL;

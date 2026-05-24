-- =============================================================================
-- Adicionar colunas de reply (quoted message) em instagram_messages
--
-- reply_to_ig_message_id : ig_message_id (Meta mid) da mensagem citada
-- reply_to_content       : snapshot do conteúdo para exibição sem join
-- reply_to_direction     : 'inbound' | 'outbound' — para colorir o bloco
-- =============================================================================

ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS reply_to_ig_message_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_content        TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_direction      TEXT;

CREATE INDEX IF NOT EXISTS idx_igmsg_reply_to
  ON public.instagram_messages(reply_to_ig_message_id)
  WHERE reply_to_ig_message_id IS NOT NULL;

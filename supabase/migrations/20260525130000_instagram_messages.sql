-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 4/8)
-- Tabela: instagram_messages
--
-- Mensagens individuais de DM do Instagram (inbound e outbound).
-- ig_message_id é UNIQUE — garante idempotência no processamento de webhook.
-- =============================================================================

CREATE TABLE public.instagram_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ig_message_id   TEXT        NOT NULL,
  direction       TEXT        NOT NULL,
  message_type    TEXT        NOT NULL DEFAULT 'text',
  content         TEXT,
  media_url       TEXT,
  sent_by         UUID        REFERENCES auth.users(id),
  status          TEXT        NOT NULL DEFAULT 'sent',
  error_code      TEXT,
  error_message   TEXT,
  retry_count     SMALLINT    NOT NULL DEFAULT 0,
  failed_at       TIMESTAMPTZ,
  timestamp       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_instagram_messages_ig_id
    UNIQUE (ig_message_id),

  CONSTRAINT chk_igmsg_direction
    CHECK (direction IN ('inbound', 'outbound')),

  CONSTRAINT chk_igmsg_type
    CHECK (message_type IN ('text', 'image', 'video', 'audio', 'storyReply', 'unsupported')),

  CONSTRAINT chk_igmsg_status
    CHECK (status IN ('sent', 'delivered', 'read', 'failed')),

  CONSTRAINT chk_igmsg_retry
    CHECK (retry_count >= 0)
);

-- Índices
CREATE INDEX idx_igmsg_company
  ON public.instagram_messages(company_id);

CREATE INDEX idx_igmsg_conv_time
  ON public.instagram_messages(conversation_id, timestamp DESC);

CREATE INDEX idx_igmsg_ig_id
  ON public.instagram_messages(ig_message_id);

CREATE INDEX idx_igmsg_status_retry
  ON public.instagram_messages(status, retry_count);

-- Trigger updated_at
CREATE TRIGGER update_instagram_messages_updated_at
  BEFORE UPDATE ON public.instagram_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "igmsg_select_member"
  ON public.instagram_messages
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE: somente service_role

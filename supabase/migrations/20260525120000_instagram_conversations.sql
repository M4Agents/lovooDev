-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 3/8)
-- Tabela: instagram_conversations
--
-- Armazena conversas (threads) de DM do Instagram.
-- IMPORTANTE: o contato Instagram NÃO é lead por padrão.
-- lead_id é nullable e preenchido apenas quando há vínculo explícito.
-- =============================================================================

CREATE TABLE public.instagram_conversations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id         UUID        NOT NULL REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
  ig_thread_id          TEXT        NOT NULL,
  ig_participant_id     TEXT        NOT NULL,
  participant_name      TEXT,
  participant_username  TEXT,
  participant_avatar    TEXT,
  lead_id               INTEGER     REFERENCES public.leads(id),
  status                TEXT        NOT NULL DEFAULT 'active',
  unread_count          INT         NOT NULL DEFAULT 0,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  assigned_to           UUID        REFERENCES auth.users(id),
  locked_by             UUID        REFERENCES auth.users(id),
  locked_at             TIMESTAMPTZ,
  lock_expires_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_instagram_conversations_thread
    UNIQUE (company_id, ig_thread_id),

  CONSTRAINT chk_igconv_status
    CHECK (status IN ('active', 'archived')),

  CONSTRAINT chk_igconv_unread
    CHECK (unread_count >= 0)
);

-- Índices
CREATE INDEX idx_igconv_company
  ON public.instagram_conversations(company_id);

CREATE INDEX idx_igconv_connection
  ON public.instagram_conversations(connection_id);

CREATE INDEX idx_igconv_company_status
  ON public.instagram_conversations(company_id, status);

CREATE INDEX idx_igconv_company_last_msg
  ON public.instagram_conversations(company_id, last_message_at DESC);

CREATE INDEX idx_igconv_thread
  ON public.instagram_conversations(ig_thread_id);

CREATE INDEX idx_igconv_participant
  ON public.instagram_conversations(ig_participant_id);

CREATE INDEX idx_igconv_lead
  ON public.instagram_conversations(lead_id);

CREATE INDEX idx_igconv_locked_by
  ON public.instagram_conversations(locked_by);

-- Trigger updated_at
CREATE TRIGGER update_instagram_conversations_updated_at
  BEFORE UPDATE ON public.instagram_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.instagram_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "igconv_select_member"
  ON public.instagram_conversations
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE: somente service_role

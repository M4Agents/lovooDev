-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 5/8)
-- Tabela: instagram_comments
--
-- Comentários em posts/mídias do Instagram.
-- IMPORTANTE: comentário NÃO cria lead automaticamente.
-- lead_id é preenchido apenas via ação explícita do usuário.
-- ig_comment_id é UNIQUE — garante idempotência no processamento.
-- =============================================================================

CREATE TABLE public.instagram_comments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id         UUID        NOT NULL REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
  ig_comment_id         TEXT        NOT NULL,
  ig_media_id           TEXT        NOT NULL,
  ig_media_type         TEXT,
  ig_user_id            TEXT        NOT NULL,
  ig_username           TEXT,
  content               TEXT        NOT NULL,
  parent_comment_id     UUID        REFERENCES public.instagram_comments(id),
  lead_id               INTEGER     REFERENCES public.leads(id),
  conversation_id       UUID        REFERENCES public.instagram_conversations(id),
  replied_at            TIMESTAMPTZ,
  replied_by            UUID        REFERENCES auth.users(id),
  reply_content         TEXT,
  private_reply_sent    BOOLEAN     NOT NULL DEFAULT false,
  status                TEXT        NOT NULL DEFAULT 'pending',
  timestamp             TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_instagram_comments_ig_id
    UNIQUE (ig_comment_id),

  CONSTRAINT chk_igcomment_status
    CHECK (status IN ('pending', 'replied', 'private_replied', 'hidden', 'ignored', 'converted_to_lead'))
);

-- Índices
CREATE INDEX idx_igcomment_company
  ON public.instagram_comments(company_id);

CREATE INDEX idx_igcomment_connection
  ON public.instagram_comments(connection_id);

CREATE INDEX idx_igcomment_company_status
  ON public.instagram_comments(company_id, status);

CREATE INDEX idx_igcomment_ig_id
  ON public.instagram_comments(ig_comment_id);

CREATE INDEX idx_igcomment_media
  ON public.instagram_comments(ig_media_id);

CREATE INDEX idx_igcomment_lead
  ON public.instagram_comments(lead_id);

CREATE INDEX idx_igcomment_conv
  ON public.instagram_comments(conversation_id);

-- Trigger updated_at
CREATE TRIGGER update_instagram_comments_updated_at
  BEFORE UPDATE ON public.instagram_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.instagram_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "igcomment_select_member"
  ON public.instagram_comments
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE: somente service_role

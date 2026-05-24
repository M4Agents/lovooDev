-- =============================================================================
-- Tabela: instagram_message_reactions
--
-- Armazena reações a mensagens Instagram, tanto enviadas pelo CRM (business)
-- quanto recebidas do participante (inbound via webhook).
--
-- source     : 'business'     — CRM reagiu via Meta API
--            : 'participant'  — participante reagiu (recebido via webhook)
-- emoji      : código Meta: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like'
-- removed_at : soft delete (NULL = ativa)
-- UNIQUE(message_id, actor_ig_id) — uma reação por ator por mensagem
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.instagram_message_reactions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID        NOT NULL REFERENCES public.instagram_messages(id) ON DELETE CASCADE,
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ig_message_id  TEXT        NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'business',
  actor_ig_id    TEXT        NOT NULL,
  user_id        UUID        REFERENCES auth.users(id),
  emoji          TEXT        NOT NULL,
  removed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_igreact_source CHECK (source IN ('business', 'participant')),
  CONSTRAINT chk_igreact_emoji  CHECK (emoji IN ('love', 'haha', 'wow', 'sad', 'angry', 'like')),
  CONSTRAINT uq_igreact_actor   UNIQUE (message_id, actor_ig_id)
);

CREATE INDEX idx_igreact_message
  ON public.instagram_message_reactions(message_id);

CREATE INDEX idx_igreact_company
  ON public.instagram_message_reactions(company_id);

-- RLS
ALTER TABLE public.instagram_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "igreact_select_member"
  ON public.instagram_message_reactions
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_member(company_id)
    OR public.auth_user_is_parent_admin(company_id)
  );

-- INSERT / UPDATE / DELETE : somente service_role

-- Realtime
ALTER TABLE public.instagram_message_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_message_reactions;

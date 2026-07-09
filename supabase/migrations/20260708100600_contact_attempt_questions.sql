-- Motor de Ciclos: tabela de perguntas e respostas de tentativas
-- Perguntas configuráveis por empresa + respostas vinculadas a cada tentativa

-- 1. Perguntas configuráveis por empresa
CREATE TABLE public.contact_attempt_questions (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL,
  field_type TEXT        NOT NULL DEFAULT 'text'
               CHECK (field_type IN ('text', 'select', 'boolean')),
  options    JSONB,
  required   BOOLEAN     NOT NULL DEFAULT false,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_company
  ON public.contact_attempt_questions (company_id, active, sort_order);

CREATE OR REPLACE FUNCTION public._trg_set_updated_at_attempt_questions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_attempt_questions_updated_at
  BEFORE UPDATE ON public.contact_attempt_questions
  FOR EACH ROW EXECUTE FUNCTION public._trg_set_updated_at_attempt_questions();

ALTER TABLE public.contact_attempt_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY questions_select ON public.contact_attempt_questions
  FOR SELECT USING (auth_user_is_company_member(company_id));

CREATE POLICY questions_insert ON public.contact_attempt_questions
  FOR INSERT WITH CHECK (auth_user_is_company_admin(company_id));

CREATE POLICY questions_update ON public.contact_attempt_questions
  FOR UPDATE USING (auth_user_is_company_admin(company_id))
  WITH CHECK (auth_user_is_company_admin(company_id));

-- 2. Respostas às perguntas, vinculadas a uma tentativa
CREATE TABLE public.contact_attempt_answers (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id  UUID        NOT NULL REFERENCES public.contact_attempts(id) ON DELETE CASCADE,
  question_id UUID        NOT NULL REFERENCES public.contact_attempt_questions(id) ON DELETE CASCADE,
  value       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_answers_attempt
  ON public.contact_attempt_answers (attempt_id);

ALTER TABLE public.contact_attempt_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY answers_select ON public.contact_attempt_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.contact_attempts ca
       WHERE ca.id = contact_attempt_answers.attempt_id
         AND auth_user_is_company_member(ca.company_id)
    )
  );

-- Motor de Ciclos: adiciona constraint UNIQUE (company_id, label) em contact_attempt_reasons
-- Garante que cada empresa não tenha motivos duplicados por nome

ALTER TABLE public.contact_attempt_reasons
  ADD CONSTRAINT uq_reason_per_company UNIQUE (company_id, label);

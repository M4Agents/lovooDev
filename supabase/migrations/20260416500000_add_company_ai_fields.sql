-- Adiciona campos de IA ao cadastro de empresas
-- Objetivo: fornecer contexto adicional ao agente conversacional e ao Prompt Builder
-- sem depender de input manual do usuário em cada conversa.
--
-- ponto_referencia:   referência de localização (ex: "próximo ao metrô Jabaquara")
-- horario_atendimento: horário de funcionamento em texto livre (ex: "Seg–Sex 8h–18h")

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ponto_referencia TEXT,
  ADD COLUMN IF NOT EXISTS horario_atendimento TEXT;

COMMENT ON COLUMN public.companies.ponto_referencia IS
  'Referência de localização da empresa para uso nos agentes de IA conversacional.';

COMMENT ON COLUMN public.companies.horario_atendimento IS
  'Horário de atendimento em texto livre para uso nos agentes de IA conversacional.
   Substitui ai_profile.business_hours como fonte preferencial.';

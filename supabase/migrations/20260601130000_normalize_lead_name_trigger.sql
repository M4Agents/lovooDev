-- =============================================================================
-- Migration: normalize_lead_name_trigger
-- Data: 2026-06-01
-- Objetivo: Padronizar leads.name com Title Case em novos INSERTs e UPDATEs.
--
-- COMPORTAMENTO DO TRIGGER:
--   - Disparado APENAS em INSERT e UPDATE OF name (coluna explícita).
--   - Não é disparado quando outras colunas de leads são atualizadas
--     (ex: status, responsible_user_id, deleted_at).
--   - Executa BEFORE → modifica NEW.name antes da gravação.
--
-- ESTRATÉGIA DE NORMALIZAÇÃO (seletiva):
--   - Aplica initcap() apenas quando:
--       (a) o valor contém ao menos uma letra [[:alpha:]]
--       E
--       (b) todas as letras estão em maiúsculas OU todas em minúsculas
--   - Preserva nomes em case misto (ex: "ABC Locação", "McDonald", "iFood")
--     para evitar degradar siglas ou formatações intencionais.
--   - Sempre aplica trim() para remover espaços nas bordas.
--   - Valores sem letras (números, símbolos) passam apenas pelo trim(),
--     sem qualquer transformação de case.
--
-- DADOS HISTÓRICOS:
--   - Esta migration NÃO altera dados existentes.
--   - A normalização histórica será feita em etapa separada, após auditoria
--     e aprovação explícita.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_normalize_lead_name ON public.leads;
--   DROP FUNCTION IF EXISTS public.normalize_lead_name();
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_lead_name()
RETURNS TRIGGER AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.name IS NULL OR trim(NEW.name) = '' THEN
    RETURN NEW;
  END IF;

  v_name := trim(NEW.name);

  IF v_name ~ '[[:alpha:]]'
     AND (v_name = upper(v_name) OR v_name = lower(v_name))
  THEN
    NEW.name := initcap(v_name);
  ELSE
    NEW.name := v_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_lead_name ON public.leads;

CREATE TRIGGER trg_normalize_lead_name
  BEFORE INSERT OR UPDATE OF name
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_lead_name();

COMMENT ON FUNCTION public.normalize_lead_name() IS
  'Normaliza leads.name para Title Case antes de INSERT ou UPDATE OF name. '
  'Aplica initcap() somente em valores inteiramente em maiúsculas ou minúsculas '
  'que contenham ao menos uma letra. Preserva case misto.';

-- =====================================================
-- MIGRATION: Stage Transition Questions (R1)
-- Data: 20/08/2026
-- Objetivo: Criar tabela de perguntas por etapa do funil
--
-- Escopo R1:
--   - Perguntas pertencem à ETAPA DESTINO
--   - Máximo de 15 perguntas ativas por etapa (validado em RPC + backend)
--   - field_type: text, number, boolean, select, multi_select
--   - SELECT/MULTI_SELECT exigem options (JSON array não vazio)
--   - Outros field_types: options deve ser NULL
--   - Imutabilidade: após existir resposta, field_type e options não podem mudar
--
-- Multi-tenant:
--   company_id é redundante por design, mas consistente com:
--   question.funnel_stage_id → funnel_stages.funnel_id → sales_funnels.company_id
--
-- Segurança:
--   - RLS habilitado
--   - Authenticated pode ler (via RLS)
--   - Escrita exclusiva via RPC/backend APIs
--   - Nunca conceder anon
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. TABELA stage_transition_questions
-- =====================================================

CREATE TABLE IF NOT EXISTS stage_transition_questions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-tenant (redundante, mas garante isolamento)
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Etapa do funil (perguntas pertencem à etapa DESTINO)
  funnel_stage_id   UUID        NOT NULL REFERENCES funnel_stages(id) ON DELETE RESTRICT,
  
  -- Configuração da pergunta
  label             TEXT        NOT NULL,
  field_type        TEXT        NOT NULL,
  options           JSONB       NULL,
  required          BOOLEAN     NOT NULL DEFAULT false,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  active            BOOLEAN     NOT NULL DEFAULT true,
  
  -- Auditoria
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT stq_valid_label CHECK (
    length(trim(label)) > 0 AND length(label) <= 150
  ),
  
  CONSTRAINT stq_valid_field_type CHECK (
    field_type IN ('text', 'number', 'boolean', 'select', 'multi_select')
  ),
  
  CONSTRAINT stq_valid_sort_order CHECK (sort_order >= 0),
  
  -- SELECT/MULTI_SELECT: options deve ser JSON array não vazio
  -- Validação estrutural básica (semântica completa em CRUD/RPC)
  CONSTRAINT stq_select_types_require_options CHECK (
    field_type NOT IN ('select', 'multi_select') OR (
      options IS NOT NULL 
      AND jsonb_typeof(options) = 'array' 
      AND jsonb_array_length(options) > 0
    )
  ),
  
  -- Outros field_types: options deve ser NULL
  CONSTRAINT stq_other_types_no_options CHECK (
    field_type IN ('select', 'multi_select') OR options IS NULL
  )
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Lookup principal: perguntas ativas de uma etapa (ordenadas)
CREATE INDEX IF NOT EXISTS idx_stq_stage_active_sort 
  ON stage_transition_questions (funnel_stage_id, sort_order) 
  WHERE active = true;

-- Lookup por empresa (admin/config)
CREATE INDEX IF NOT EXISTS idx_stq_company_created 
  ON stage_transition_questions (company_id, created_at DESC);

-- Lookup por pergunta específica
CREATE INDEX IF NOT EXISTS idx_stq_id_company 
  ON stage_transition_questions (id, company_id);

-- =====================================================
-- 3. RLS (Row Level Security)
-- =====================================================

ALTER TABLE stage_transition_questions ENABLE ROW LEVEL SECURITY;

-- Authenticated pode ler perguntas respeitando acesso ao FUNNEL
-- Deriva funnel_id via funnel_stage e valida com auth_user_can_access_funnel
-- Isso garante que seller/manager com restrição de funnel não vejam perguntas fora do escopo
-- Escrita exclusiva via RPC/backend APIs (não policy INSERT/UPDATE/DELETE aqui)
CREATE POLICY "stq_tenant_isolation_read" ON stage_transition_questions
  FOR SELECT USING (
    auth_user_can_access_funnel(
      company_id,
      (SELECT funnel_id FROM funnel_stages WHERE id = funnel_stage_id)
    )
  );

-- =====================================================
-- 4. GRANTS
-- =====================================================

-- Service_role: acesso total (usado por backend APIs)
-- Authenticated: somente SELECT (via policy acima - valida funnel access)
-- Anon: NUNCA
-- PUBLIC: revogar como hardening (tables não recebem CRUD público por padrão, mas explícito por clareza)

REVOKE ALL ON stage_transition_questions FROM PUBLIC;
GRANT SELECT ON stage_transition_questions TO authenticated;

-- =====================================================
-- 5. COMMENTS
-- =====================================================

COMMENT ON TABLE stage_transition_questions IS 
  'R1: Perguntas de transição por etapa do funil. '
  'Pertencem à ETAPA DESTINO. Máximo de 15 ativas por etapa. '
  'field_type imutável após existir resposta. '
  'SELECT/MULTI_SELECT exigem options (array JSON não vazio).';

COMMENT ON COLUMN stage_transition_questions.company_id IS 
  'Redundante por design - garante isolamento multi-tenant. '
  'Deve ser consistente com funnel_stages.funnel_id → sales_funnels.company_id.';

COMMENT ON COLUMN stage_transition_questions.funnel_stage_id IS 
  'Etapa do funil à qual a pergunta pertence (ETAPA DESTINO). '
  'ON DELETE RESTRICT: nunca apagar stage com perguntas (integridade histórica).';

COMMENT ON COLUMN stage_transition_questions.field_type IS 
  'Tipo da pergunta: text, number, boolean, select, multi_select. '
  'IMUTÁVEL após existir resposta (validado em RPC + backend).';

COMMENT ON COLUMN stage_transition_questions.options IS 
  'JSON array de opções para field_type IN (select, multi_select). '
  'Obrigatório e não vazio para select/multi_select. NULL para outros tipos. '
  'Validação estrutural (DB) + semântica completa (CRUD/RPC): strings não vazias, sem duplicatas. '
  'IMUTÁVEL após existir resposta (validado em RPC + backend).';

COMMENT ON COLUMN stage_transition_questions.required IS 
  'Se true, pergunta é hard block - movimento não pode ocorrer sem resposta.';

COMMENT ON COLUMN stage_transition_questions.sort_order IS 
  'Ordem de exibição no modal (0, 1, 2, ...). >= 0.';

COMMENT ON COLUMN stage_transition_questions.active IS 
  'Perguntas inativas não aparecem no modal, mas histórico permanece. '
  'Máximo de 15 ativas por etapa (validado em RPC).';

-- =====================================================
-- 6. INTEGRIDADE MULTI-TENANT (company_id redundante)
-- =====================================================

-- Garantir que company_id da question seja consistente com o 
-- company_id do funnel da etapa (caminho: funnel_stage → funnel → company)
CREATE OR REPLACE FUNCTION check_stage_transition_question_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_funnel_company_id UUID;
BEGIN
  -- Obter company_id do funnel da etapa
  SELECT sf.company_id INTO v_funnel_company_id
    FROM funnel_stages fs
    JOIN sales_funnels sf ON sf.id = fs.funnel_id
   WHERE fs.id = NEW.funnel_stage_id;
  
  IF v_funnel_company_id IS NULL THEN
    RAISE EXCEPTION 'stage_transition_questions: funnel_stage_id % invalido ou nao encontrado', 
      NEW.funnel_stage_id;
  END IF;
  
  IF NEW.company_id != v_funnel_company_id THEN
    RAISE EXCEPTION 'stage_transition_questions: company_id % inconsistente com funnel company_id % (cross-tenant)', 
      NEW.company_id, v_funnel_company_id;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_stage_transition_question_tenant
  BEFORE INSERT OR UPDATE ON stage_transition_questions
  FOR EACH ROW EXECUTE FUNCTION check_stage_transition_question_tenant();

-- Hardening: revogar EXECUTE público da trigger function
-- (PostgreSQL concede EXECUTE a PUBLIC por padrão para todas as functions)
REVOKE ALL ON FUNCTION check_stage_transition_question_tenant() FROM PUBLIC;

COMMENT ON FUNCTION check_stage_transition_question_tenant() IS
  'Trigger: garante que company_id da pergunta seja consistente com o company_id do funnel da etapa. '
  'Impede inserção cross-tenant via bug backend.';

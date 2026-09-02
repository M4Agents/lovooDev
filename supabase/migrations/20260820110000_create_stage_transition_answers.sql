-- =====================================================
-- MIGRATION: Stage Transition Answers (R1)
-- Data: 20/08/2026
-- Objetivo: Criar tabela de respostas de perguntas por transição
--
-- Escopo R1:
--   - Respostas vinculadas a opportunity_stage_history
--   - question_label_snapshot preserva histórico se label mudar
--   - value TEXT - sempre trim não vazio quando item presente
--   - Perguntas optional sem resposta NÃO geram linha
--   - UNIQUE(stage_history_id, question_id)
--
-- Multi-tenant:
--   company_id para isolamento e índices
--
-- Segurança:
--   - RLS habilitado
--   - Authenticated pode ler histórico (via RLS)
--   - Escrita exclusiva via RPC move_opportunity
--   - Nunca conceder anon
--   - FK question_id: ON DELETE RESTRICT (nunca apagar histórico)
-- =====================================================

SET search_path = public;

-- =====================================================
-- 1. TABELA stage_transition_answers
-- =====================================================

CREATE TABLE IF NOT EXISTS stage_transition_answers (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-tenant
  company_id              UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Vinculação com oportunidade e histórico
  opportunity_id          UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  stage_history_id        UUID        NOT NULL REFERENCES opportunity_stage_history(id) ON DELETE CASCADE,
  
  -- Pergunta respondida (nunca apagar histórico)
  question_id             UUID        NOT NULL REFERENCES stage_transition_questions(id) ON DELETE RESTRICT,
  
  -- Snapshot do label da pergunta (preserva histórico se label mudar)
  question_label_snapshot TEXT        NOT NULL,
  
  -- Resposta (sempre trim não vazio)
  value                   TEXT        NOT NULL,
  
  -- Auditoria
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT sta_valid_value CHECK (length(trim(value)) > 0),
  
  -- Uma resposta por pergunta por transição
  CONSTRAINT sta_unique_history_question UNIQUE (stage_history_id, question_id)
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Lookup principal: respostas de uma transição específica
CREATE INDEX IF NOT EXISTS idx_sta_stage_history 
  ON stage_transition_answers (stage_history_id);

-- Timeline de respostas por oportunidade (relatórios)
CREATE INDEX IF NOT EXISTS idx_sta_opportunity_created 
  ON stage_transition_answers (opportunity_id, created_at DESC);

-- Dashboards/relatórios por empresa
CREATE INDEX IF NOT EXISTS idx_sta_company_created 
  ON stage_transition_answers (company_id, created_at DESC);

-- Análise por pergunta (métricas, distribuição de respostas)
CREATE INDEX IF NOT EXISTS idx_sta_question_created 
  ON stage_transition_answers (question_id, created_at DESC);

-- =====================================================
-- 3. RLS (Row Level Security)
-- =====================================================

ALTER TABLE stage_transition_answers ENABLE ROW LEVEL SECURITY;

-- Authenticated pode ler respostas respeitando acesso ao FUNNEL HISTÓRICO
-- Deriva funnel_id via opportunity_stage_history (histórico) para não depender da posição atual
-- Se oportunidade mudar de funnel posteriormente, resposta histórica mantém autorização correta
-- Escrita exclusiva via RPC move_opportunity (não policy INSERT aqui)
CREATE POLICY "sta_tenant_isolation_read" ON stage_transition_answers
  FOR SELECT USING (
    auth_user_can_access_funnel(
      company_id,
      (SELECT funnel_id FROM opportunity_stage_history WHERE id = stage_history_id)
    )
  );

-- =====================================================
-- 4. GRANTS
-- =====================================================

-- Service_role: acesso total (usado por move_opportunity RPC)
-- Authenticated: NENHUM na R1 (princípio de menor privilégio)
--   - R1 não possui frontend/API que consulte answers diretamente
--   - Histórico/relatórios futuro adicionarão SELECT quando necessário
--   - Escrita exclusiva via move_opportunity RPC
-- Anon: NUNCA
-- PUBLIC: revogar como hardening

-- Remover privilégios herdados de DEFAULT PRIVILEGES
REVOKE ALL ON stage_transition_answers FROM PUBLIC;
REVOKE ALL ON stage_transition_answers FROM anon;
REVOKE ALL ON stage_transition_answers FROM authenticated;

-- Garantir acesso backend (explícito por clareza)
GRANT ALL ON stage_transition_answers TO service_role;
GRANT ALL ON stage_transition_answers TO postgres;

-- NOTA: GRANT SELECT será adicionado em release futura quando histórico/reports necessitarem

-- =====================================================
-- 5. COMMENTS
-- =====================================================

COMMENT ON TABLE stage_transition_answers IS 
  'R1: Respostas de perguntas de transição entre etapas. '
  'Vinculadas a opportunity_stage_history. '
  'question_label_snapshot preserva histórico. '
  'value sempre trim não vazio quando item presente. '
  'multi_select armazenado como JSON array serializado em TEXT (canonizado conforme options). '
  'Perguntas optional sem resposta NÃO geram linha. '
  'ACL: anon=NONE, authenticated=NONE (R1), service_role=ALL.';

COMMENT ON COLUMN stage_transition_answers.stage_history_id IS 
  'FK para opportunity_stage_history. '
  'Vincula resposta à transição específica. '
  'ON DELETE CASCADE: se history apagado, respostas vão junto.';

COMMENT ON COLUMN stage_transition_answers.question_id IS 
  'FK para stage_transition_questions. '
  'ON DELETE RESTRICT: NUNCA apagar pergunta com histórico de respostas. '
  'Garante integridade histórica.';

COMMENT ON COLUMN stage_transition_answers.question_label_snapshot IS 
  'Snapshot do label da pergunta no momento da resposta. '
  'Preserva histórico se admin alterar label da pergunta depois.';

COMMENT ON COLUMN stage_transition_answers.value IS 
  'Resposta armazenada como TEXT. Sempre trim não vazio (CHECK). '
  'Formato por tipo: '
  '  text: string simples '
  '  number: decimal canônico com ponto (ex: "1500.50") '
  '  boolean: "true" ou "false" (lowercase) '
  '  select: opção selecionada (string) '
  '  multi_select: JSON array serializado canônico (ex: ''["Produto A","Produto C"]'') - ordem conforme question.options';

COMMENT ON CONSTRAINT sta_unique_history_question ON stage_transition_answers IS 
  'Uma resposta por pergunta por transição. '
  'Garante que não há duplicatas na mesma movimentação.';

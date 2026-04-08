-- =====================================================
-- MIGRATION: Notas Internas do CRM
-- Data: 23/04/2026
-- Objetivo:
--   1. Criar tabela internal_notes
--   2. Constraints de integridade (vínculo exclusivo e content válido)
--   3. Índices parciais (WHERE deleted_at IS NULL) para queries de notas ativas
--   4. Trigger de validação cross-tenant (INSERT e UPDATE)
--   5. Trigger de proteção de campos imutáveis + bloqueio de edição de content por não-autor (UPDATE)
--   6. Trigger de updated_at automático (UPDATE)
--   7. RLS: SELECT, INSERT, UPDATE (sem política DELETE física)
--
-- Decisões arquiteturais documentadas:
--   - Vínculo exclusivo (lead XOR oportunidade) garantido por CHECK constraint no banco
--   - Consistência cross-tenant (company_id da nota = company_id da entidade) garantida por trigger
--   - Campos imutáveis protegidos por trigger (RLS não controla colunas individuais do UPDATE)
--   - Soft delete: deleted_at setado via UPDATE; a policy SELECT já exclui deleted_at IS NOT NULL
--   - Sem policy DELETE física: a exclusão lógica via UPDATE é o único caminho suportado
--   - is_active omitido da RLS para manter consistência com o padrão do sistema (opportunities, sales_funnels)
--   - auth.uid() nas funções trigger captura o usuário autenticado da sessão (comportamento padrão Supabase)
--   - updated_by sempre atualizado pelo trigger em qualquer UPDATE bem-sucedido (inclui soft delete)
-- =====================================================


-- =====================================================
-- 1. TABELA internal_notes
-- =====================================================

CREATE TABLE IF NOT EXISTS internal_notes (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant (obrigatório, imutável após criação)
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Contexto exclusivo: OU lead OU oportunidade, nunca os dois, nunca nenhum
  -- Ambos são imutáveis após criação (protegidos por trigger)
  lead_id          INTEGER      REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id   UUID         REFERENCES opportunities(id) ON DELETE CASCADE,

  -- Conteúdo da nota
  content          TEXT         NOT NULL CHECK (trim(content) <> ''),

  -- Rastreabilidade de autoria (imutáveis após criação, exceto updated_by)
  -- DEFAULT auth.uid() reduz dependência do cliente no INSERT; RLS ainda valida created_by = auth.uid()
  created_by       UUID         NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  updated_by       UUID         REFERENCES auth.users(id),

  -- Timestamps
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Soft delete: null = ativa, preenchido = excluída logicamente
  -- Nunca remover fisicamente — apenas setar deleted_at via UPDATE
  deleted_at       TIMESTAMPTZ,

  -- Garantia de banco: exatamente um contexto por nota
  -- lead_id XOR opportunity_id — nunca nenhum, nunca os dois
  CONSTRAINT chk_intnotes_exactly_one_context CHECK (
    (lead_id IS NOT NULL)::int + (opportunity_id IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE internal_notes IS
  'Notas internas do CRM. Cada nota pertence exclusivamente a um lead ou a uma oportunidade. '
  'Nunca global. Sempre multi-tenant via company_id. '
  'Exclusão lógica via deleted_at — sem DELETE físico permitido.';

COMMENT ON COLUMN internal_notes.lead_id IS
  'FK para leads. Mutuamente exclusivo com opportunity_id (CHECK constraint).';

COMMENT ON COLUMN internal_notes.opportunity_id IS
  'FK para opportunities. Mutuamente exclusivo com lead_id (CHECK constraint).';

COMMENT ON COLUMN internal_notes.deleted_at IS
  'Soft delete. Null = ativa. Notas com deleted_at != NULL são invisíveis via RLS SELECT. '
  'Apenas o autor ou admin da empresa pode setar este campo via UPDATE.';

COMMENT ON COLUMN internal_notes.updated_by IS
  'Quem executou o último UPDATE (conteúdo ou soft delete). '
  'Setado automaticamente pelo trigger trg_intnotes_protect antes do commit.';


-- =====================================================
-- 2. ÍNDICES
--
-- Estratégia: índices parciais com WHERE deleted_at IS NULL.
-- Queries de produção sempre filtram notas ativas.
-- Notas soft-deletadas não participam dos índices — menor footprint,
-- melhor performance de leitura.
-- =====================================================

-- Query principal: notas ativas de um lead ordenadas por recência
CREATE INDEX IF NOT EXISTS idx_intnotes_lead_active
  ON internal_notes (company_id, lead_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Query principal: notas ativas de uma oportunidade ordenadas por recência
CREATE INDEX IF NOT EXISTS idx_intnotes_opportunity_active
  ON internal_notes (company_id, opportunity_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Queries por autor (filtros futuros, ex: "minhas notas")
CREATE INDEX IF NOT EXISTS idx_intnotes_created_by_active
  ON internal_notes (created_by, created_at DESC)
  WHERE deleted_at IS NULL;


-- =====================================================
-- 3. FUNÇÃO: validate_internal_note_tenant
--
-- Propósito: garantir que lead_id ou opportunity_id referenciados
-- pertencem ao mesmo company_id da nota.
--
-- Sem esta validação, seria possível inserir uma nota com:
--   company_id = empresa A
--   lead_id    = lead da empresa B
-- A CHECK constraint não impede isso — só o trigger impede.
--
-- Dispara: BEFORE INSERT OR UPDATE em internal_notes.
-- Usa SECURITY DEFINER para acessar leads e opportunities
-- sem depender do contexto RLS do usuário (proteção consistente).
-- =====================================================

CREATE OR REPLACE FUNCTION validate_internal_note_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar que o lead pertence à mesma empresa da nota
  IF NEW.lead_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM leads
       WHERE id = NEW.lead_id
         AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION
        'internal_notes: lead_id=% não pertence à empresa company_id=%. Operação bloqueada.',
        NEW.lead_id, NEW.company_id;
    END IF;
  END IF;

  -- Validar que a oportunidade pertence à mesma empresa da nota
  IF NEW.opportunity_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM opportunities
       WHERE id = NEW.opportunity_id
         AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION
        'internal_notes: opportunity_id=% não pertence à empresa company_id=%. Operação bloqueada.',
        NEW.opportunity_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intnotes_tenant ON internal_notes;

CREATE TRIGGER trg_intnotes_tenant
  BEFORE INSERT OR UPDATE ON internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION validate_internal_note_tenant();


-- =====================================================
-- 4. FUNÇÃO: protect_internal_note_immutable_fields
--
-- Propósito duplo:
--
-- A) Proteger campos imutáveis após criação:
--    company_id, lead_id, opportunity_id, created_by, created_at
--    Nenhum UPDATE pode alterar esses campos, independente de quem executa.
--    Isso impede:
--      - migrar nota de lead para oportunidade
--      - trocar empresa da nota
--      - falsificar autoria original
--
-- B) Bloquear edição de `content` por quem não é o autor:
--    A policy UPDATE permite admin fazer UPDATE (para soft delete).
--    Sem este bloqueio, admin poderia alterar o texto da nota de outro usuário.
--    O trigger verifica: se content mudou e auth.uid() != OLD.created_by → RAISE EXCEPTION.
--
-- C) Preencher updated_by automaticamente:
--    Registra quem executou o UPDATE (edição ou soft delete).
--    Não confiamos no frontend para enviar este campo.
--
-- Dispara: BEFORE UPDATE em internal_notes.
-- Dispara ANTES de trg_intnotes_tenant (ordem alfabética: "protect" < "tenant").
-- Sem SECURITY DEFINER: a função só opera sobre OLD/NEW, sem acesso a tabelas externas.
-- auth.uid() lê current_setting('request.jwt.claims') — disponível em contexto INVOKER.
-- Padrão do projeto: trg_prevent_opportunity_currency_change segue o mesmo padrão.
-- =====================================================

CREATE OR REPLACE FUNCTION protect_internal_note_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- ── A) Campos imutáveis após criação ─────────────────────────────────────

  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION
      'internal_notes: company_id é imutável após criação. Operação bloqueada.';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    RAISE EXCEPTION
      'internal_notes: lead_id é imutável após criação. '
      'Não é possível migrar uma nota entre entidades. Operação bloqueada.';
  END IF;

  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
    RAISE EXCEPTION
      'internal_notes: opportunity_id é imutável após criação. '
      'Não é possível migrar uma nota entre entidades. Operação bloqueada.';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION
      'internal_notes: created_by é imutável após criação. Operação bloqueada.';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'internal_notes: created_at é imutável após criação. Operação bloqueada.';
  END IF;

  -- ── B) Bloqueio de edição de content por não-autor ───────────────────────
  --
  -- A policy UPDATE permite admin alterar deleted_at (soft delete).
  -- Sem este bloqueio, o mesmo UPDATE permitiria ao admin alterar content.
  -- Solução: se content mudou, apenas o autor pode ter feito isso.

  IF NEW.content IS DISTINCT FROM OLD.content THEN
    IF auth.uid() IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION
        'internal_notes: apenas o autor pode editar o conteúdo da nota. Operação bloqueada.';
    END IF;
  END IF;

  -- ── C) Rastreabilidade: atualizar updated_by ─────────────────────────────
  --
  -- Registrar quem executou este UPDATE (edição de content ou soft delete).
  -- O frontend não controla este campo — é sempre derivado do JWT.

  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intnotes_protect ON internal_notes;

-- Nome iniciado com 'p' garante disparo ANTES de trg_intnotes_tenant (iniciado com 't')
-- na ordenação alfabética de triggers com mesmo timing (BEFORE UPDATE).
CREATE TRIGGER trg_intnotes_protect
  BEFORE UPDATE ON internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION protect_internal_note_immutable_fields();


-- =====================================================
-- 5. TRIGGER: updated_at automático
--
-- Reutiliza update_updated_at_column() já existente no sistema.
-- Dispara BEFORE UPDATE, após trg_intnotes_protect (ordem: 'u' > 'p').
-- =====================================================

DROP TRIGGER IF EXISTS trg_intnotes_updated_at ON internal_notes;

CREATE TRIGGER trg_intnotes_updated_at
  BEFORE UPDATE ON internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- 6. RLS (Row Level Security)
-- =====================================================

ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;

-- ── SELECT ───────────────────────────────────────────────────────────────────
--
-- Usuário vê apenas notas da própria empresa que ainda não foram excluídas.
-- deleted_at IS NULL está aqui — o frontend NÃO deve filtrar deleted_at
-- adicionalmente. O banco garante que dados excluídos nunca chegam ao cliente.
--
-- Padrão: alinhado com opportunities, sales_funnels e demais tabelas do sistema
-- (sem is_active em company_users, por consistência com o padrão existente).

CREATE POLICY "intnotes_select" ON internal_notes
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM company_users
       WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL
  );


-- ── INSERT ───────────────────────────────────────────────────────────────────
--
-- Usuário só pode inserir na própria empresa e como autor.
-- created_by = auth.uid() impede que o frontend falsifique a autoria.
-- O trigger validate_internal_note_tenant valida que lead/opportunity
-- pertence ao mesmo company_id (integridade cross-tenant).

CREATE POLICY "intnotes_insert" ON internal_notes
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
       WHERE user_id = auth.uid()
    )
    AND created_by = auth.uid()
  );


-- ── UPDATE ───────────────────────────────────────────────────────────────────
--
-- Quem pode fazer UPDATE: autor da nota OU admin da empresa.
-- O trigger trg_intnotes_protect (BEFORE UPDATE) impede que:
--   - admin altere campos imutáveis
--   - admin altere content de nota alheia
--   - qualquer pessoa altere company_id, lead_id, opportunity_id, created_by, created_at
--
-- Isso significa que admin só consegue efetivamente alterar deleted_at (soft delete).
-- O autor consegue alterar content e deleted_at.
--
-- Não existe policy DELETE física — a exclusão lógica ocorre via UPDATE em deleted_at.
-- Ausência de policy DELETE bloqueia qualquer tentativa de DELETE direto no banco.

CREATE POLICY "intnotes_update" ON internal_notes
  FOR UPDATE
  USING (
    -- Nota deve ser ativa e pertencer à empresa do usuário
    company_id IN (
      SELECT company_id FROM company_users
       WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL
    AND (
      -- Autor pode editar conteúdo e excluir logicamente a própria nota
      created_by = auth.uid()
      OR
      -- Admin pode excluir logicamente notas de outros usuários
      -- (não pode editar content — bloqueado pelo trigger trg_intnotes_protect)
      EXISTS (
        SELECT 1 FROM company_users
         WHERE user_id     = auth.uid()
           AND company_id  = internal_notes.company_id
           AND role        IN ('super_admin', 'system_admin', 'admin')
      )
    )
  )
  WITH CHECK (
    -- Garantir que o UPDATE não tenta mover a nota para outra empresa
    company_id IN (
      SELECT company_id FROM company_users
       WHERE user_id = auth.uid()
    )
  );


-- ── SEM POLICY DELETE ────────────────────────────────────────────────────────
--
-- Não existe policy FOR DELETE nesta tabela.
-- Qualquer tentativa de DELETE físico será rejeitada pelo Supabase/PostgreSQL
-- com erro de RLS (sem policy permissiva = bloqueado por padrão).
-- A exclusão de notas é sempre lógica: UPDATE SET deleted_at = now().

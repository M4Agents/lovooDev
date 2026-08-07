-- =====================================================
-- MIGRATION: add_opportunity_number
-- Data: 07/08/2026
-- Objetivo: Número sequencial legível por empresa para
--           oportunidades (opportunity_number BIGINT).
--
-- Regras:
--   - Sequência independente por company_id (começa em 1).
--   - Banco é a única autoridade: trigger sempre sobrescreve.
--   - Imutável após criação: trigger de UPDATE bloqueia mudanças.
--   - NOT NULL garantido após backfill.
--   - UNIQUE(company_id, opportunity_number).
--   - UUID continua sendo a PK técnica.
--   - Compatível com Produção atual: INSERT sem opportunity_number
--     continua funcionando; o trigger atribui o valor.
--
-- Ordem das operações (tecnicamente mais segura):
--   1. Criar tabela de contadores por empresa.
--   2. Habilitar RLS sem policies (acesso só via SECURITY DEFINER).
--   3. Adicionar coluna (nullable para permitir backfill).
--   4. Backfill dos registros existentes.
--   5. Sincronizar tabela de contadores.
--   6. Adicionar UNIQUE constraint.
--   7. Aplicar NOT NULL.
--   8. Criar trigger de INSERT (sempre sobrescreve, sem WHEN).
--   9. Criar trigger de UPDATE (proteção de imutabilidade).
-- =====================================================

SET search_path = public;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. Tabela de contadores por empresa
--    Cada linha representa o último número atribuído para a empresa.
--    Criação atomica via ON CONFLICT na primeira oportunidade da empresa.
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opportunity_number_sequences (
  company_id  UUID   PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0
);


-- ══════════════════════════════════════════════════════════════════════════
-- 2. RLS habilitado — sem policies de usuário
--    Usuários autenticados não têm acesso direto a esta tabela.
--    O único acesso é via função SECURITY DEFINER do trigger.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE opportunity_number_sequences ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. Coluna opportunity_number
--    Adicionada como NULLABLE para permitir o backfill a seguir.
--    NOT NULL será aplicado na etapa 7, após backfill confirmado.
--    IF NOT EXISTS: idempotente caso a migration seja re-executada.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS opportunity_number BIGINT;


-- ══════════════════════════════════════════════════════════════════════════
-- 4. Backfill dos registros existentes
--    Ordem determinística: created_at ASC, id ASC por empresa.
--    ROW_NUMBER() parte de 1 — primeira oportunidade recebe 1.
--    Oportunidades com mesmo created_at são desempatadas por id (UUID).
--
--    Impacto em produção:
--    - Esta instrução adquire row-level locks nas linhas de opportunities.
--    - Em tabelas grandes pode demorar e bloquear UPDATEs concorrentes.
--    - Recomendado executar em janela de baixo tráfego.
-- ══════════════════════════════════════════════════════════════════════════

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM opportunities
)
UPDATE opportunities o
  SET opportunity_number = r.rn
FROM ranked r
WHERE o.id = r.id;


-- ══════════════════════════════════════════════════════════════════════════
-- 5. Sincronizar tabela de contadores
--    Deve ser executado APÓS o backfill para que novos INSERTs
--    continuem de onde o backfill parou (sem reuso de números).
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO opportunity_number_sequences (company_id, last_number)
  SELECT company_id, MAX(opportunity_number)
  FROM   opportunities
  GROUP  BY company_id
ON CONFLICT (company_id) DO UPDATE
  SET last_number = EXCLUDED.last_number;


-- ══════════════════════════════════════════════════════════════════════════
-- 6. Constraint UNIQUE(company_id, opportunity_number)
--    Garante integridade: dentro de uma empresa, cada número é único.
--    Cria automaticamente índice B-tree em (company_id, opportunity_number).
--
--    Impacto em produção:
--    - Escaneia a tabela inteira para criar o índice.
--    - Em tabelas grandes pode ser lento.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE opportunities
  ADD CONSTRAINT uq_opportunity_number_per_company
  UNIQUE (company_id, opportunity_number);


-- ══════════════════════════════════════════════════════════════════════════
-- 7. NOT NULL — aplicado APÓS backfill e constraint
--    Garante no banco que nenhuma oportunidade pode existir sem número.
--    O trigger de INSERT (etapa 8) garante que todos os INSERTs futuros
--    terão valor, tornando NOT NULL seguro para novas inserções.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE opportunities
  ALTER COLUMN opportunity_number SET NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════
-- 8. Função e trigger de INSERT — geração atômica e segura
--
--    SECURITY DEFINER: necessário para que a função acesse
--    opportunity_number_sequences (sem RLS policies para usuários).
--
--    SET search_path = public: previne injection de schema por um
--    usuário que controle outro schema no search_path.
--
--    Sem cláusula WHEN no CREATE TRIGGER:
--    O trigger SEMPRE executa, descartando silenciosamente qualquer
--    opportunity_number enviado pelo cliente e substituindo pelo
--    próximo número sequencial atômico.
--    (Com WHEN IS NULL, um cliente que enviasse opportunity_number = 999
--     bypassaria o trigger e quebraria a sequência.)
--
--    Concorrência:
--    O INSERT ... ON CONFLICT DO UPDATE na tabela de contadores adquire
--    um row-level lock exclusivo na linha da empresa. Dois INSERTs
--    simultâneos na mesma empresa são serializados pelo PostgreSQL,
--    garantindo que cada um receba um número diferente.
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assign_opportunity_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO opportunity_number_sequences (company_id, last_number)
    VALUES (NEW.company_id, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_number = opportunity_number_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  NEW.opportunity_number := v_next;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_opportunity_number
  BEFORE INSERT ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION assign_opportunity_number();


-- ══════════════════════════════════════════════════════════════════════════
-- 9. Função e trigger de UPDATE — imutabilidade do número
--
--    Impede que qualquer UPDATE altere opportunity_number após a criação.
--    Isso garante que:
--    - O número é permanente e confiável como referência externa.
--    - Números removidos por DELETE não são reutilizados (sequência avança).
--
--    A cláusula WHEN no trigger é intencional para eficiência:
--    O trigger só dispara quando opportunity_number realmente muda,
--    sem overhead em UPDATEs normais (ex: alterar título, valor, status).
--
--    Compatibilidade com Produção:
--    Nenhum UPDATE existente na aplicação toca opportunity_number,
--    portanto nenhum UPDATE existente será afetado.
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION protect_opportunity_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity_number é imutável e não pode ser alterado após a criação'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_protect_opportunity_number
  BEFORE UPDATE ON opportunities
  FOR EACH ROW
  WHEN (NEW.opportunity_number IS DISTINCT FROM OLD.opportunity_number)
  EXECUTE FUNCTION protect_opportunity_number();

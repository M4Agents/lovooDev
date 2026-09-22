-- =============================================================================
-- Migration: alter_meta_messages_add_template_support
-- Timestamp: 20260922130000
--
-- Objetivo:
--   Habilitar persistência de mensagens Meta do tipo 'template' em
--   public.meta_messages (MVP4A — Message Templates).
--
-- Operações (estritamente aditivas):
--   1. DROP da constraint mm_message_type_check existente
--   2. ADD nova constraint mm_message_type_check com IN ('text', 'template')
--      estratégia NOT VALID para minimizar janela de lock exclusivo
--   3. VALIDATE da nova constraint (ShareUpdateExclusiveLock — permite reads/writes)
--   4. ADD COLUMN template_name  text NULL
--   5. ADD COLUMN template_language text NULL
--
-- Backward-compatible:
--   - Rows existentes (message_type='text') permanecem intactas.
--   - 'text' continua válido no CHECK.
--   - template_name e template_language = NULL para mensagens pré-existentes.
--   - body permanece NOT NULL. Esta migration não altera sua semântica.
--     A representação persistida de templates será definida pela camada
--     de envio/renderização (send-template, MVP4A.5+).
--   - Sem backfill. Sem alteração de rows existentes.
--
-- Não alterado por esta migration:
--   - direction CHECK ('inbound', 'outbound')
--   - body (NOT NULL, semântica inalterada)
--   - company_id, conversation_id, instance_id, meta_message_id
--   - timestamps (created_at, updated_at)
--   - PK (meta_messages_pkey)
--   - FKs (mm_company_fk, mm_company_instance_conversation_fk)
--   - UNIQUE (mm_instance_meta_message_id_unique)
--   - Índices existentes
--   - RLS (habilitado, sem alteração)
--   - Policies (meta_messages_select_meta_view, sem alteração)
--   - GRANTs (authenticated=SELECT, service_role=ALL, sem alteração)
--   - Publication supabase_realtime (meta_messages já publicada, sem alteração)
--   - REPLICA IDENTITY FULL (já aplicado em 20260921220000, sem alteração)
--   - Trigger mm_update_updated_at (sem alteração)
--
-- Lock esperado:
--   DROP CONSTRAINT + ADD CONSTRAINT NOT VALID: AccessExclusiveLock breve (~ms).
--   VALIDATE CONSTRAINT: ShareUpdateExclusiveLock (leituras/escritas concorrentes
--   permitidas durante a validação do scan).
--   ADD COLUMN nullable sem default: AccessExclusiveLock breve (~ms).
--   Todas as operações são de baixo risco em tabelas de qualquer tamanho.
--
-- Rollback lógico:
--   DROP COLUMN template_name, template_language (seguro enquanto NULL).
--   Reverter CHECK para = 'text': seguro apenas antes de qualquer INSERT
--   com message_type='template'. Após rows 'template' existirem, reverter
--   o CHECK causaria constraint violation.
--
-- Dependências:
--   20260921120000_create_meta_messages.sql    (tabela base)
--   20260921220000_fix_meta_messages_replica_identity.sql (REPLICA IDENTITY FULL)
-- =============================================================================


-- =============================================================================
-- SEÇÃO 1: EXPANDIR CHECK DE message_type
-- =============================================================================
--
-- Estado atual:  CHECK (message_type = 'text')
-- Estado alvo:   CHECK (message_type IN ('text', 'template'))
--
-- Estratégia NOT VALID + VALIDATE:
--   NOT VALID: skip do full table scan durante ADD CONSTRAINT.
--     Impacto: apenas lock de metadados (~ms). Sem bloqueio de queries.
--     Efeito: constraint válida para novos INSERTs/UPDATEs imediatamente.
--   VALIDATE:  executa scan com ShareUpdateExclusiveLock.
--     Permite leituras e escritas concorrentes durante o scan.
--     Scan rápido: todas as rows existentes têm message_type='text' → pass imediato.
--
-- Ordem obrigatória: DROP antes do ADD para evitar conflito de nome.
-- =============================================================================

BEGIN;

ALTER TABLE public.meta_messages
  DROP CONSTRAINT mm_message_type_check;

ALTER TABLE public.meta_messages
  ADD CONSTRAINT mm_message_type_check
  CHECK (message_type IN ('text', 'template')) NOT VALID;

ALTER TABLE public.meta_messages
  VALIDATE CONSTRAINT mm_message_type_check;


-- =============================================================================
-- SEÇÃO 2: ADICIONAR COLUNAS DE IDENTIDADE DO TEMPLATE
-- =============================================================================
--
-- Ambas as colunas:
--   - text NULL: sem default, sem NOT NULL → sem backfill, sem table rewrite.
--   - PostgreSQL 11+: ADD COLUMN nullable sem default é operação de metadados.
--   - Valor para rows existentes (message_type='text'): NULL (correto).
--   - Valor para futuras rows (message_type='template'): preenchido pela
--     camada de envio (send-template, MVP4A.5+).
-- =============================================================================

ALTER TABLE public.meta_messages
  ADD COLUMN template_name     text NULL,
  ADD COLUMN template_language text NULL;


-- =============================================================================
-- SEÇÃO 3: COMENTÁRIOS DAS NOVAS COLUNAS
-- =============================================================================

COMMENT ON COLUMN public.meta_messages.template_name IS
'Nome do template Meta associado à mensagem quando message_type=''template''. '
'NULL para outros tipos de mensagem.';

COMMENT ON COLUMN public.meta_messages.template_language IS
'Language code do template Meta associado à mensagem quando message_type=''template'' '
'(ex: pt_BR, en_US). NULL para outros tipos de mensagem.';

COMMIT;


-- =============================================================================
-- FIM DA MIGRATION
-- =============================================================================
--
-- VALIDAÇÃO ESPERADA PÓS-APLICAÇÃO:
--
--   pg_get_constraintdef(mm_message_type_check):
--     CHECK ((message_type = ANY (ARRAY['text'::text, 'template'::text])))  ✅
--
--   INSERT com message_type='text' → sucesso                                ✅
--   INSERT com message_type='template' → sucesso                            ✅
--   INSERT com message_type='image' → constraint violation                  ✅
--
--   information_schema.columns para template_name:
--     data_type='text', is_nullable='YES', column_default=NULL              ✅
--   information_schema.columns para template_language:
--     data_type='text', is_nullable='YES', column_default=NULL              ✅
--
--   Rows existentes: template_name IS NULL AND template_language IS NULL    ✅
--   RLS relrowsecurity = true (inalterado)                                  ✅
--   Policy meta_messages_select_meta_view (inalterada)                      ✅
--   Grant SELECT para authenticated (inalterado)                            ✅
--   supabase_realtime publication (inalterada)                              ✅
--   REPLICA IDENTITY FULL (inalterado)                                      ✅
-- =============================================================================

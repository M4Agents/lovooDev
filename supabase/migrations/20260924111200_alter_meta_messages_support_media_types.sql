-- =============================================================================
-- Migration: alter_meta_messages_support_media_types
-- Timestamp: 20260924111200
--
-- Objetivo:
--   Habilitar persistência de mensagens inbound de mídia Meta na tabela
--   public.meta_messages (INBOUND-DOC-C1 / MVP3X+).
--
-- Operações (estritamente aditivas — backward-compatible):
--   1. DROP mm_message_type_check existente (text, template)
--   2. ADD novo mm_message_type_check com IN ('text','template','document','image','video')
--      estratégia NOT VALID + VALIDATE para lock mínimo (mesmo padrão de 20260922130000)
--   3. ALTER COLUMN body DROP NOT NULL
--      executa intenção explicitamente documentada na migration de criação
--      (20260921120000_create_meta_messages.sql)
--
-- Rastreabilidade da intenção original:
--   20260921120000, linha 109-113:
--     "Quando tipos não-texto forem suportados (MVP3X+), esta coluna será relaxada
--      via ALTER TABLE (ou substituída por JSONB genérico) em migration futura."
--   COMMENT ON COLUMN meta_messages.body:
--     "Relaxar para NULL via migration futura ao suportar tipos não-texto."
--   COMMENT ON COLUMN meta_messages.message_type:
--     "CHECK expandido em migration futura ao suportar outros tipos."
--
-- Backward-compatible:
--   - Rows existentes (message_type IN ('text','template')) permanecem intactas.
--   - body das rows existentes: todas não-null — não afetadas pelo DROP NOT NULL.
--   - RPC process_meta_inbound_message: valida p_body IS NULL em código (RAISE),
--     independente da constraint de banco — comportamento inalterado.
--   - Todos os INSERTs existentes (text via RPC, template via send-template.js,
--     outbound via send.js): sempre fornecem body não-null — inalterados.
--   - Sem backfill. Sem alteração de rows existentes.
--
-- Não alterado por esta migration:
--   - direction CHECK ('inbound','outbound')
--   - mm_instance_meta_message_id_unique
--   - mm_company_fk, mm_company_instance_conversation_fk
--   - meta_messages_company_media_asset_fk
--   - meta_messages_pkey
--   - RLS (rowsecurity inalterado)
--   - Policy meta_messages_select_meta_view (inalterada)
--   - GRANTs (inalterados)
--   - Publication supabase_realtime (inalterada)
--   - REPLICA IDENTITY FULL (inalterada)
--   - Trigger mm_update_updated_at (inalterado)
--   - Qualquer RPC existente (process_meta_inbound_message e outras)
--
-- Lock esperado:
--   DROP + ADD CONSTRAINT NOT VALID: AccessExclusiveLock breve (~ms).
--   VALIDATE CONSTRAINT: ShareUpdateExclusiveLock (leituras/escritas concorrentes
--   permitidas; scan em 19 rows = microsegundos).
--   ALTER COLUMN ... DROP NOT NULL: operação de metadados no PostgreSQL
--   (não table rewrite); AccessExclusiveLock breve (~ms) sobre 19 rows.
--
-- Dependências:
--   20260921120000_create_meta_messages.sql             (tabela base)
--   20260922130000_alter_meta_messages_add_template_support.sql  (precedente)
--   20260923140000_meta_messages_add_media_asset.sql    (FK CML)
--
-- RPC de mídia inbound (process_meta_inbound_media_message):
--   Será criada em migration SEPARADA após validação desta.
-- =============================================================================

BEGIN;

-- =============================================================================
-- SEÇÃO 1: EXPANDIR CHECK DE message_type
-- =============================================================================
--
-- Estado atual:  CHECK (message_type = ANY (ARRAY['text'::text, 'template'::text]))
-- Estado alvo:   CHECK (message_type IN ('text','template','document','image','video'))
--
-- Novos valores suportados:
--   document — PDF e documentos (INBOUND-DOC-C, MVP3X+)
--   image    — imagens (MVP3X+ futuro)
--   video    — vídeos (MVP3X+ futuro)
--
-- Estratégia NOT VALID + VALIDATE (mesmo padrão de 20260922130000):
--   NOT VALID: skip full table scan durante ADD CONSTRAINT.
--     Lock: AccessExclusiveLock de metadados (~ms).
--     Efeito: constraint válida imediatamente para novos INSERTs/UPDATEs.
--   VALIDATE: scan com ShareUpdateExclusiveLock.
--     Leituras e escritas concorrentes permitidas durante o scan.
--     Scan instantâneo: 19 rows, todas 'text'/'template' → pass imediato.
--
-- Ordem obrigatória: DROP antes do ADD (sem RENAME disponível em PG).

ALTER TABLE public.meta_messages
  DROP CONSTRAINT mm_message_type_check;

ALTER TABLE public.meta_messages
  ADD CONSTRAINT mm_message_type_check
  CHECK (message_type IN ('text', 'template', 'document', 'image', 'video')) NOT VALID;

ALTER TABLE public.meta_messages
  VALIDATE CONSTRAINT mm_message_type_check;


-- =============================================================================
-- SEÇÃO 2: RELAXAR body PARA NULL
-- =============================================================================
--
-- Estado atual:  body TEXT NOT NULL
-- Estado alvo:   body TEXT NULL
--
-- Executa intenção documentada em 20260921120000:
--   "Quando tipos não-texto forem suportados (MVP3X+), esta coluna será
--    relaxada via ALTER TABLE em migration futura."
--
-- Semântica:
--   message_type='text'/'template' → body sempre não-null (garantido em código pela RPC).
--   message_type='document'/'image'/'video' → body = caption se existir; NULL se ausente.
--
-- Impacto em fluxos existentes:
--   process_meta_inbound_message: valida p_body IS NULL em código → inalterado.
--   send.js: sempre insere body não-null → inalterado.
--   send-template.js: sempre insere body não-null → inalterado.
--
-- Lock: AccessExclusiveLock de metadados (~ms); não é table rewrite no PostgreSQL.
-- Rows existentes: todas têm body não-null → zero impacto.

ALTER TABLE public.meta_messages
  ALTER COLUMN body DROP NOT NULL;


COMMIT;


-- =============================================================================
-- VALIDAÇÃO ESPERADA PÓS-APLICAÇÃO
-- =============================================================================
--
--   pg_get_constraintdef(mm_message_type_check):
--     CHECK ((message_type = ANY (ARRAY[
--       'text'::text, 'template'::text, 'document'::text,
--       'image'::text, 'video'::text
--     ])))                                                                     ✅
--
--   information_schema.columns — body.is_nullable:
--     YES                                                                      ✅
--
--   SELECT message_type, count(*) FROM meta_messages GROUP BY 1:
--     template: 4                                                              ✅
--     text:    15                                                              ✅
--     (nenhuma row alterada ou criada)
--
--   INSERT com message_type='text', body='Olá' → sucesso                      ✅
--   INSERT com message_type='document', body=NULL → sucesso                   ✅
--   INSERT com message_type='audio' → constraint violation                    ✅
--   INSERT com message_type='text', body=NULL → sucesso (via schema);
--     RPC text continua rejeitando em código (RAISE EXCEPTION)                ✅
--
--   process_meta_inbound_message: existência e assinatura inalteradas         ✅
--   mm_direction_check: inalterado                                            ✅
--   mm_instance_meta_message_id_unique: inalterado                           ✅
--   mm_company_fk: inalterado                                                 ✅
--   mm_company_instance_conversation_fk: inalterado                          ✅
--   meta_messages_company_media_asset_fk: inalterado                         ✅
--   RLS rowsecurity: inalterado                                               ✅
--   Policy meta_messages_select_meta_view: inalterada                        ✅
--   Publication supabase_realtime: inalterada                                 ✅
-- =============================================================================

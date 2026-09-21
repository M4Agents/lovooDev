-- =============================================================================
-- Migration: alter_meta_conversations_add_company_instance_id_unique
-- Timestamp: 20260921110000
--
-- Objetivo:
--   Adicionar UNIQUE (company_id, instance_id, id) em public.meta_conversations.
--
-- Por que é necessário:
--   PostgreSQL exige que as colunas referenciadas por uma FK formem uma
--   constraint UNIQUE ou PRIMARY KEY. A PK atual de meta_conversations é
--   apenas (id). Para que public.meta_messages possa declarar:
--
--     FOREIGN KEY (company_id, instance_id, conversation_id)
--       REFERENCES meta_conversations(company_id, instance_id, id)
--
--   é necessário que (company_id, instance_id, id) forme uma UNIQUE constraint.
--
-- Impacto:
--   - 100% aditiva: nenhum dado existente é alterado.
--   - meta_conversations foi criada em M1 (20260921100000) e não possui dados.
--   - O índice UNIQUE resultante é matematicamente consistente com a PK:
--     id é globalmente único, portanto (company_id, instance_id, id) também é,
--     mas o PostgreSQL exige a declaração explícita para suportar a FK composta.
--   - Nenhuma outra tabela é tocada.
--   - meta_whatsapp_messages, chat_conversations, chat_messages,
--     whatsapp_life_instances e estruturas Uazapi permanecem intactas.
--
-- Rollback conceitual:
--   ALTER TABLE public.meta_conversations
--     DROP CONSTRAINT mc_company_instance_id_unique;
-- =============================================================================

ALTER TABLE public.meta_conversations
  ADD CONSTRAINT mc_company_instance_id_unique
    UNIQUE (company_id, instance_id, id);

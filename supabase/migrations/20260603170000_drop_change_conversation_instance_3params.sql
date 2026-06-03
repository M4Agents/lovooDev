-- Migration: drop_change_conversation_instance_3params
-- Objetivo: remover a sobrecarga de 3 parâmetros de change_conversation_instance
-- que causa ambiguidade no PostgREST ao existir junto com a versão de 4 parâmetros.
--
-- A versão de 4 parâmetros (migration 20260603160000) já possui DEFAULT false
-- no parâmetro p_resolve_conflict, cobrindo todas as chamadas com 3 parâmetros.
--
-- Rollback: recriar a função de 3 parâmetros (ver migration 20260603140000).

DROP FUNCTION IF EXISTS public.change_conversation_instance(uuid, uuid, uuid);

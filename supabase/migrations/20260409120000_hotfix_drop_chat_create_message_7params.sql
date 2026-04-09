-- =====================================================
-- HOTFIX: Remover overload ambíguo de chat_create_message (7 parâmetros)
-- Data: 2026-04-09
--
-- Problema:
--   A migration 20260409105000 criou um overload de 11 parâmetros para
--   chat_create_message, onde os últimos 4 têm DEFAULT. Como o overload
--   original de 7 parâmetros continuava existindo, ambos os overloads
--   eram válidos para uma chamada com 7 argumentos nomeados via PostgREST.
--   Isso gerava erro PGRST203: "Could not choose the best candidate function".
--
-- Causa raiz:
--   PostgreSQL não consegue resolver a ambiguidade entre:
--     - chat_create_message(uuid, uuid, text, text, text, uuid, text)
--     - chat_create_message(uuid, uuid, text, text, text, uuid, text,
--                           boolean DEFAULT, uuid DEFAULT, smallint DEFAULT, text DEFAULT)
--   quando chamado com 7 argumentos nomeados via supabase.rpc().
--
-- Solução:
--   DROP no overload original de 7 parâmetros.
--   O overload de 11 parâmetros (com DEFAULT nos últimos 4) é 100%
--   retrocompatível: qualquer chamada com 7 args continua funcionando,
--   os últimos 4 recebem seus defaults automaticamente.
--
-- Impacto:
--   Zero — o overload de 11 params já aceita todas as chamadas existentes.
--
-- Rollback (se necessário):
--   Recriar a função original de 7 params (ver snapshot em
--   .snapshots/pre-mvp-agents-20260409/db-functions/chat_create_message.sql)
-- =====================================================

DROP FUNCTION IF EXISTS public.chat_create_message(
  uuid, uuid, text, text, text, uuid, text
);

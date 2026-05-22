-- =====================================================================
-- Migration: Remover overload ambíguo de merge_leads_webhook
-- Data: 2026-05-22
--
-- Problema:
--   Existiam dois overloads de merge_leads_webhook com parâmetros de
--   mesmo nome mas tipos/ordem diferentes:
--   1. (..., p_notification_id integer, p_user_id uuid)  ← correto
--   2. (..., p_user_id uuid, p_notification_id uuid)     ← legado
--
--   Ao chamar via Supabase JS (named params), o Postgres retornava
--   "function is not unique" → 500 Internal Server Error.
--
-- Correção:
--   Remover o overload legado. Manter apenas a versão com
--   p_notification_id integer + p_user_id uuid no final.
-- =====================================================================

DROP FUNCTION IF EXISTS public.merge_leads_webhook(integer, integer, text, uuid, uuid);

-- =============================================================================
-- Migration: corrigir JOIN da view chat_conversations_with_leads
-- Data: 2026-05-21
--
-- PROBLEMA:
--   A view fazia o JOIN entre leads e chat_conversations usando:
--     l.phone = cc.contact_phone::text
--   Isso falha quando leads.phone contém número formatado, ex: (11) 99999-9999,
--   enquanto chat_conversations.contact_phone armazena apenas dígitos: 11999999999.
--   Resultado: o JOIN silenciosamente não caça → l.name = NULL → o chat exibe
--   o nome antigo vindo de chat_contacts.name ou chat_conversations.contact_name.
--
-- CORREÇÃO:
--   Substituir o JOIN por leads.phone_normalized, coluna GENERATED STORED criada
--   em 20260402130000_add_phone_normalized_leads.sql, que já armazena apenas dígitos
--   e possui índice idx_leads_phone_normalized_company para performance.
--
-- IMPACTO:
--   - Nenhuma alteração em RPCs, frontend, RLS ou tabelas
--   - CREATE OR REPLACE VIEW preserva todos os grants existentes
--   - Os ~90% de casos que já funcionavam continuam funcionando
--   - Os casos com telefone formatado passam a resolver o JOIN corretamente
--
-- ROLLBACK (caso necessário):
--   Substituir de volta:
--     l.phone_normalized = cc.contact_phone::text
--   Por:
--     l.phone = cc.contact_phone::text
--   Reaplicar o CREATE OR REPLACE VIEW abaixo com a condição original.
-- =============================================================================

CREATE OR REPLACE VIEW public.chat_conversations_with_leads AS
SELECT
    cc.id,
    cc.company_id,
    COALESCE(cc.last_instance_id, cc.instance_id) AS instance_id,
    cc.contact_phone,
    COALESCE(
        NULLIF(l.name, ''::text),
        NULLIF(ctc.name::text, ''::text),
        cc.contact_name::text
    ) AS contact_name,
    ctc.profile_picture_url,
    cc.assigned_to,
    cc.last_message_at,
    cc.last_message_content,
    cc.last_message_direction,
    cc.unread_count,
    cc.status,
    cc.created_at,
    cc.updated_at,
    l.id          AS lead_id,
    l.name        AS lead_name,
    ctc.name      AS chat_contact_name,
    cc.contact_name AS original_contact_name,
    l.company_name
FROM chat_conversations cc
LEFT JOIN leads l
    ON  l.phone_normalized = cc.contact_phone::text  -- era: l.phone = cc.contact_phone::text
    AND l.company_id       = cc.company_id
    AND l.deleted_at       IS NULL
LEFT JOIN chat_contacts ctc
    ON  ctc.company_id          = cc.company_id
    AND ctc.phone_number::text  = cc.contact_phone::text;

-- NÃO APLICAR junto com a migration.
-- Dropar os triggers não devolve last_contact_at.
-- Mensagens gravadas depois da carga também voltam ao valor anterior
-- nas linhas que estão no log.
--
-- A restauração desliga update_leads_updated_at; sem isso o UPDATE
-- gravaria updated_at = now() de novo.

DROP TRIGGER IF EXISTS trg_chat_messages_sync_lead_last_contact ON public.chat_messages;
DROP TRIGGER IF EXISTS trg_leads_last_contact_on_phone ON public.leads;

ALTER TABLE public.leads DISABLE TRIGGER update_leads_updated_at;

UPDATE public.leads l
SET last_contact_at = log.old_last_contact_at,
    updated_at      = log.old_updated_at
FROM public.lead_last_contact_backfill_log log
WHERE l.id = log.lead_id;

ALTER TABLE public.leads ENABLE TRIGGER update_leads_updated_at;

DROP FUNCTION IF EXISTS public.sync_lead_last_contact_from_chat_message();
DROP FUNCTION IF EXISTS public.assign_lead_last_contact_from_existing_chat();

-- A tabela lead_last_contact_backfill_log permanece para conferência.
-- Só remover depois de validar a restauração:
-- DROP TABLE IF EXISTS public.lead_last_contact_backfill_log;

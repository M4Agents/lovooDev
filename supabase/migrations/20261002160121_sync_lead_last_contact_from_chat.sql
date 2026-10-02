-- Último contato do lead = mensagem real do chat WhatsApp.
-- Não altera RPCs do funil e não varre chat_messages na carga.
-- Deduplicação de webhook faz last_message_at = now() sem inserir mensagem;
-- por isso o trigger contínuo escuta chat_messages, não a conversa.

CREATE TABLE IF NOT EXISTS public.lead_last_contact_backfill_log (
  lead_id              integer PRIMARY KEY,
  company_id           uuid NOT NULL,
  old_last_contact_at  timestamptz,
  new_last_contact_at  timestamptz NOT NULL,
  old_updated_at       timestamptz,
  applied_at           timestamptz NOT NULL
);

COMMENT ON TABLE public.lead_last_contact_backfill_log IS
  'Snapshot das linhas cujo last_contact_at mudou na carga inicial. '
  'Rollback restaura old_last_contact_at e old_updated_at. Dropar o trigger não desfaz datas.';

ALTER TABLE public.lead_last_contact_backfill_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lead_last_contact_backfill_log FROM PUBLIC;
REVOKE ALL ON TABLE public.lead_last_contact_backfill_log FROM anon, authenticated;

-- Mensagem inserida: sobe last_contact_at se for mais recente.
CREATE OR REPLACE FUNCTION public.sync_lead_last_contact_from_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_phone   text;
  v_at      timestamptz;
BEGIN
  v_at := COALESCE(NEW.timestamp, NEW.created_at);
  IF v_at IS NULL OR NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cc.company_id, NULLIF(btrim(cc.contact_phone), '')
    INTO v_company, v_phone
  FROM public.chat_conversations cc
  WHERE cc.id = NEW.conversation_id;

  IF v_company IS NULL OR v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads l
  SET last_contact_at = v_at
  WHERE l.company_id = v_company
    AND l.phone_normalized = v_phone
    AND l.deleted_at IS NULL
    AND (l.last_contact_at IS NULL OR l.last_contact_at < v_at);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_lead_last_contact_from_chat_message() IS
  'AFTER INSERT em chat_messages. Atualiza leads.last_contact_at só se a mensagem for mais recente. '
  'Não reage a deduplicação que só altera chat_conversations.last_message_at.';

REVOKE ALL ON FUNCTION public.sync_lead_last_contact_from_chat_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_lead_last_contact_from_chat_message() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_chat_messages_sync_lead_last_contact ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_sync_lead_last_contact
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_last_contact_from_chat_message();

-- Lead novo ou telefone alterado: herda o máximo já gravado na conversa.
CREATE OR REPLACE FUNCTION public.assign_lead_last_contact_from_existing_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_max   timestamptz;
BEGIN
  IF NEW.company_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  v_phone := regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
  IF v_phone = '' THEN
    RETURN NEW;
  END IF;

  SELECT MAX(cc.last_message_at)
    INTO v_max
  FROM public.chat_conversations cc
  WHERE cc.company_id = NEW.company_id
    AND cc.contact_phone = v_phone
    AND cc.last_message_at IS NOT NULL;

  IF v_max IS NOT NULL AND (NEW.last_contact_at IS NULL OR NEW.last_contact_at < v_max) THEN
    NEW.last_contact_at := v_max;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assign_lead_last_contact_from_existing_chat() IS
  'BEFORE INSERT ou UPDATE OF phone em leads. Copia o máximo de last_message_at da conversa '
  'do mesmo telefone e empresa, sem reduzir last_contact_at.';

REVOKE ALL ON FUNCTION public.assign_lead_last_contact_from_existing_chat() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_lead_last_contact_from_existing_chat() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_leads_last_contact_on_phone ON public.leads;
CREATE TRIGGER trg_leads_last_contact_on_phone
  BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_lead_last_contact_from_existing_chat();

-- Carga inicial, um UPDATE por empresa. Não lê chat_messages.
DO $$
DECLARE
  v_company uuid;
  v_applied timestamptz := clock_timestamp();
BEGIN
  FOR v_company IN
    SELECT c.id
    FROM public.companies c
    WHERE c.deleted_at IS NULL
  LOOP
    INSERT INTO public.lead_last_contact_backfill_log (
      lead_id, company_id, old_last_contact_at, new_last_contact_at, old_updated_at, applied_at
    )
    SELECT l.id, l.company_id, l.last_contact_at, m.max_at, l.updated_at, v_applied
    FROM public.leads l
    JOIN (
      SELECT cc.contact_phone, MAX(cc.last_message_at) AS max_at
      FROM public.chat_conversations cc
      WHERE cc.company_id = v_company
        AND cc.contact_phone IS NOT NULL
        AND btrim(cc.contact_phone) <> ''
        AND cc.last_message_at IS NOT NULL
      GROUP BY cc.contact_phone
    ) m ON m.contact_phone = l.phone_normalized
    WHERE l.company_id = v_company
      AND l.deleted_at IS NULL
      AND l.phone_normalized IS NOT NULL
      AND l.phone_normalized <> ''
      AND (l.last_contact_at IS NULL OR l.last_contact_at < m.max_at)
    ON CONFLICT (lead_id) DO NOTHING;

    UPDATE public.leads l
    SET last_contact_at = log.new_last_contact_at
    FROM public.lead_last_contact_backfill_log log
    WHERE log.lead_id = l.id
      AND log.company_id = v_company
      AND log.applied_at = v_applied
      AND (l.last_contact_at IS NULL OR l.last_contact_at < log.new_last_contact_at);
  END LOOP;
END;
$$;

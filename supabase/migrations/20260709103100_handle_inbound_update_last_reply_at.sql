-- Motor de Ciclos — E5: atualiza last_customer_reply_at ao processar inbound
-- Executado APÓS close_cycle_if_open — é apenas metadado complementar
-- Assinatura, SECURITY DEFINER, search_path e grants preservados

CREATE OR REPLACE FUNCTION public.handle_inbound_for_contact_cycle(
  p_lead_id             INTEGER,
  p_company_id          UUID,
  p_whatsapp_message_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_opportunity_id UUID;
BEGIN
  v_opportunity_id := resolve_opportunity_for_contact_cycle(p_lead_id, p_company_id);
  IF v_opportunity_id IS NULL THEN RETURN; END IF;

  PERFORM close_cycle_if_open(v_opportunity_id, 'inbound_received', NULL);

  UPDATE public.opportunity_funnel_positions
     SET last_customer_reply_at = CURRENT_TIMESTAMP
   WHERE opportunity_id = v_opportunity_id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_inbound_for_contact_cycle failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_inbound_for_contact_cycle(INTEGER, UUID, TEXT)
  FROM anon, authenticated;

-- Rollback desta RPC (restaura versão anterior):
--
-- CREATE OR REPLACE FUNCTION public.handle_inbound_for_contact_cycle(
--   p_lead_id INTEGER, p_company_id UUID, p_whatsapp_message_id TEXT DEFAULT NULL
-- )
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- DECLARE
--   v_opportunity_id UUID;
-- BEGIN
--   v_opportunity_id := resolve_opportunity_for_contact_cycle(p_lead_id, p_company_id);
--   IF v_opportunity_id IS NULL THEN RETURN; END IF;
--   PERFORM close_cycle_if_open(v_opportunity_id, 'inbound_received', NULL);
-- EXCEPTION
--   WHEN OTHERS THEN NULL;
-- END;
-- $$;
-- REVOKE EXECUTE ON FUNCTION public.handle_inbound_for_contact_cycle(INTEGER, UUID, TEXT)
--   FROM anon, authenticated;

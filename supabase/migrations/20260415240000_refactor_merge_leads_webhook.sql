-- MIGRATION: Refatorar merge_leads_webhook
-- Responsabilidade: APENAS consolidar dados e transferir relacionamentos.
-- NÃO contém lógica de re-engajamento, NÃO chama handleLeadReentry, NÃO cria eventos.
-- Adicionada transferência de lead_entries (nova tabela).

CREATE OR REPLACE FUNCTION merge_leads_webhook(
  p_source_id      INTEGER,
  p_target_id      INTEGER,
  p_strategy       TEXT,
  p_user_id        UUID,
  p_notification_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_source_lead  leads%ROWTYPE;
  v_target_lead  leads%ROWTYPE;
  v_merged_data  JSON;
  v_result_id    INTEGER;
  v_company_id   UUID;
  v_discarded_id INTEGER;
BEGIN
  -- 1. Buscar leads
  SELECT * INTO v_source_lead FROM leads WHERE id = p_source_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Lead origem não encontrado');
  END IF;

  SELECT * INTO v_target_lead FROM leads WHERE id = p_target_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Lead destino não encontrado');
  END IF;

  IF v_source_lead.company_id != v_target_lead.company_id THEN
    RETURN json_build_object('success', false, 'error', 'Leads de empresas diferentes');
  END IF;

  v_company_id := v_source_lead.company_id;

  -- 2. Aplicar estratégia de mesclagem
  CASE p_strategy
    WHEN 'keep_existing' THEN
      v_result_id    := p_target_id;
      v_discarded_id := p_source_id;
      UPDATE leads SET deleted_at = NOW(), duplicate_status = 'merged', updated_at = NOW()
      WHERE id = p_source_id;

    WHEN 'keep_new' THEN
      v_result_id    := p_source_id;
      v_discarded_id := p_target_id;
      UPDATE leads SET deleted_at = NOW(), duplicate_status = 'merged', updated_at = NOW()
      WHERE id = p_target_id;

    WHEN 'merge_fields' THEN
      v_result_id    := p_target_id;
      v_discarded_id := p_source_id;
      UPDATE leads SET
        name = CASE
          WHEN LENGTH(COALESCE(v_source_lead.name, '')) > LENGTH(COALESCE(v_target_lead.name, ''))
          THEN v_source_lead.name ELSE v_target_lead.name END,
        email        = COALESCE(v_source_lead.email, v_target_lead.email),
        phone        = COALESCE(v_source_lead.phone, v_target_lead.phone),
        interest     = COALESCE(v_source_lead.interest, v_target_lead.interest),
        company_name = COALESCE(v_source_lead.company_name, v_target_lead.company_name),
        company_cnpj = COALESCE(v_source_lead.company_cnpj, v_target_lead.company_cnpj),
        company_email= COALESCE(v_source_lead.company_email, v_target_lead.company_email),
        visitor_id   = COALESCE(v_target_lead.visitor_id, v_source_lead.visitor_id),
        updated_at   = NOW()
      WHERE id = p_target_id;
      UPDATE leads SET deleted_at = NOW(), duplicate_status = 'merged', updated_at = NOW()
      WHERE id = p_source_id;

    ELSE
      RETURN json_build_object('success', false, 'error', 'Estratégia inválida');
  END CASE;

  -- 3. Transferir relacionamentos para o lead sobrevivente
  UPDATE opportunities
    SET lead_id = v_result_id, updated_at = NOW()
  WHERE lead_id = v_discarded_id AND company_id = v_company_id;

  UPDATE opportunity_funnel_positions
    SET lead_id = v_result_id
  WHERE lead_id = v_discarded_id;

  -- Transferir lead_entries (nova tabela de reentradas)
  UPDATE lead_entries
    SET lead_id = v_result_id
  WHERE lead_id = v_discarded_id AND company_id = v_company_id;

  UPDATE chat_conversations
    SET lead_id = v_result_id
  WHERE lead_id = v_discarded_id AND company_id = v_company_id;

  -- 4. Registrar histórico de merge (se tabela existir)
  BEGIN
    INSERT INTO lead_merge_history (source_lead_id, target_lead_id, merged_by_user_id, merge_strategy, created_at)
    VALUES (p_source_id, p_target_id, p_user_id, p_strategy, NOW());
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 5. Marcar notificação como merged
  IF p_notification_id IS NOT NULL THEN
    UPDATE duplicate_notifications SET
      status = 'merged', reviewed_at = NOW(), reviewed_by_user_id = p_user_id
    WHERE id = p_notification_id;
  END IF;

  -- 6. Retornar dados do lead resultado
  SELECT row_to_json(l) INTO v_merged_data
  FROM (SELECT name, email, phone, company_name FROM leads WHERE id = v_result_id) l;

  RETURN json_build_object(
    'success', true,
    'message', 'Leads mesclados com sucesso',
    'result_lead_id', v_result_id,
    'strategy', p_strategy,
    'merged_data', v_merged_data
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', 'Erro interno: ' || SQLERRM);
END;
$$;

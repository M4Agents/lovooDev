-- =============================================================================
-- RPC: claim_nuvemshop_pending_scripts
--
-- Seleciona atomicamente conexões com script pendente ou falho prontas para
-- processamento. Usa FOR UPDATE SKIP LOCKED para evitar processamento duplo
-- por workers paralelos (Vercel Functions stateless).
--
-- Claim mechanism:
--   Ao selecionar um lote, o RPC imediatamente define script_next_retry_at
--   para now() + 10 minutos. Isso impede que outro worker reivindique a
--   mesma conexão enquanto este ainda está processando.
--   Após o processamento, o caller atualiza script_status e script_next_retry_at
--   para o valor final (null em sucesso, backoff em falha).
--
-- Critérios de elegibilidade:
--   - status = 'active' (conexão OAuth ativa)
--   - script_status IN ('pending', 'failed')
--   - script_next_retry_at IS NULL OR script_next_retry_at <= now()
--   - script_retry_count < 5 (MAX_SCRIPT_RETRIES)
--
-- Retorna apenas campos necessários para o worker.
-- access_token_enc é retornado apenas aqui (backend, SECURITY DEFINER).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_nuvemshop_pending_scripts(
  p_batch_size INT DEFAULT 5
)
RETURNS TABLE (
  connection_id       UUID,
  company_id          UUID,
  nuvemshop_store_id  TEXT,
  access_token_enc    TEXT,
  script_retry_count  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.nuvemshop_connections nc
  SET
    -- Claim lock: impede outro worker de reivindiqar dentro de 10 min
    script_next_retry_at = now() + INTERVAL '10 minutes',
    updated_at           = now()
  WHERE nc.id IN (
    SELECT sub.id
    FROM   public.nuvemshop_connections sub
    WHERE  sub.status            = 'active'
      AND  sub.script_status    IN ('pending', 'failed')
      AND  (sub.script_next_retry_at IS NULL OR sub.script_next_retry_at <= now())
      AND  sub.script_retry_count < 5
    ORDER BY COALESCE(sub.script_next_retry_at, sub.created_at) ASC
    LIMIT  p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    nc.id                   AS connection_id,
    nc.company_id,
    nc.nuvemshop_store_id,
    nc.access_token_enc,
    nc.script_retry_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_nuvemshop_pending_scripts(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_nuvemshop_pending_scripts(INT) TO service_role;

COMMENT ON FUNCTION public.claim_nuvemshop_pending_scripts(INT) IS
  'Reivindica atomicamente um lote de conexões com script pendente ou falho. '
  'Usa FOR UPDATE SKIP LOCKED para garantir processamento único por worker. '
  'O caller deve atualizar script_status ao final do processamento.';

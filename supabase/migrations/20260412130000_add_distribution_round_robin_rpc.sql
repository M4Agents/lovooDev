-- =====================================================
-- MIGRATION: ADD DISTRIBUTION ROUND ROBIN RPC
--
-- Cria função atômica para cursor de round-robin
-- usada pelo distributionHandler.js do motor backend.
--
-- A função faz UPSERT + RETURNING em distribution_state,
-- garantindo que dois Lambdas concorrentes nunca obtenham
-- o mesmo índice (serialização via row-level lock do UPDATE).
--
-- Pré-condição: p_user_count deve ser > 0.
--   O handler JS valida isso antes de chamar a RPC.
--
-- Não altera a tabela distribution_state — apenas adiciona função.
-- =====================================================

CREATE OR REPLACE FUNCTION automation_distribution_next_user(
  p_company_id  UUID,
  p_user_count  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_index INTEGER;
BEGIN
  -- Inserir estado inicial se não existir; caso contrário
  -- incrementar o índice de forma atômica (% p_user_count mantém
  -- o cursor sempre dentro do intervalo [0, p_user_count - 1]).
  --
  -- O ON CONFLICT DO UPDATE serializa escritas concorrentes na
  -- mesma linha, garantindo que cada chamada obtenha um valor único.
  INSERT INTO distribution_state (company_id, last_user_index, updated_at)
  VALUES (p_company_id, 0, NOW())
  ON CONFLICT (company_id) DO UPDATE
    SET last_user_index = (distribution_state.last_user_index + 1) % p_user_count,
        updated_at      = NOW()
  RETURNING last_user_index INTO v_next_index;

  RETURN v_next_index;
END;
$$;

COMMENT ON FUNCTION automation_distribution_next_user(UUID, INTEGER) IS
  'Retorna o próximo índice de round-robin para distribuição de leads/oportunidades. '
  'Operação atômica — segura para chamadas concorrentes. '
  'Chamador deve garantir p_user_count > 0.';

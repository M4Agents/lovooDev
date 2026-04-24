-- =============================================================================
-- MIGRATION: RPC reorder_funnel_stages (v2 — offset trick)
--
-- PROBLEMA CORRIGIDO:
--   O PostgreSQL verifica a constraint UNIQUE(funnel_id, position) por linha,
--   mesmo dentro de um único UPDATE statement. Ao trocar posições entre etapas
--   (ex: A:0→1 enquanto B ainda está em 1), ocorre violação imediata (HTTP 409).
--
--   A versão anterior usava um único UPDATE com unnest(), que não resolve o
--   problema porque a verificação da constraint é por linha, não por statement.
--
-- SOLUÇÃO — Dois UPDATEs com offset temporário:
--   Passo 1: deslocar todas as posições alvo para +1.000.000 (faixa segura,
--            sem colisão com posições reais 0-N nem entre si).
--   Passo 2: definir as posições finais reais. Como todos os alvos estão em
--            1.000.000+, não há conflito com os valores finais (0, 1, 2, ...).
--
-- SEGURANÇA:
--   - SECURITY DEFINER garante acesso para escrita via service_role
--   - Guard funnel_id: ignora stages de outro funil por erro no payload
--   - Não altera a constraint UNIQUE(funnel_id, position)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reorder_funnel_stages(
  p_funnel_id  UUID,
  p_stage_ids  UUID[],
  p_positions  INTEGER[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF COALESCE(array_length(p_stage_ids, 1), 0) <> COALESCE(array_length(p_positions, 1), 0) THEN
    RAISE EXCEPTION 'reorder_funnel_stages: stage_ids e positions devem ter o mesmo comprimento';
  END IF;

  IF array_length(p_stage_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Passo 1: deslocar todas as posições alvo para uma faixa segura (+1.000.000).
  -- O PostgreSQL verifica a constraint UNIQUE(funnel_id, position) por linha,
  -- mesmo em um único UPDATE. Ao trocar posições (ex: A:0->1 enquanto B=1),
  -- ocorreria violação imediata. O offset garante que não há colisão intermediária.
  UPDATE public.funnel_stages fs
     SET position = position + 1000000
    FROM unnest(p_stage_ids) AS ids(id)
   WHERE fs.id        = ids.id
     AND fs.funnel_id = p_funnel_id;

  -- Passo 2: definir as posições reais. Todos os alvos estão na faixa segura
  -- (1.000.000+), portanto não há colisão com as posições finais (0, 1, 2, ...).
  UPDATE public.funnel_stages fs
     SET position   = np.pos,
         updated_at = NOW()
    FROM unnest(p_stage_ids, p_positions) AS np(id, pos)
   WHERE fs.id        = np.id
     AND fs.funnel_id = p_funnel_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.reorder_funnel_stages(UUID, UUID[], INTEGER[]) IS
  'Reordena etapas de um funil sem violar UNIQUE(funnel_id, position). '
  'Usa offset temporário (+1.000.000) para evitar conflito por linha, '
  'pois o PostgreSQL verifica a constraint UNIQUE por linha mesmo em um único UPDATE. '
  'Retorna o número de linhas atualizadas (baseado no segundo UPDATE).';

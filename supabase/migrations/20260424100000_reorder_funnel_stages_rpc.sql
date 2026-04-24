-- =============================================================================
-- MIGRATION: RPC reorder_funnel_stages
--
-- PROBLEMA CORRIGIDO:
--   O endpoint /api/funnel/reorder-stages atualizava posições uma a uma
--   em loop, gerando violação intermediária da constraint
--   UNIQUE(funnel_id, position) ao trocar posições entre etapas.
--
-- SOLUÇÃO:
--   Um único UPDATE com unnest(). O PostgreSQL avalia constraints UNIQUE
--   ao término do statement completo, não por linha, eliminando os conflitos
--   de posições intermediárias sem necessidade de alterar a constraint.
--
-- SEGURANÇA:
--   - SECURITY DEFINER garante acesso para escrita via service_role
--   - Valida que os stage_ids pertencem ao funnel_id informado
--   - Impede reordenação de etapas de outro funil por erro no payload
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
  -- Validar paridade dos arrays
  IF COALESCE(array_length(p_stage_ids, 1), 0) <> COALESCE(array_length(p_positions, 1), 0) THEN
    RAISE EXCEPTION 'reorder_funnel_stages: stage_ids e positions devem ter o mesmo comprimento';
  END IF;

  IF array_length(p_stage_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- UPDATE único — o PostgreSQL avalia UNIQUE(funnel_id, position) ao fim
  -- do statement, não por linha, evitando violações intermediárias de posição.
  UPDATE public.funnel_stages fs
     SET position   = np.pos,
         updated_at = NOW()
    FROM unnest(p_stage_ids, p_positions) AS np(id, pos)
   WHERE fs.id        = np.id
     AND fs.funnel_id = p_funnel_id;  -- guard: ignora stages de outro funil

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.reorder_funnel_stages(UUID, UUID[], INTEGER[]) IS
  'Reordena etapas de um funil em um único UPDATE para evitar violação '
  'intermediária da constraint UNIQUE(funnel_id, position). '
  'Retorna o número de linhas atualizadas.';

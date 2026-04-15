-- Fix: remove filtro is_system_stage = true da busca pela etapa inicial.
-- A etapa de entrada do funil é definida pela posição 0, não pelo flag is_system_stage.
-- Funnels criados manualmente têm is_system_stage = false em todas as etapas,
-- causando falha silenciosa ao tentar adicionar leads ao funil automaticamente.

CREATE OR REPLACE FUNCTION add_lead_to_default_funnel()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_funnel_id UUID;
  v_stage_id UUID;
  v_opportunity_id UUID;
  v_existing_opp_id UUID;
  v_existing_position_id UUID;
BEGIN
  SELECT id INTO v_funnel_id
  FROM sales_funnels
  WHERE company_id = NEW.company_id
    AND is_default = true
    AND is_active = true
  LIMIT 1;

  IF v_funnel_id IS NOT NULL THEN
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id
    ORDER BY position ASC
    LIMIT 1;

    IF v_stage_id IS NOT NULL THEN
      SELECT id INTO v_existing_opp_id
      FROM opportunities
      WHERE lead_id = NEW.id
      LIMIT 1;

      IF v_existing_opp_id IS NULL THEN
        INSERT INTO opportunities (
          lead_id,
          company_id,
          title,
          status,
          source,
          created_at,
          updated_at
        ) VALUES (
          NEW.id,
          NEW.company_id,
          'Nova Oportunidade',
          'open',
          COALESCE(NEW.origin, 'manual'),
          NOW(),
          NOW()
        )
        RETURNING id INTO v_opportunity_id;
      ELSE
        v_opportunity_id := v_existing_opp_id;
      END IF;

      SELECT id INTO v_existing_position_id
      FROM opportunity_funnel_positions
      WHERE lead_id = NEW.id
        AND funnel_id = v_funnel_id
      LIMIT 1;

      IF v_existing_position_id IS NULL AND v_opportunity_id IS NOT NULL THEN
        INSERT INTO opportunity_funnel_positions (
          lead_id,
          opportunity_id,
          funnel_id,
          stage_id,
          position_in_stage,
          entered_stage_at,
          updated_at
        )
        VALUES (
          NEW.id,
          v_opportunity_id,
          v_funnel_id,
          v_stage_id,
          0,
          NOW(),
          NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

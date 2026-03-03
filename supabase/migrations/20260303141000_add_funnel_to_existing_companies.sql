-- =====================================================
-- MIGRAÇÃO: Adicionar Funil Padrão às Empresas Existentes
-- Data: 03/03/2026
-- Objetivo: Criar funil padrão para empresas que já existiam antes da implementação
-- =====================================================

DO $$
DECLARE
  v_company RECORD;
  v_funnel_id UUID;
  v_lead RECORD;
  v_stage_id UUID;
BEGIN
  -- Loop em todas as empresas que não possuem funil
  FOR v_company IN 
    SELECT c.id, c.name
    FROM companies c
    LEFT JOIN sales_funnels sf ON sf.company_id = c.id
    WHERE sf.id IS NULL
  LOOP
    RAISE NOTICE 'Criando funil para empresa: % (ID: %)', v_company.name, v_company.id;
    
    -- Criar funil padrão
    INSERT INTO sales_funnels (
      company_id,
      name,
      description,
      is_default,
      is_active
    ) VALUES (
      v_company.id,
      'Funil de Vendas Principal',
      'Funil padrão criado automaticamente',
      true,
      true
    ) RETURNING id INTO v_funnel_id;
    
    RAISE NOTICE 'Funil criado com ID: %', v_funnel_id;
    
    -- Criar etapas padrão
    INSERT INTO funnel_stages (funnel_id, name, color, position, is_system_stage, stage_type) VALUES
      (v_funnel_id, 'Lead Novo', '#FCD34D', 0, true, 'active'),
      (v_funnel_id, 'Contato Realizado', '#86EFAC', 1, false, 'active'),
      (v_funnel_id, 'Diagnóstico / Briefing', '#93C5FD', 2, false, 'active'),
      (v_funnel_id, 'Proposta Enviada', '#C4B5FD', 3, false, 'active'),
      (v_funnel_id, 'Follow-up', '#FCA5A5', 4, false, 'active'),
      (v_funnel_id, 'Fechado - Ganhou', '#10B981', 5, false, 'won'),
      (v_funnel_id, 'Fechado - Perdeu', '#EF4444', 6, false, 'lost');
    
    RAISE NOTICE 'Etapas criadas para funil %', v_funnel_id;
    
    -- Buscar etapa "Lead Novo" (system stage)
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id
      AND is_system_stage = true
      AND position = 0
    LIMIT 1;
    
    -- Adicionar todos os leads existentes da empresa ao funil
    FOR v_lead IN
      SELECT id
      FROM leads
      WHERE company_id = v_company.id
        AND deleted_at IS NULL
    LOOP
      INSERT INTO lead_funnel_positions (
        lead_id,
        funnel_id,
        stage_id,
        position_in_stage,
        entered_stage_at
      ) VALUES (
        v_lead.id,
        v_funnel_id,
        v_stage_id,
        0,
        NOW()
      )
      ON CONFLICT (lead_id, funnel_id) DO NOTHING;
    END LOOP;
    
    RAISE NOTICE 'Leads adicionados ao funil da empresa %', v_company.name;
    
  END LOOP;
  
  RAISE NOTICE 'Migração concluída com sucesso!';
END $$;

-- Verificar resultado
SELECT 
  c.name as company_name,
  sf.name as funnel_name,
  COUNT(DISTINCT fs.id) as stage_count,
  COUNT(DISTINCT lfp.id) as lead_count
FROM companies c
LEFT JOIN sales_funnels sf ON sf.company_id = c.id
LEFT JOIN funnel_stages fs ON fs.funnel_id = sf.id
LEFT JOIN lead_funnel_positions lfp ON lfp.funnel_id = sf.id
GROUP BY c.id, c.name, sf.id, sf.name
ORDER BY c.name;

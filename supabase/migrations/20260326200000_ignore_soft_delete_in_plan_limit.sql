-- =====================================================
-- MIGRATION: Ignorar Soft Delete no Limite de Instâncias
-- =====================================================
-- Criado em: 26/03/2026
-- Objetivo: Instâncias soft deleted não devem contar no limite do plano
-- Impacto: Zero (melhoria retrocompatível)
-- Motivo: Usuário não deve ficar bloqueado ao reconectar instância

CREATE OR REPLACE FUNCTION check_whatsapp_life_plan_limit(
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_type TEXT;
    v_plan_limit INTEGER;
    v_current_count INTEGER;
BEGIN
    -- Buscar tipo de plano da empresa
    SELECT plan INTO v_plan_type 
    FROM companies 
    WHERE id = p_company_id;
    
    -- Definir limites por plano
    v_plan_limit := CASE v_plan_type
        WHEN 'basic' THEN 1
        WHEN 'pro' THEN 3
        WHEN 'enterprise' THEN 10
        ELSE 1 -- padrão
    END;
    
    -- ✅ MUDANÇA: Contar apenas instâncias ativas (ignora soft deleted)
    -- Instâncias com deleted_at IS NOT NULL não são contabilizadas
    SELECT COUNT(*) INTO v_current_count
    FROM whatsapp_life_instances
    WHERE company_id = p_company_id
    AND deleted_at IS NULL;  -- ✅ NOVO: Ignora soft deleted
    
    -- Retornar resultado
    RETURN jsonb_build_object(
        'canAdd', v_current_count < v_plan_limit,
        'currentCount', v_current_count,
        'maxAllowed', v_plan_limit,
        'planType', COALESCE(v_plan_type, 'basic'),
        'remaining', GREATEST(0, v_plan_limit - v_current_count)
    );
END;
$$;

COMMENT ON FUNCTION check_whatsapp_life_plan_limit IS 
'Verifica limites de instâncias WhatsApp por plano. 
Instâncias soft deleted (deleted_at IS NOT NULL) não são contabilizadas no limite.
Isso permite que usuários criem novas instâncias mesmo com instâncias antigas desconectadas.
Atualizado em 26/03/2026 para ignorar instâncias desconectadas.';

-- =====================================================
-- LOG DA MIGRATION
-- =====================================================

DO $$
BEGIN
    RAISE LOG '✅ MIGRATION APLICADA: Ignorar Soft Delete no Limite de Instâncias';
    RAISE LOG '📊 MUDANÇA: deleted_at IS NULL adicionado à contagem';
    RAISE LOG '🎯 BENEFÍCIO: Usuários não ficam bloqueados ao reconectar instância';
    RAISE LOG '🔒 SEGURANÇA: Zero breaking changes, retrocompatível';
END;
$$;

-- =====================================================
-- MIGRAÇÃO 006: SINCRONIZAÇÃO EM LOTE (OPCIONAL)
-- =====================================================
-- Objetivo: Sincronizar leads antigos existentes uma única vez
-- Uso: Executar apenas se necessário após testar trigger
-- Segurança: Função controlada que pode ser executada manualmente

-- =====================================================
-- 1. FUNÇÃO DE SINCRONIZAÇÃO EM LOTE SEGURA
-- =====================================================

CREATE OR REPLACE FUNCTION sync_existing_leads_to_chat_batch(
    p_company_id UUID DEFAULT NULL,
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    lead_id INTEGER,
    lead_name TEXT,
    lead_phone TEXT,
    chat_contacts_updated INTEGER,
    status TEXT
) AS $$
DECLARE
    v_lead RECORD;
    v_updated_count INTEGER;
    v_total_processed INTEGER := 0;
BEGIN
    -- Log início da operação
    RAISE NOTICE 'SYNC BATCH: Iniciando sincronização em lote (dry_run: %)', p_dry_run;
    
    -- Loop através dos leads que têm chat_contacts correspondentes
    FOR v_lead IN 
        SELECT DISTINCT
            l.id,
            l.name,
            l.phone,
            l.company_id
        FROM leads l
        INNER JOIN chat_contacts cc ON (
            cc.phone_number = l.phone 
            AND cc.company_id = l.company_id
        )
        WHERE 
            l.deleted_at IS NULL
            AND l.phone IS NOT NULL
            AND l.name IS NOT NULL
            AND l.name != ''
            -- Filtrar por empresa se especificado
            AND (p_company_id IS NULL OR l.company_id = p_company_id)
            -- Só processar onde há diferença
            AND l.name != COALESCE(cc.name, '')
        ORDER BY l.id
    LOOP
        v_total_processed := v_total_processed + 1;
        
        IF p_dry_run THEN
            -- Modo dry-run: apenas simular
            v_updated_count := (
                SELECT COUNT(*)
                FROM chat_contacts cc
                WHERE cc.phone_number = v_lead.phone 
                AND cc.company_id = v_lead.company_id
            );
            
            RETURN QUERY SELECT 
                v_lead.id,
                v_lead.name,
                v_lead.phone,
                v_updated_count,
                'DRY_RUN'::TEXT;
        ELSE
            -- Modo real: executar atualização
            UPDATE chat_contacts 
            SET 
                name = v_lead.name,
                updated_at = NOW()
            WHERE 
                phone_number = v_lead.phone 
                AND company_id = v_lead.company_id;
            
            GET DIAGNOSTICS v_updated_count = ROW_COUNT;
            
            RETURN QUERY SELECT 
                v_lead.id,
                v_lead.name,
                v_lead.phone,
                v_updated_count,
                CASE 
                    WHEN v_updated_count > 0 THEN 'UPDATED'
                    ELSE 'NO_MATCH'
                END::TEXT;
        END IF;
        
        -- Log progresso a cada 10 registros
        IF v_total_processed % 10 = 0 THEN
            RAISE NOTICE 'SYNC BATCH: Processados % leads...', v_total_processed;
        END IF;
    END LOOP;
    
    -- Log final
    RAISE NOTICE 'SYNC BATCH: Concluído. Total processado: %', v_total_processed;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 2. FUNÇÃO DE VERIFICAÇÃO PRÉ-SINCRONIZAÇÃO
-- =====================================================

CREATE OR REPLACE FUNCTION check_leads_chat_sync_status(
    p_company_id UUID DEFAULT NULL
)
RETURNS TABLE(
    total_leads INTEGER,
    leads_with_chat INTEGER,
    leads_names_different INTEGER,
    sync_needed BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH stats AS (
        SELECT 
            COUNT(DISTINCT l.id) as total_leads,
            COUNT(DISTINCT CASE WHEN cc.id IS NOT NULL THEN l.id END) as leads_with_chat,
            COUNT(DISTINCT CASE 
                WHEN cc.id IS NOT NULL 
                AND l.name != COALESCE(cc.name, '') 
                THEN l.id 
            END) as leads_names_different
        FROM leads l
        LEFT JOIN chat_contacts cc ON (
            cc.phone_number = l.phone 
            AND cc.company_id = l.company_id
        )
        WHERE 
            l.deleted_at IS NULL
            AND (p_company_id IS NULL OR l.company_id = p_company_id)
    )
    SELECT 
        s.total_leads::INTEGER,
        s.leads_with_chat::INTEGER,
        s.leads_names_different::INTEGER,
        (s.leads_names_different > 0) as sync_needed
    FROM stats s;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION sync_existing_leads_to_chat_batch(UUID, BOOLEAN) IS 
'Sincroniza leads existentes para chat_contacts em lote. Use dry_run=true para testar primeiro.';

COMMENT ON FUNCTION check_leads_chat_sync_status(UUID) IS 
'Verifica quantos leads precisam de sincronização com chat_contacts.';

-- =====================================================
-- 4. EXEMPLOS DE USO
-- =====================================================

/*
VERIFICAR STATUS ANTES:
SELECT * FROM check_leads_chat_sync_status();

TESTAR SINCRONIZAÇÃO (DRY RUN):
SELECT * FROM sync_existing_leads_to_chat_batch(NULL, true);

EXECUTAR SINCRONIZAÇÃO REAL:
SELECT * FROM sync_existing_leads_to_chat_batch(NULL, false);

SINCRONIZAR APENAS UMA EMPRESA:
SELECT * FROM sync_existing_leads_to_chat_batch('company-uuid-here', false);
*/

-- =====================================================
-- FIM DA MIGRAÇÃO 006
-- =====================================================

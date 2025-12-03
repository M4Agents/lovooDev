-- =====================================================
-- MIGRAÇÃO 005: SINCRONIZAÇÃO LEADS ↔ CHAT_CONTACTS
-- =====================================================
-- Objetivo: Sincronizar automaticamente nomes entre leads e chat_contacts
-- Segurança: Implementação conservadora com máxima cautela
-- Data: 2025-11-27

-- =====================================================
-- 1. FUNÇÃO DE SINCRONIZAÇÃO SEGURA
-- =====================================================

CREATE OR REPLACE FUNCTION sync_lead_to_chat_contacts()
RETURNS TRIGGER AS $$
BEGIN
    -- Log da operação para auditoria
    RAISE NOTICE 'SYNC TRIGGER: Lead % - Nome alterado de "%" para "%"', 
        NEW.id, COALESCE(OLD.name, 'NULL'), COALESCE(NEW.name, 'NULL');
    
    -- Verificar se realmente houve mudança no nome
    IF OLD.name IS DISTINCT FROM NEW.name THEN
        -- Atualizar chat_contacts apenas se existir registro correspondente
        UPDATE chat_contacts 
        SET 
            name = NEW.name,
            updated_at = NOW()
        WHERE 
            phone_number = NEW.phone 
            AND company_id = NEW.company_id
            AND phone_number IS NOT NULL  -- Segurança extra
            AND NEW.phone IS NOT NULL;    -- Segurança extra
        
        -- Log do resultado
        RAISE NOTICE 'SYNC TRIGGER: Atualizados % registros em chat_contacts para phone %', 
            ROW_COUNT, NEW.phone;
    END IF;
    
    -- Sempre retornar NEW para não interferir na operação original
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 2. TRIGGER SEGURO COM CONDIÇÕES ESPECÍFICAS
-- =====================================================

-- Remover trigger existente se houver (segurança)
DROP TRIGGER IF EXISTS sync_lead_name_trigger ON leads;

-- Criar trigger apenas para UPDATE e apenas quando nome muda
CREATE TRIGGER sync_lead_name_trigger
    AFTER UPDATE ON leads
    FOR EACH ROW
    WHEN (
        -- Só executar quando nome realmente mudou
        OLD.name IS DISTINCT FROM NEW.name
        -- E quando ambos os campos necessários existem
        AND NEW.phone IS NOT NULL
        AND NEW.company_id IS NOT NULL
        -- E quando não é soft delete
        AND NEW.deleted_at IS NULL
    )
    EXECUTE FUNCTION sync_lead_to_chat_contacts();

-- =====================================================
-- 3. COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION sync_lead_to_chat_contacts() IS 
'Sincroniza automaticamente nomes de leads para chat_contacts quando lead é editado. Implementação segura com logs e validações.';

COMMENT ON TRIGGER sync_lead_name_trigger ON leads IS 
'Trigger automático para sincronização leads → chat_contacts. Executa apenas quando nome muda e com validações de segurança.';

-- =====================================================
-- 4. VERIFICAÇÃO DE SEGURANÇA
-- =====================================================

-- Verificar se trigger foi criado corretamente
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'sync_lead_name_trigger' 
        AND tgrelid = 'leads'::regclass
    ) THEN
        RAISE NOTICE 'SUCCESS: Trigger sync_lead_name_trigger criado com sucesso';
    ELSE
        RAISE EXCEPTION 'ERROR: Falha ao criar trigger sync_lead_name_trigger';
    END IF;
END $$;

-- =====================================================
-- 5. INSTRUÇÕES DE USO
-- =====================================================

/*
COMO TESTAR:
1. Editar um lead existente que tem chat_contacts
2. Verificar logs no console do Supabase
3. Confirmar que chat_contacts foi atualizado

COMO REVERTER (se necessário):
DROP TRIGGER IF EXISTS sync_lead_name_trigger ON leads;
DROP FUNCTION IF EXISTS sync_lead_to_chat_contacts();

MONITORAMENTO:
- Logs automáticos via RAISE NOTICE
- Verificar ROW_COUNT para confirmar atualizações
- Trigger só executa quando necessário (performance)
*/

-- =====================================================
-- FIM DA MIGRAÇÃO 005
-- =====================================================

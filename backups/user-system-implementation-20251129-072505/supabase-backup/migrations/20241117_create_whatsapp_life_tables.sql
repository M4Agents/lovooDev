-- =====================================================
-- WHATSAPP LIFE - SISTEMA DE INSTÂNCIAS ISOLADO
-- =====================================================
-- Criado em: 17/11/2024
-- Objetivo: Sistema isolado para gerenciar instâncias WhatsApp via Uazapi
-- Isolamento: Prefixo whatsapp_life_ para evitar conflitos

-- =====================================================
-- TABELA PRINCIPAL: whatsapp_life_instances
-- =====================================================
CREATE TABLE IF NOT EXISTS whatsapp_life_instances (
    -- Identificadores
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Dados da instância (visíveis ao usuário)
    instance_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    profile_name VARCHAR(100),
    profile_picture_url TEXT,
    
    -- Status da conexão
    status VARCHAR(20) DEFAULT 'disconnected' 
        CHECK (status IN ('disconnected', 'connecting', 'connected', 'error', 'qr_pending')),
    
    -- Dados técnicos (ocultos do usuário)
    provider_type VARCHAR(20) DEFAULT 'uazapi' NOT NULL,
    provider_instance_id VARCHAR(100), -- ID da instância no Uazapi
    provider_token TEXT, -- Token específico da instância
    qr_code TEXT, -- QR Code em base64
    qr_expires_at TIMESTAMP, -- Expiração do QR Code
    
    -- Timestamps
    connected_at TIMESTAMP,
    last_activity_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(company_id, instance_name),
    UNIQUE(provider_instance_id)
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_whatsapp_life_instances_company 
    ON whatsapp_life_instances(company_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_life_instances_status 
    ON whatsapp_life_instances(status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_life_instances_provider 
    ON whatsapp_life_instances(provider_instance_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE whatsapp_life_instances ENABLE ROW LEVEL SECURITY;

-- Política: Cada empresa vê apenas suas próprias instâncias
CREATE POLICY whatsapp_life_instances_company_isolation 
    ON whatsapp_life_instances 
    FOR ALL 
    USING (
        company_id IN (
            SELECT c.id 
            FROM companies c 
            WHERE c.user_id = auth.uid()
        )
    );

-- =====================================================
-- TRIGGER PARA UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_whatsapp_life_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_whatsapp_life_instances_updated_at
    BEFORE UPDATE ON whatsapp_life_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_life_instances_updated_at();

-- =====================================================
-- RPC FUNCTION: Verificar Limites do Plano
-- =====================================================
CREATE OR REPLACE FUNCTION check_whatsapp_life_plan_limit(
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_count INTEGER;
    v_plan_limit INTEGER;
    v_plan_type TEXT;
BEGIN
    -- Buscar plano da empresa
    SELECT plan INTO v_plan_type 
    FROM companies 
    WHERE id = p_company_id;
    
    -- Definir limite baseado no plano
    v_plan_limit := CASE COALESCE(v_plan_type, 'basic')
        WHEN 'start' THEN 3
        WHEN 'professional' THEN 10
        WHEN 'pro' THEN 10
        WHEN 'enterprise' THEN 50
        ELSE 1 -- basic ou qualquer outro
    END;
    
    -- Contar instâncias ativas (não desconectadas)
    SELECT COUNT(*) INTO v_current_count
    FROM whatsapp_life_instances
    WHERE company_id = p_company_id
        AND status != 'disconnected';
    
    RETURN jsonb_build_object(
        'canAdd', v_current_count < v_plan_limit,
        'currentCount', v_current_count,
        'maxAllowed', v_plan_limit,
        'planType', COALESCE(v_plan_type, 'basic'),
        'remaining', GREATEST(0, v_plan_limit - v_current_count)
    );
END;
$$;

-- =====================================================
-- RPC FUNCTION: Criar Nova Instância (ANTI-CORS)
-- =====================================================
CREATE OR REPLACE FUNCTION create_whatsapp_life_instance_rpc(
    p_company_id UUID,
    p_instance_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_response JSONB;
BEGIN
    -- Verificar se o usuário tem acesso à empresa
    SELECT user_id INTO v_user_id 
    FROM companies 
    WHERE id = p_company_id;
    
    IF v_user_id != auth.uid() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Acesso negado à empresa'
        );
    END IF;
    
    -- Chamar Edge Function isolada (Anti-CORS)
    SELECT content::jsonb INTO v_response
    FROM http((
        'POST',
        current_setting('app.supabase_url') || '/functions/v1/whatsapp-life-create-instance',
        ARRAY[
            http_header('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
            http_header('Content-Type', 'application/json')
        ],
        'application/json',
        jsonb_build_object(
            'company_id', p_company_id,
            'instance_name', p_instance_name
        )::text
    ));
    
    RETURN COALESCE(v_response, jsonb_build_object(
        'success', false,
        'error', 'Erro ao chamar Edge Function'
    ));
END;
$$;

-- =====================================================
-- RPC FUNCTION: Obter QR Code (ANTI-CORS)
-- =====================================================
CREATE OR REPLACE FUNCTION get_whatsapp_life_qrcode_rpc(
    p_instance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
    v_user_id UUID;
    v_response JSONB;
BEGIN
    -- Verificar se a instância existe e o usuário tem acesso
    SELECT wi.company_id, c.user_id 
    INTO v_company_id, v_user_id
    FROM whatsapp_life_instances wi
    JOIN companies c ON c.id = wi.company_id
    WHERE wi.id = p_instance_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância não encontrada'
        );
    END IF;
    
    IF v_user_id != auth.uid() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Acesso negado'
        );
    END IF;
    
    -- Chamar Edge Function isolada (Anti-CORS)
    SELECT content::jsonb INTO v_response
    FROM http((
        'POST',
        current_setting('app.supabase_url') || '/functions/v1/whatsapp-life-get-qrcode',
        ARRAY[
            http_header('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
            http_header('Content-Type', 'application/json')
        ],
        'application/json',
        jsonb_build_object('instance_id', p_instance_id)::text
    ));
    
    RETURN COALESCE(v_response, jsonb_build_object(
        'success', false,
        'error', 'Erro ao chamar Edge Function'
    ));
END;
$$;

-- =====================================================
-- RPC FUNCTION: Criar Nova Instância (BANCO APENAS)
-- =====================================================
-- Esta função é chamada apenas pelas Edge Functions
CREATE OR REPLACE FUNCTION create_whatsapp_life_instance(
    p_company_id UUID,
    p_instance_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_check JSONB;
    v_instance_id UUID;
BEGIN
    -- Verificar limite do plano
    SELECT check_whatsapp_life_plan_limit(p_company_id) INTO v_plan_check;
    
    IF NOT (v_plan_check ->> 'canAdd')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Limite de instâncias atingido para seu plano',
            'planInfo', v_plan_check
        );
    END IF;
    
    -- Verificar se já existe instância com mesmo nome
    IF EXISTS (
        SELECT 1 FROM whatsapp_life_instances 
        WHERE company_id = p_company_id 
        AND instance_name = p_instance_name
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Já existe uma instância com este nome'
        );
    END IF;
    
    -- Criar instância
    INSERT INTO whatsapp_life_instances (
        company_id,
        instance_name,
        status
    ) VALUES (
        p_company_id,
        p_instance_name,
        'connecting'
    ) RETURNING id INTO v_instance_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'instanceId', v_instance_id,
        'message', 'Instância criada com sucesso'
    );
END;
$$;

-- =====================================================
-- RPC FUNCTION: Atualizar Status da Instância
-- =====================================================
CREATE OR REPLACE FUNCTION update_whatsapp_life_instance_status(
    p_instance_id UUID,
    p_status TEXT,
    p_qr_code TEXT DEFAULT NULL,
    p_phone_number TEXT DEFAULT NULL,
    p_profile_name TEXT DEFAULT NULL,
    p_profile_picture_url TEXT DEFAULT NULL,
    p_provider_instance_id TEXT DEFAULT NULL,
    p_provider_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
    v_user_id UUID;
BEGIN
    -- Verificar se a instância existe e o usuário tem acesso
    SELECT wi.company_id, c.user_id 
    INTO v_company_id, v_user_id
    FROM whatsapp_life_instances wi
    JOIN companies c ON c.id = wi.company_id
    WHERE wi.id = p_instance_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância não encontrada'
        );
    END IF;
    
    IF v_user_id != auth.uid() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Acesso negado'
        );
    END IF;
    
    -- Atualizar instância
    UPDATE whatsapp_life_instances SET
        status = p_status,
        qr_code = COALESCE(p_qr_code, qr_code),
        phone_number = COALESCE(p_phone_number, phone_number),
        profile_name = COALESCE(p_profile_name, profile_name),
        profile_picture_url = COALESCE(p_profile_picture_url, profile_picture_url),
        provider_instance_id = COALESCE(p_provider_instance_id, provider_instance_id),
        provider_token = COALESCE(p_provider_token, provider_token),
        connected_at = CASE WHEN p_status = 'connected' THEN NOW() ELSE connected_at END,
        last_activity_at = NOW(),
        qr_expires_at = CASE WHEN p_qr_code IS NOT NULL THEN NOW() + INTERVAL '5 minutes' ELSE qr_expires_at END
    WHERE id = p_instance_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Status atualizado com sucesso'
    );
END;
$$;

-- =====================================================
-- RPC FUNCTION: Deletar Instância
-- =====================================================
CREATE OR REPLACE FUNCTION delete_whatsapp_life_instance(
    p_instance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
    v_user_id UUID;
BEGIN
    -- Verificar se a instância existe e o usuário tem acesso
    SELECT wi.company_id, c.user_id 
    INTO v_company_id, v_user_id
    FROM whatsapp_life_instances wi
    JOIN companies c ON c.id = wi.company_id
    WHERE wi.id = p_instance_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Instância não encontrada'
        );
    END IF;
    
    IF v_user_id != auth.uid() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Acesso negado'
        );
    END IF;
    
    -- Deletar instância
    DELETE FROM whatsapp_life_instances 
    WHERE id = p_instance_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Instância deletada com sucesso'
    );
END;
$$;

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE whatsapp_life_instances IS 'Tabela isolada para gerenciar instâncias WhatsApp via Uazapi';
COMMENT ON COLUMN whatsapp_life_instances.provider_type IS 'Tipo do provider (uazapi, cloud-api, etc)';
COMMENT ON COLUMN whatsapp_life_instances.provider_instance_id IS 'ID da instância no provider externo';
COMMENT ON COLUMN whatsapp_life_instances.provider_token IS 'Token específico da instância (criptografado)';
COMMENT ON COLUMN whatsapp_life_instances.qr_code IS 'QR Code em base64 para conexão';
COMMENT ON COLUMN whatsapp_life_instances.status IS 'Status: disconnected, connecting, connected, error, qr_pending';

-- =====================================================
-- MIGRAÇÃO: Sistema de Gestão de Planos
-- =====================================================
-- Data: 18/11/2024
-- Descrição: Criar tabela e RPCs para gestão de planos

-- =====================================================
-- TABELA: plans
-- =====================================================
CREATE TABLE IF NOT EXISTS plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'BRL',
    billing_cycle VARCHAR(20) DEFAULT 'monthly', -- monthly, yearly, lifetime
    max_whatsapp_instances INTEGER NOT NULL DEFAULT 1,
    max_landing_pages INTEGER DEFAULT NULL, -- NULL = ilimitado
    max_leads INTEGER DEFAULT NULL, -- NULL = ilimitado
    max_users INTEGER DEFAULT NULL, -- NULL = ilimitado
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- =====================================================
-- ÍNDICES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_plans_sort_order ON plans(sort_order);

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Política: Apenas super admins podem gerenciar planos
CREATE POLICY "Super admins can manage plans" ON plans
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM companies c
            WHERE c.user_id = auth.uid()
            AND c.is_super_admin = true
        )
    );

-- =====================================================
-- TRIGGER: Updated At
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_plans_updated_at 
    BEFORE UPDATE ON plans 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- DADOS INICIAIS: Planos Padrão
-- =====================================================
INSERT INTO plans (name, slug, description, price, max_whatsapp_instances, features, sort_order, is_active) VALUES
('Básico', 'basic', 'Plano gratuito para começar', 0.00, 1, '["1 número WhatsApp", "Suporte básico", "Dashboard básico"]'::jsonb, 1, true),
('Starter', 'start', 'Ideal para pequenos negócios', 97.00, 3, '["3 números WhatsApp", "Chat básico", "Suporte por email", "Relatórios básicos"]'::jsonb, 2, true),
('Profissional', 'professional', 'Para empresas em crescimento', 297.00, 10, '["10 números WhatsApp", "Chat avançado", "Automações", "Suporte prioritário", "Relatórios avançados"]'::jsonb, 3, true),
('Pro', 'pro', 'Versão Pro completa', 297.00, 10, '["10 números WhatsApp", "Chat avançado", "Automações", "Suporte prioritário", "API básica"]'::jsonb, 4, true),
('Enterprise', 'enterprise', 'Solução completa para grandes empresas', 897.00, 50, '["50 números WhatsApp", "Recursos completos", "API personalizada", "Suporte 24/7", "White-label", "Integrações customizadas"]'::jsonb, 5, true)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- RPC: Listar Planos
-- =====================================================
CREATE OR REPLACE FUNCTION get_plans()
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    slug VARCHAR,
    description TEXT,
    price DECIMAL,
    currency VARCHAR,
    billing_cycle VARCHAR,
    max_whatsapp_instances INTEGER,
    max_landing_pages INTEGER,
    max_leads INTEGER,
    max_users INTEGER,
    features JSONB,
    is_active BOOLEAN,
    is_popular BOOLEAN,
    sort_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verificar se é super admin
    IF NOT EXISTS (
        SELECT 1 FROM companies c
        WHERE c.user_id = auth.uid()
        AND c.is_super_admin = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas super admins podem acessar planos';
    END IF;

    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.slug,
        p.description,
        p.price,
        p.currency,
        p.billing_cycle,
        p.max_whatsapp_instances,
        p.max_landing_pages,
        p.max_leads,
        p.max_users,
        p.features,
        p.is_active,
        p.is_popular,
        p.sort_order,
        p.created_at,
        p.updated_at
    FROM plans p
    ORDER BY p.sort_order ASC, p.name ASC;
END;
$$;

-- =====================================================
-- RPC: Criar Plano
-- =====================================================
CREATE OR REPLACE FUNCTION create_plan(
    p_name VARCHAR,
    p_slug VARCHAR,
    p_description TEXT DEFAULT NULL,
    p_price DECIMAL DEFAULT 0,
    p_currency VARCHAR DEFAULT 'BRL',
    p_billing_cycle VARCHAR DEFAULT 'monthly',
    p_max_whatsapp_instances INTEGER DEFAULT 1,
    p_max_landing_pages INTEGER DEFAULT NULL,
    p_max_leads INTEGER DEFAULT NULL,
    p_max_users INTEGER DEFAULT NULL,
    p_features JSONB DEFAULT '[]'::jsonb,
    p_is_active BOOLEAN DEFAULT true,
    p_is_popular BOOLEAN DEFAULT false,
    p_sort_order INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_id UUID;
BEGIN
    -- Verificar se é super admin
    IF NOT EXISTS (
        SELECT 1 FROM companies c
        WHERE c.user_id = auth.uid()
        AND c.is_super_admin = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas super admins podem criar planos';
    END IF;

    -- Inserir novo plano
    INSERT INTO plans (
        name, slug, description, price, currency, billing_cycle,
        max_whatsapp_instances, max_landing_pages, max_leads, max_users,
        features, is_active, is_popular, sort_order, created_by
    ) VALUES (
        p_name, p_slug, p_description, p_price, p_currency, p_billing_cycle,
        p_max_whatsapp_instances, p_max_landing_pages, p_max_leads, p_max_users,
        p_features, p_is_active, p_is_popular, p_sort_order, auth.uid()
    ) RETURNING id INTO v_plan_id;

    RETURN jsonb_build_object(
        'success', true,
        'plan_id', v_plan_id,
        'message', 'Plano criado com sucesso'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Já existe um plano com este nome ou slug'
        );
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- =====================================================
-- RPC: Atualizar Plano
-- =====================================================
CREATE OR REPLACE FUNCTION update_plan(
    p_plan_id UUID,
    p_name VARCHAR DEFAULT NULL,
    p_slug VARCHAR DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,
    p_currency VARCHAR DEFAULT NULL,
    p_billing_cycle VARCHAR DEFAULT NULL,
    p_max_whatsapp_instances INTEGER DEFAULT NULL,
    p_max_landing_pages INTEGER DEFAULT NULL,
    p_max_leads INTEGER DEFAULT NULL,
    p_max_users INTEGER DEFAULT NULL,
    p_features JSONB DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL,
    p_is_popular BOOLEAN DEFAULT NULL,
    p_sort_order INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verificar se é super admin
    IF NOT EXISTS (
        SELECT 1 FROM companies c
        WHERE c.user_id = auth.uid()
        AND c.is_super_admin = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas super admins podem atualizar planos';
    END IF;

    -- Atualizar plano
    UPDATE plans SET
        name = COALESCE(p_name, name),
        slug = COALESCE(p_slug, slug),
        description = COALESCE(p_description, description),
        price = COALESCE(p_price, price),
        currency = COALESCE(p_currency, currency),
        billing_cycle = COALESCE(p_billing_cycle, billing_cycle),
        max_whatsapp_instances = COALESCE(p_max_whatsapp_instances, max_whatsapp_instances),
        max_landing_pages = COALESCE(p_max_landing_pages, max_landing_pages),
        max_leads = COALESCE(p_max_leads, max_leads),
        max_users = COALESCE(p_max_users, max_users),
        features = COALESCE(p_features, features),
        is_active = COALESCE(p_is_active, is_active),
        is_popular = COALESCE(p_is_popular, is_popular),
        sort_order = COALESCE(p_sort_order, sort_order),
        updated_by = auth.uid()
    WHERE id = p_plan_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Plano não encontrado'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Plano atualizado com sucesso'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Já existe um plano com este nome ou slug'
        );
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- =====================================================
-- RPC: Deletar Plano
-- =====================================================
CREATE OR REPLACE FUNCTION delete_plan(p_plan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_companies_count INTEGER;
BEGIN
    -- Verificar se é super admin
    IF NOT EXISTS (
        SELECT 1 FROM companies c
        WHERE c.user_id = auth.uid()
        AND c.is_super_admin = true
    ) THEN
        RAISE EXCEPTION 'Acesso negado: apenas super admins podem deletar planos';
    END IF;

    -- Verificar se existem empresas usando este plano
    SELECT COUNT(*) INTO v_companies_count
    FROM companies
    WHERE plan = (SELECT slug FROM plans WHERE id = p_plan_id);

    IF v_companies_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Não é possível deletar: %s empresas estão usando este plano', v_companies_count)
        );
    END IF;

    -- Deletar plano
    DELETE FROM plans WHERE id = p_plan_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Plano não encontrado'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Plano deletado com sucesso'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- =====================================================
-- COMENTÁRIOS
-- =====================================================
COMMENT ON TABLE plans IS 'Tabela para gestão de planos da plataforma';
COMMENT ON COLUMN plans.slug IS 'Identificador único do plano (usado no campo plan das companies)';
COMMENT ON COLUMN plans.max_whatsapp_instances IS 'Número máximo de instâncias WhatsApp permitidas';
COMMENT ON COLUMN plans.features IS 'Array JSON com lista de funcionalidades do plano';
COMMENT ON COLUMN plans.billing_cycle IS 'Ciclo de cobrança: monthly, yearly, lifetime';

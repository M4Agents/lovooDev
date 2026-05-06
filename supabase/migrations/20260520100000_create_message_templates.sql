-- =============================================================================
-- Migration: create_message_templates
-- Data: 2026-05-20
--
-- Cria o sistema de Modelos de Mensagens (Fase 1 — somente texto).
--
-- O que esta migration faz:
--   1. CREATE message_template_categories   — categorias globais (system) e por empresa (custom)
--   2. CREATE message_templates             — templates de mensagem por empresa e canal
--   3. Triggers de proteção                — campos imutáveis + validação cross-tenant
--   4. Seeds de categorias padrão globais  — Vendas, Suporte, Atendimento (idempotentes)
--   5. Indexes + constraints únicos        — sem duplicidade de nomes por escopo
--   6. Trigger updated_at                  — message_templates
--   7. RLS completa                        — ambas as tabelas
--
-- O que esta migration NÃO faz (por design):
--   ✗ NÃO cria colunas de mídia (media_url, media_type) — reservado para Fase 3
--   ✗ NÃO cria endpoints de API
--   ✗ NÃO cria componentes frontend
--   ✗ NÃO altera tabelas existentes
--   ✗ NÃO permite channel = 'whatsapp_official_api' (CHECK constraint)
--
-- Segurança:
--   - UNIQUE parcial em name/company_id para categorias (seeds idempotentes)
--   - Trigger validate_message_template_category: bloqueia cross-tenant em INSERT e UPDATE
--     (dispara em category_id OU company_id para cobrir ambos os vetores de ataque)
--   - Trigger protect_message_template_category_fields: is_system e company_id imutáveis
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. message_template_categories
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.message_template_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  is_system   boolean     NOT NULL DEFAULT false,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mtc_name_nonempty
    CHECK (length(trim(name)) > 0),

  -- Garante consistência: system sempre sem empresa, custom sempre com empresa.
  CONSTRAINT mtc_system_requires_null_company
    CHECK (
      (is_system = true  AND company_id IS NULL)
      OR
      (is_system = false AND company_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.message_template_categories IS
  'Categorias de modelos de mensagem. '
  'system (is_system=true, company_id=NULL): globais, imutáveis para clientes, criadas via migration. '
  'custom (is_system=false, company_id IS NOT NULL): criadas por admins de cada empresa, isoladas por tenant. '
  'is_system e company_id são imutáveis após criação (trigger protect_message_template_category_fields).';

COMMENT ON COLUMN public.message_template_categories.company_id IS
  'NULL para categorias do sistema (globais). UUID da empresa para categorias customizadas.';

COMMENT ON COLUMN public.message_template_categories.is_system IS
  'true = categoria padrão da plataforma, imutável para clientes. '
  'false = categoria criada pelo admin da empresa. Imutável após criação.';

-- UNIQUE parcial: sem duplicidade de nome entre categorias system
-- Necessário para que ON CONFLICT nos seeds funcione corretamente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtc_system_name
  ON public.message_template_categories (lower(name))
  WHERE is_system = true;

-- UNIQUE parcial: sem duplicidade de nome por empresa nas categorias custom
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtc_custom_company_name
  ON public.message_template_categories (company_id, lower(name))
  WHERE is_system = false;

-- Índice de performance
CREATE INDEX IF NOT EXISTS idx_mtc_company
  ON public.message_template_categories (company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mtc_system_active
  ON public.message_template_categories (is_system, is_active);


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. message_templates
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.message_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category_id uuid        REFERENCES public.message_template_categories(id) ON DELETE SET NULL,
  name        text        NOT NULL,
  content     text        NOT NULL,
  channel     text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Fase 1: apenas whatsapp_life.
  -- Fase 4: alterar para CHECK (channel IN ('whatsapp_life', 'whatsapp_official_api'))
  -- quando Cloud API estiver implementada.
  -- O backend também rejeita whatsapp_official_api com HTTP 422 (dupla proteção).
  CONSTRAINT mt_channel_check
    CHECK (channel IN ('whatsapp_life')),

  CONSTRAINT mt_name_nonempty
    CHECK (length(trim(name)) > 0),

  CONSTRAINT mt_content_nonempty
    CHECK (length(trim(content)) > 0)
);

COMMENT ON TABLE public.message_templates IS
  'Modelos de mensagem por empresa para uso no chat via acionamento por "/". '
  'Fase 1: somente texto. Fase 3: migration dedicada adicionará media_url e media_type. '
  'channel = whatsapp_life apenas (CHECK). Backend também rejeita whatsapp_official_api com 422. '
  'category_id validado por trigger: NULL ou system ou custom da mesma empresa (nunca cross-tenant).';

COMMENT ON COLUMN public.message_templates.channel IS
  'Canal de envio do template. Fase 1: apenas whatsapp_life. '
  'Fase 4: migration ajustará o CHECK quando Cloud API estiver implementada.';

COMMENT ON COLUMN public.message_templates.content IS
  'Texto puro do template. Fase 1: sem suporte a mídia. '
  'Fase 3: migration adicionará media_url TEXT e media_type TEXT (nullable).';

COMMENT ON COLUMN public.message_templates.category_id IS
  'FK para message_template_categories. ON DELETE SET NULL. '
  'Validado por trigger: NULL (sem categoria), system (global, qualquer empresa) ou '
  'custom somente se category.company_id = template.company_id (nunca cross-tenant).';

CREATE INDEX IF NOT EXISTS idx_mt_company_active
  ON public.message_templates (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_mt_company_channel
  ON public.message_templates (company_id, channel, is_active);

CREATE INDEX IF NOT EXISTS idx_mt_category
  ON public.message_templates (category_id)
  WHERE category_id IS NOT NULL;

-- Trigger updated_at (função consolidada já existente no banco)
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. TRIGGER: protect_message_template_category_fields
--
-- Protege is_system e company_id de alterações após criação.
-- Aplica-se a categorias system E custom.
-- Segue o padrão de protect_internal_note_immutable_fields.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_message_template_category_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- is_system é imutável após criação
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION
      'message_template_categories: is_system é imutável após criação. Operação bloqueada.';
  END IF;

  -- company_id é imutável após criação
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION
      'message_template_categories: company_id é imutável após criação. Operação bloqueada.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_message_template_category_fields() IS
  'Trigger BEFORE UPDATE em message_template_categories. '
  'Bloqueia alterações em is_system e company_id após criação para qualquer operação, '
  'inclusive via service_role. Segue padrão de protect_internal_note_immutable_fields.';

CREATE TRIGGER mtc_protect_immutable_fields
  BEFORE UPDATE ON public.message_template_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_message_template_category_fields();


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. TRIGGER: validate_message_template_category
--
-- Valida category_id em INSERT e UPDATE de message_templates.
-- Dispara em category_id OU company_id para cobrir dois vetores:
--   - Mudança de category_id para categoria de outra empresa
--   - Mudança de company_id para empresa diferente da categoria custom vinculada
--
-- Regras:
--   - NULL: sempre permitido
--   - categoria system (is_system=true): permitida para qualquer empresa
--   - categoria custom (is_system=false): apenas se category.company_id = template.company_id
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.validate_message_template_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_cat_company_id  uuid;
  v_cat_is_system   boolean;
BEGIN
  -- NULL é sempre permitido: template sem categoria é válido
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Buscar dados da categoria referenciada
  SELECT company_id, is_system
    INTO v_cat_company_id, v_cat_is_system
    FROM public.message_template_categories
   WHERE id = NEW.category_id;

  -- Categoria deve existir
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'message_templates: category_id % não encontrado. Operação bloqueada.',
      NEW.category_id;
  END IF;

  -- Categoria system: permitida para qualquer empresa
  IF v_cat_is_system = true THEN
    RETURN NEW;
  END IF;

  -- Categoria custom: deve pertencer à mesma empresa do template
  IF v_cat_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'message_templates: category_id % pertence a outra empresa (cross-tenant bloqueado). Operação bloqueada.',
      NEW.category_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_message_template_category() IS
  'Trigger BEFORE INSERT OR UPDATE OF category_id, company_id em message_templates. '
  'Dispara em category_id OU company_id: cobre troca de categoria cross-tenant '
  'e troca de company_id com categoria custom vinculada. '
  'Regras: NULL=permitido, system=qualquer empresa, custom=mesma company_id apenas.';

-- Dispara em INSERT e UPDATE de category_id OU company_id:
-- cobre os dois vetores de violação cross-tenant.
CREATE TRIGGER mt_validate_category
  BEFORE INSERT OR UPDATE OF category_id, company_id ON public.message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_message_template_category();


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Seeds: categorias padrão globais
--
-- ON CONFLICT referencia o índice parcial uq_mtc_system_name.
-- Idempotente: múltiplas execuções não duplicam nem falham.
-- company_id omitido (NULL por default) — satisfaz mtc_system_requires_null_company.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.message_template_categories (name, is_system, sort_order, is_active)
VALUES
  ('Vendas',      true, 1, true),
  ('Suporte',     true, 2, true),
  ('Atendimento', true, 3, true)
ON CONFLICT (lower(name)) WHERE is_system = true DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RLS — message_template_categories
--
-- NOTA: auth_user_is_company_member/admin retornam false (sem exceção)
-- para company_id NULL. Por isso policies tratam is_system=true
-- como cláusula independente, sem passar NULL para os helpers.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.message_template_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mtc_select"
  ON public.message_template_categories
  FOR SELECT
  TO authenticated
  USING (
    is_system = true
    OR (
      company_id IS NOT NULL
      AND public.auth_user_is_company_member(company_id)
    )
  );

COMMENT ON POLICY "mtc_select" ON public.message_template_categories IS
  'SELECT: categorias system visíveis para qualquer autenticado. '
  'Categorias custom visíveis apenas para membros ativos da empresa. '
  'Nunca passa NULL para auth_user_is_company_member.';

CREATE POLICY "mtc_insert"
  ON public.message_template_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_system = false
    AND company_id IS NOT NULL
    AND public.auth_user_is_company_admin(company_id)
  );

COMMENT ON POLICY "mtc_insert" ON public.message_template_categories IS
  'INSERT apenas para categorias custom por admins da empresa. '
  'is_system=true bloqueado — clientes nunca criam categorias system.';

CREATE POLICY "mtc_update"
  ON public.message_template_categories
  FOR UPDATE
  TO authenticated
  USING (
    is_system = false
    AND company_id IS NOT NULL
    AND public.auth_user_is_company_admin(company_id)
  )
  WITH CHECK (
    is_system = false
    AND company_id IS NOT NULL
    AND public.auth_user_is_company_admin(company_id)
  );

COMMENT ON POLICY "mtc_update" ON public.message_template_categories IS
  'UPDATE apenas para categorias custom da empresa por admins. '
  'Categorias system bloqueadas aqui e pelo trigger de imutabilidade.';

CREATE POLICY "mtc_delete"
  ON public.message_template_categories
  FOR DELETE
  TO authenticated
  USING (
    is_system = false
    AND company_id IS NOT NULL
    AND public.auth_user_is_company_admin(company_id)
  );

COMMENT ON POLICY "mtc_delete" ON public.message_template_categories IS
  'DELETE apenas para categorias custom da empresa por admins. '
  'Categorias system: exclusão apenas via service_role (migration).';


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. RLS — message_templates
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mt_select"
  ON public.message_templates
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_company_member(company_id));

COMMENT ON POLICY "mt_select" ON public.message_templates IS
  'SELECT para qualquer membro ativo da empresa (todos os roles). '
  'Usado pelo chat (picker "/") e pela tela de Configurações.';

CREATE POLICY "mt_insert"
  ON public.message_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.auth_user_is_company_admin(company_id));

COMMENT ON POLICY "mt_insert" ON public.message_templates IS
  'INSERT apenas por admins (admin, system_admin, super_admin) da empresa.';

CREATE POLICY "mt_update"
  ON public.message_templates
  FOR UPDATE
  TO authenticated
  USING  (public.auth_user_is_company_admin(company_id))
  WITH CHECK (public.auth_user_is_company_admin(company_id));

COMMENT ON POLICY "mt_update" ON public.message_templates IS
  'UPDATE apenas por admins da empresa. '
  'USING + WITH CHECK: admin não pode alterar company_id para outra empresa.';

CREATE POLICY "mt_delete"
  ON public.message_templates
  FOR DELETE
  TO authenticated
  USING (public.auth_user_is_company_admin(company_id));

COMMENT ON POLICY "mt_delete" ON public.message_templates IS
  'DELETE apenas por admins da empresa. Preferir is_active=false (soft delete).';


-- ══════════════════════════════════════════════════════════════════════════════
-- 8. VERIFICAÇÃO FINAL
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cats_exists       boolean;
  v_temps_exists      boolean;
  v_system_seeds      integer;
  v_uq_system_exists  boolean;
  v_uq_custom_exists  boolean;
  v_trigger_cat       boolean;
  v_trigger_validate  boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'message_template_categories'
  ) INTO v_cats_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'message_templates'
  ) INTO v_temps_exists;

  IF NOT v_cats_exists THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: tabela message_template_categories não foi criada.';
  END IF;

  IF NOT v_temps_exists THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: tabela message_templates não foi criada.';
  END IF;

  SELECT COUNT(*) INTO v_system_seeds
    FROM public.message_template_categories WHERE is_system = true;

  IF v_system_seeds < 3 THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: seeds incompletas (esperado >= 3, encontrado %).', v_system_seeds;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_mtc_system_name'
  ) INTO v_uq_system_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_mtc_custom_company_name'
  ) INTO v_uq_custom_exists;

  IF NOT v_uq_system_exists THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: índice uq_mtc_system_name não encontrado.';
  END IF;

  IF NOT v_uq_custom_exists THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: índice uq_mtc_custom_company_name não encontrado.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'mtc_protect_immutable_fields'
  ) INTO v_trigger_cat;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'mt_validate_category'
  ) INTO v_trigger_validate;

  IF NOT v_trigger_cat THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: trigger mtc_protect_immutable_fields não encontrado.';
  END IF;

  IF NOT v_trigger_validate THEN
    RAISE EXCEPTION 'MESSAGE_TEMPLATES: trigger mt_validate_category não encontrado.';
  END IF;

  RAISE LOG '=== create_message_templates aplicada com sucesso ===';
  RAISE LOG '  message_template_categories: criada (RLS, índices únicos parciais, trigger imutabilidade)';
  RAISE LOG '  message_templates:           criada (RLS, índices, trigger updated_at, trigger validação cross-tenant)';
  RAISE LOG '  categorias system (seeds):   % registros (Vendas, Suporte, Atendimento)', v_system_seeds;
  RAISE LOG '  trigger mt_validate_category: BEFORE INSERT OR UPDATE OF category_id, company_id';
  RAISE LOG '  channel bloqueado:           whatsapp_official_api (CHECK constraint)';
  RAISE LOG '  colunas de mídia:            NÃO criadas (Fase 3)';
  RAISE LOG '  nenhuma tabela existente foi alterada';
END;
$$;

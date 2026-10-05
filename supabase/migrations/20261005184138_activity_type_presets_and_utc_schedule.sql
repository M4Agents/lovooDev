-- NÃO APLICAR sem autorização explícita.
-- O banco é compartilhado com produção. Este arquivo só prepara a mudança.
-- Não reprocessa atividades já gravadas.

-- Colunas de regra. NULL significa que aquele campo não entra no formulário.
ALTER TABLE public.custom_activity_types
  ADD COLUMN preset_title text,
  ADD COLUMN preset_description text,
  ADD COLUMN preset_offset_hours integer,
  ADD COLUMN preset_offset_minutes integer,
  ADD COLUMN preset_duration_minutes integer,
  ADD COLUMN preset_reminder_minutes integer;

ALTER TABLE public.custom_activity_types
  ADD CONSTRAINT custom_activity_types_preset_offset_hours_check
    CHECK (preset_offset_hours IS NULL OR preset_offset_hours >= 0),
  ADD CONSTRAINT custom_activity_types_preset_offset_minutes_check
    CHECK (preset_offset_minutes IS NULL OR (preset_offset_minutes >= 0 AND preset_offset_minutes <= 59)),
  ADD CONSTRAINT custom_activity_types_preset_offset_total_check
    CHECK (COALESCE(preset_offset_hours, 0) * 60 + COALESCE(preset_offset_minutes, 0) <= 525600),
  ADD CONSTRAINT custom_activity_types_preset_duration_check
    CHECK (preset_duration_minutes IS NULL OR preset_duration_minutes IN (15, 30, 45, 60, 90, 120, 180)),
  ADD CONSTRAINT custom_activity_types_preset_reminder_check
    CHECK (preset_reminder_minutes IS NULL OR preset_reminder_minutes IN (0, 5, 15, 30, 60, 1440));

COMMENT ON COLUMN public.custom_activity_types.preset_offset_hours IS
  'Horas do prazo a partir de agora. NULL não altera a data quando os minutos também são NULL. Inteiro a partir de zero. O total com os minutos não passa de 365 dias.';
COMMENT ON COLUMN public.custom_activity_types.preset_offset_minutes IS
  'Minutos do prazo. NULL não altera a data quando as horas também são NULL. 0 a 59.';

-- A permissão ampla de INSERT/UPDATE cobre coluna nova.
-- Revoga a permissão da tabela e devolve só as colunas que os fluxos atuais gravam.
REVOKE INSERT, UPDATE ON TABLE public.custom_activity_types FROM PUBLIC;
REVOKE INSERT, UPDATE ON TABLE public.custom_activity_types FROM anon;
REVOKE INSERT, UPDATE ON TABLE public.custom_activity_types FROM authenticated;
REVOKE INSERT, UPDATE ON TABLE public.custom_activity_types FROM service_role;

GRANT INSERT (
  id, company_id, name, icon, color, display_order, is_active, is_system,
  is_hidden, created_by, created_at, updated_at
), UPDATE (
  id, company_id, name, icon, color, display_order, is_active, is_system,
  is_hidden, created_by, created_at, updated_at
) ON TABLE public.custom_activity_types TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_activity_type_preset(
  p_company_id uuid,
  p_type_id uuid,
  p_preset_title text,
  p_preset_description text,
  p_preset_offset_hours integer,
  p_preset_offset_minutes integer,
  p_preset_duration_minutes integer,
  p_preset_reminder_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_title text;
  v_description text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501',
            HINT = 'Usuário não autenticado.';
  END IF;

  -- Matriz explícita, já consolidada em company_users com is_active.
  -- Empresa: admin, super_admin, system_admin.
  -- Empresa pai: somente super_admin ou system_admin ativos na pai.
  IF NOT (
    public.auth_user_is_company_admin(p_company_id)
    OR public.auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN'
      USING ERRCODE = '42501',
            HINT = 'Apenas admin da empresa ou admin da empresa pai pode gravar a regra.';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_preset_title, '')), '');
  v_description := NULLIF(btrim(COALESCE(p_preset_description, '')), '');

  IF p_preset_offset_hours IS NOT NULL AND p_preset_offset_hours < 0 THEN
    RAISE EXCEPTION 'INVALID_PRESET_OFFSET'
      USING ERRCODE = '22023',
            HINT = 'Horas do prazo devem ser um inteiro a partir de zero.';
  END IF;

  IF p_preset_offset_minutes IS NOT NULL
     AND (p_preset_offset_minutes < 0 OR p_preset_offset_minutes > 59) THEN
    RAISE EXCEPTION 'INVALID_PRESET_OFFSET'
      USING ERRCODE = '22023',
            HINT = 'Minutos do prazo devem ser um inteiro de 0 a 59.';
  END IF;

  IF COALESCE(p_preset_offset_hours, 0) * 60 + COALESCE(p_preset_offset_minutes, 0) > 525600 THEN
    RAISE EXCEPTION 'INVALID_PRESET_OFFSET'
      USING ERRCODE = '22023',
            HINT = 'O prazo não pode passar de 365 dias.';
  END IF;

  IF p_preset_duration_minutes IS NOT NULL
     AND p_preset_duration_minutes NOT IN (15, 30, 45, 60, 90, 120, 180) THEN
    RAISE EXCEPTION 'INVALID_PRESET_DURATION'
      USING ERRCODE = '22023',
            HINT = 'Duração fora das opções do formulário.';
  END IF;

  IF p_preset_reminder_minutes IS NOT NULL
     AND p_preset_reminder_minutes NOT IN (0, 5, 15, 30, 60, 1440) THEN
    RAISE EXCEPTION 'INVALID_PRESET_REMINDER'
      USING ERRCODE = '22023',
            HINT = 'Lembrete fora das opções do formulário. Zero significa sem lembrete.';
  END IF;

  UPDATE public.custom_activity_types
  SET preset_title = v_title,
      preset_description = v_description,
      preset_offset_hours = p_preset_offset_hours,
      preset_offset_minutes = p_preset_offset_minutes,
      preset_duration_minutes = p_preset_duration_minutes,
      preset_reminder_minutes = p_preset_reminder_minutes
  WHERE id = p_type_id
    AND company_id = p_company_id
    AND is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'ACTIVITY_TYPE_NOT_FOUND'
      USING ERRCODE = 'P0002',
            HINT = 'Tipo de atividade não encontrado nesta empresa.';
  END IF;
END;
$$;

ALTER FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer) TO authenticated;

-- O instante passa a ser UTC explícito. Só vale para INSERT e UPDATE de data/hora.
-- Linhas já gravadas não são recalculadas.
CREATE OR REPLACE FUNCTION public.sync_scheduled_datetime()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.scheduled_date IS NOT NULL AND NEW.scheduled_time IS NOT NULL THEN
    NEW.scheduled_datetime = (NEW.scheduled_date + NEW.scheduled_time) AT TIME ZONE 'UTC';
  ELSE
    NEW.scheduled_datetime = NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_scheduled_datetime() OWNER TO postgres;

-- Ocultar tipo de atividade do calendário.
-- is_hidden não apaga o tipo e não altera is_active.
-- Só a função set_activity_type_hidden pode mudar esse campo.

ALTER TABLE public.custom_activity_types
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.custom_activity_types.is_hidden IS
  'Quando true, o tipo não entra nas listas de escolha. Continua visível só no cadastro, para admin.';

CREATE OR REPLACE FUNCTION public.guard_custom_activity_type_hidden()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.activity_type_hide', true) IS DISTINCT FROM 'true' THEN
      NEW.is_hidden := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden
     AND current_setting('app.activity_type_hide', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FORBIDDEN'
      USING ERRCODE = '42501',
            HINT = 'is_hidden só pode ser alterado por set_activity_type_hidden.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_custom_activity_type_hidden ON public.custom_activity_types;
CREATE TRIGGER trg_guard_custom_activity_type_hidden
  BEFORE INSERT OR UPDATE ON public.custom_activity_types
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_custom_activity_type_hidden();

CREATE OR REPLACE FUNCTION public.set_activity_type_hidden(
  p_company_id uuid,
  p_type_id    uuid,
  p_is_hidden  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501',
            HINT = 'Usuário não autenticado.';
  END IF;

  IF NOT (
    auth_user_is_company_admin(p_company_id)
    OR auth_user_is_parent_admin(p_company_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN'
      USING ERRCODE = '42501',
            HINT = 'Apenas admin da empresa ou admin da empresa pai pode ocultar um tipo de atividade.';
  END IF;

  PERFORM set_config('app.activity_type_hide', 'true', true);

  UPDATE public.custom_activity_types
  SET is_hidden = p_is_hidden
  WHERE id = p_type_id
    AND company_id = p_company_id
    AND is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  PERFORM set_config('app.activity_type_hide', 'false', true);

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'ACTIVITY_TYPE_NOT_FOUND'
      USING ERRCODE = 'P0002',
            HINT = 'Tipo de atividade não encontrado nesta empresa.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_activity_type_hidden(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_activity_type_hidden(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_activity_type_hidden(uuid, uuid, boolean) TO authenticated;

-- O gatilho dispara no INSERT/UPDATE do próprio usuário. Sem EXECUTE a gravação falha.
REVOKE ALL ON FUNCTION public.guard_custom_activity_type_hidden() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_custom_activity_type_hidden() TO authenticated, service_role;

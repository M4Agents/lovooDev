-- Rollback da migration já aplicada: 20261005184138_activity_type_presets_and_utc_schedule.
-- NÃO APLICAR junto com a migration. Não executar sem autorização.
-- Restaura só o que a migration muda, com o texto e os privilégios lidos do banco.
-- Excluir as colunas apaga os presets gravados depois da migration.
-- Antes de rodar este arquivo, preserve esses dados. Exemplo, sem executar aqui:
--   COPY (
--     SELECT id, company_id, preset_title, preset_description,
--            preset_offset_hours, preset_offset_minutes,
--            preset_duration_minutes, preset_reminder_minutes
--     FROM public.custom_activity_types
--     WHERE preset_title IS NOT NULL
--        OR preset_description IS NOT NULL
--        OR preset_offset_hours IS NOT NULL
--        OR preset_offset_minutes IS NOT NULL
--        OR preset_duration_minutes IS NOT NULL
--        OR preset_reminder_minutes IS NOT NULL
--   ) TO STDOUT WITH CSV HEADER;

-- A função nova referencia as colunas. Ela sai antes das colunas.
-- Sem CASCADE: se alguma dependência extra existir, o comando para.
DROP FUNCTION IF EXISTS public.set_activity_type_preset(uuid, uuid, text, text, integer, integer, integer, integer);

ALTER TABLE public.custom_activity_types
  DROP CONSTRAINT IF EXISTS custom_activity_types_preset_offset_hours_check,
  DROP CONSTRAINT IF EXISTS custom_activity_types_preset_offset_minutes_check,
  DROP CONSTRAINT IF EXISTS custom_activity_types_preset_offset_total_check,
  DROP CONSTRAINT IF EXISTS custom_activity_types_preset_duration_check,
  DROP CONSTRAINT IF EXISTS custom_activity_types_preset_reminder_check;

ALTER TABLE public.custom_activity_types
  DROP COLUMN IF EXISTS preset_title,
  DROP COLUMN IF EXISTS preset_description,
  DROP COLUMN IF EXISTS preset_offset_hours,
  DROP COLUMN IF EXISTS preset_offset_minutes,
  DROP COLUMN IF EXISTS preset_duration_minutes,
  DROP COLUMN IF EXISTS preset_reminder_minutes;

-- Privilégio medido em pg_class.relacl, antes da migration:
--   {postgres=arwdDxt/postgres,anon=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}
-- Nenhuma coluna tinha attacl. PUBLIC não estava na ACL da tabela.
-- A migration revoga INSERT e UPDATE da tabela e concede essas duas
-- permissões só na lista de colunas abaixo, para anon, authenticated e service_role.
-- As colunas de preset não entram nessa concessão.
--
-- A documentação do REVOKE afirma que revogar o privilégio na tabela também
-- revoga o mesmo privilégio em cada coluna. Este arquivo não depende dessa
-- afirmação. A concessão por coluna é revogada pelo nome.
-- A mesma documentação diz que revogar a coluna não tem efeito enquanto o
-- papel ainda tem esse privilégio na tabela. Por isso o INSERT e o UPDATE
-- da tabela saem antes da revogação por coluna. O GRANT final devolve só
-- esses dois privilégios no nível da tabela.
-- SELECT, DELETE, TRUNCATE, REFERENCES e TRIGGER não são regravados.
-- postgres é o dono e não recebe GRANT. Sem CASCADE.
REVOKE INSERT, UPDATE ON TABLE public.custom_activity_types FROM anon, authenticated, service_role;

REVOKE INSERT (
  id, company_id, name, icon, color, display_order, is_active, is_system,
  is_hidden, created_by, created_at, updated_at
), UPDATE (
  id, company_id, name, icon, color, display_order, is_active, is_system,
  is_hidden, created_by, created_at, updated_at
) ON TABLE public.custom_activity_types FROM anon, authenticated, service_role;

GRANT INSERT, UPDATE ON TABLE public.custom_activity_types TO anon, authenticated, service_role;

-- Definição lida com pg_get_functiondef. Dono postgres. Sem search_path.
-- O gatilho update_scheduled_datetime não é recriado: a migration não altera
-- o gatilho, e ele depende desta função. DROP FUNCTION falharia por essa
-- dependência. CREATE OR REPLACE preserva o EXECUTE já concedido a
-- PUBLIC, postgres, anon, authenticated e service_role.
CREATE OR REPLACE FUNCTION public.sync_scheduled_datetime()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Se tem data e hora, combinar em datetime
  IF NEW.scheduled_date IS NOT NULL AND NEW.scheduled_time IS NOT NULL THEN
    NEW.scheduled_datetime = (NEW.scheduled_date + NEW.scheduled_time)::timestamptz;
  ELSE
    NEW.scheduled_datetime = NULL;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.sync_scheduled_datetime() OWNER TO postgres;

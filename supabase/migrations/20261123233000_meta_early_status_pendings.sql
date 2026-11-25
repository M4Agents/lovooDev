-- =============================================================================
-- Meta WhatsApp — status antecipados (META-L1.4C.4.5B)
--
-- Aditiva. Não altera RLS, grants, triggers nem funções já existentes.
-- Não executa UPDATE, DELETE, TRUNCATE nem chama as funções novas.
--
-- A pendência pode existir antes de meta_whatsapp_messages.
-- Não há FK entre as duas tabelas.
-- A FK composta segue meta_whatsapp_messages.mwm_company_instance_fk:
--   (company_id, instance_id) → meta_whatsapp_instances(company_id, id)
--   ON DELETE CASCADE, apoiada em mwi_company_id_id_unique.
--
-- O único (instance_id, meta_message_id, status) impede sobrescrever
-- provider_timestamp, received_at e error_code do primeiro evento.
-- A consulta do wamid corrente usa esse único por instance_id + meta_message_id.
-- Não foi criado índice adicional para essa consulta.
--
-- list_meta_early_status_pendings só seleciona trabalho de outros wamids.
-- A ordem received_at, id de um mesmo wamid não passa por essa função.
-- delete_expired_meta_early_status_pendings fixa 72 horas e no máximo 25 linhas.
-- A ausência de tracking é verificada na mesma sentença do DELETE.
-- Uma inserção de tracking que commitar depois do snapshot dessa sentença
-- pode perder a pendência já expirada. A sentença não elimina essa corrida.
-- =============================================================================

CREATE TABLE public.meta_early_status_pendings (
  id                    bigint        GENERATED ALWAYS AS IDENTITY,
  company_id            uuid          NOT NULL,
  instance_id           uuid          NOT NULL,
  meta_message_id       text          NOT NULL,
  status                text          NOT NULL,
  provider_timestamp    timestamptz   NULL,
  received_at           timestamptz   NOT NULL DEFAULT pg_catalog.now(),
  error_code            integer       NULL,
  last_claim_failed_at  timestamptz   NULL,

  CONSTRAINT meta_early_status_pendings_pkey
    PRIMARY KEY (id),

  CONSTRAINT mesp_status_check
    CHECK (status IN ('sent', 'delivered', 'read', 'failed')),

  CONSTRAINT mesp_instance_message_status_unique
    UNIQUE (instance_id, meta_message_id, status),

  CONSTRAINT mesp_company_instance_fk
    FOREIGN KEY (company_id, instance_id)
    REFERENCES public.meta_whatsapp_instances (company_id, id)
    ON DELETE CASCADE
);

-- ASC padrão do PostgreSQL coloca NULL por último.
-- NULLS FIRST alinha o índice à ordem da recuperação oportunista.
CREATE INDEX mesp_company_instance_claim_received_id_idx
  ON public.meta_early_status_pendings (
    company_id,
    instance_id,
    last_claim_failed_at ASC NULLS FIRST,
    received_at ASC,
    id ASC
  );

CREATE INDEX mesp_company_instance_received_idx
  ON public.meta_early_status_pendings (
    company_id,
    instance_id,
    received_at ASC
  );

COMMENT ON TABLE public.meta_early_status_pendings IS
  'Status outbound recebido antes do tracking. Sem telefone, conteúdo, payload ou token.';

COMMENT ON COLUMN public.meta_early_status_pendings.last_claim_failed_at IS
  'Preenchido só após erro ou esgotamento do compare-and-swap. Nulo permanece na frente do lote.';

ALTER TABLE public.meta_early_status_pendings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_early_status_pendings FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_early_status_pendings FROM anon;
REVOKE ALL ON TABLE public.meta_early_status_pendings FROM authenticated;
REVOKE ALL ON TABLE public.meta_early_status_pendings FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.meta_early_status_pendings
  TO service_role;

REVOKE ALL ON SEQUENCE public.meta_early_status_pendings_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.meta_early_status_pendings_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.meta_early_status_pendings_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.meta_early_status_pendings_id_seq FROM service_role;

GRANT USAGE
  ON SEQUENCE public.meta_early_status_pendings_id_seq
  TO service_role;

ALTER TABLE public.meta_whatsapp_messages
  ADD COLUMN realtime_notify_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.meta_whatsapp_messages.realtime_notify_pending IS
  'Notificação Realtime ainda não concluída para o status atual. Não é estado de entrega.';

CREATE INDEX idx_mwm_realtime_notify_pending
  ON public.meta_whatsapp_messages (company_id, instance_id)
  WHERE realtime_notify_pending IS TRUE;

CREATE FUNCTION public.list_meta_early_status_pendings(
  p_company_id uuid,
  p_instance_id uuid,
  p_exclude_meta_message_id text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  company_id uuid,
  instance_id uuid,
  meta_message_id text,
  status text,
  provider_timestamp timestamptz,
  received_at timestamptz,
  error_code integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_company_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'meta_early_status_scope_required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    pending_row.id,
    pending_row.company_id,
    pending_row.instance_id,
    pending_row.meta_message_id,
    pending_row.status,
    pending_row.provider_timestamp,
    pending_row.received_at,
    pending_row.error_code
  FROM public.meta_early_status_pendings AS pending_row
  INNER JOIN public.meta_whatsapp_messages AS tracking_row
    ON tracking_row.company_id = pending_row.company_id
   AND tracking_row.instance_id = pending_row.instance_id
   AND tracking_row.meta_message_id = pending_row.meta_message_id
  WHERE pending_row.company_id = p_company_id
    AND pending_row.instance_id = p_instance_id
    AND (
      p_exclude_meta_message_id IS NULL
      OR pending_row.meta_message_id <> p_exclude_meta_message_id
    )
  ORDER BY
    pending_row.last_claim_failed_at ASC NULLS FIRST,
    pending_row.received_at ASC,
    pending_row.id ASC
  LIMIT 5;
END;
$fn$;

COMMENT ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text) IS
  'Seleciona no máximo cinco pendências com tracking na empresa e instância. '
  'p_exclude_meta_message_id nulo não exclui wamid. Não aplica status, não toca chat e não remove linha. '
  'SECURITY INVOKER. search_path = pg_catalog.';

ALTER FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  FROM anon;
REVOKE ALL ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  FROM authenticated;
REVOKE ALL ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  FROM service_role;

GRANT EXECUTE ON FUNCTION public.list_meta_early_status_pendings(uuid, uuid, text)
  TO service_role;

CREATE FUNCTION public.delete_expired_meta_early_status_pendings(
  p_company_id uuid,
  p_instance_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_deleted integer;
BEGIN
  IF p_company_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'meta_early_status_scope_required'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT pending_row.id
    FROM public.meta_early_status_pendings AS pending_row
    WHERE pending_row.company_id = p_company_id
      AND pending_row.instance_id = p_instance_id
      AND pending_row.received_at < (
        pg_catalog.now() - pg_catalog.make_interval(hours => 72)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.meta_whatsapp_messages AS tracking_row
        WHERE tracking_row.company_id = pending_row.company_id
          AND tracking_row.instance_id = pending_row.instance_id
          AND tracking_row.meta_message_id = pending_row.meta_message_id
      )
    ORDER BY pending_row.received_at ASC, pending_row.id ASC
    LIMIT 25
  )
  DELETE FROM public.meta_early_status_pendings AS pending_row
  USING candidates
  WHERE pending_row.id = candidates.id
    AND pending_row.company_id = p_company_id
    AND pending_row.instance_id = p_instance_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

COMMENT ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid) IS
  'Remove no máximo 25 pendências da empresa e instância, com mais de 72 horas e sem tracking. '
  'O prazo é fixo. A ausência do tracking vale na mesma sentença. '
  'SECURITY INVOKER. search_path = pg_catalog.';

ALTER FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  FROM anon;
REVOKE ALL ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  FROM authenticated;
REVOKE ALL ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  FROM service_role;

GRANT EXECUTE ON FUNCTION public.delete_expired_meta_early_status_pendings(uuid, uuid)
  TO service_role;

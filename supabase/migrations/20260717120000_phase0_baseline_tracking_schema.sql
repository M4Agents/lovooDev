-- =============================================================================
-- Fase 0 / Lote 0B.1 — Baseline do schema de tracking
-- =============================================================================
-- Objetivo: versionar drift live → repositório (sem alterar dados/RPCs/grants).
--
-- Objetos:
--   - public.visitors.visitor_id   uuid NULL   (persistent_visitor_id)
--   - public.visitors.timezone     text NULL
--   - public.visitors.language     text NULL
--   - public.leads.visitor_id      text NULL   (persistent_visitor_id, sem FK)
--   - public.tracking_queue        (tabela + índices + RLS + policy INSERT)
--   - policies INSERT ausentes no repo (espelho live para visitors/be/cv):
--       * "Anonymous users can create visitors"        ON visitors       TO anon
--       * "Anonymous users can create behavior events" ON behavior_events TO anon
--       * "Anonymous users can create conversions"     ON conversions    TO anon
--       * "Anyone can insert tracking data"            ON tracking_queue TO anon
--         (live usa PUBLIC; consumidores públicos usam anon key — ver comentário §6)
--
-- Regras:
--   * idempotente (IF NOT EXISTS / DO $$)
--   * valida tipo, nullability, default, constraints, índices e RLS
--   * falha claramente se a tabela existente divergir do esperado
--   * nunca DROP COLUMN / UPDATE de dados
--   * não recria policy já existente (não usa DROP POLICY)
--   * não altera grants nem RPCs (diferenças de grants → risco 0B.8)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) visitors.visitor_id (uuid NULL) — persistent_visitor_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_udt text;
  v_nullable text;
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE EXCEPTION 'public.visitors does not exist — apply base m4_track schema first';
  END IF;

  SELECT c.udt_name, c.is_nullable
    INTO v_udt, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'visitors'
    AND c.column_name = 'visitor_id';

  IF v_udt IS NULL THEN
    ALTER TABLE public.visitors ADD COLUMN visitor_id uuid NULL;
  ELSE
    IF v_udt <> 'uuid' THEN
      RAISE EXCEPTION
        'public.visitors.visitor_id unexpected type % (expected uuid)', v_udt;
    END IF;
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION
        'public.visitors.visitor_id unexpected nullability % (expected YES)',
        v_nullable;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) visitors.timezone (text NULL)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_udt text;
  v_nullable text;
BEGIN
  SELECT c.udt_name, c.is_nullable
    INTO v_udt, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'visitors'
    AND c.column_name = 'timezone';

  IF v_udt IS NULL THEN
    ALTER TABLE public.visitors ADD COLUMN timezone text NULL;
  ELSE
    IF v_udt <> 'text' THEN
      RAISE EXCEPTION
        'public.visitors.timezone unexpected type % (expected text)', v_udt;
    END IF;
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION
        'public.visitors.timezone unexpected nullability % (expected YES)',
        v_nullable;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) visitors.language (text NULL)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_udt text;
  v_nullable text;
BEGIN
  SELECT c.udt_name, c.is_nullable
    INTO v_udt, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'visitors'
    AND c.column_name = 'language';

  IF v_udt IS NULL THEN
    ALTER TABLE public.visitors ADD COLUMN language text NULL;
  ELSE
    IF v_udt <> 'text' THEN
      RAISE EXCEPTION
        'public.visitors.language unexpected type % (expected text)', v_udt;
    END IF;
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION
        'public.visitors.language unexpected nullability % (expected YES)',
        v_nullable;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) leads.visitor_id (text NULL) — persistent_visitor_id (sem FK)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_udt text;
  v_nullable text;
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'public.leads does not exist — apply leads schema first';
  END IF;

  SELECT c.udt_name, c.is_nullable
    INTO v_udt, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'leads'
    AND c.column_name = 'visitor_id';

  IF v_udt IS NULL THEN
    ALTER TABLE public.leads ADD COLUMN visitor_id text NULL;
  ELSE
    IF v_udt <> 'text' THEN
      RAISE EXCEPTION
        'public.leads.visitor_id unexpected type % (expected text)', v_udt;
    END IF;
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION
        'public.leads.visitor_id unexpected nullability % (expected YES)',
        v_nullable;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) tracking_queue (ausente no repo; presente no live)
-- ---------------------------------------------------------------------------
-- DDL live confirmado:
--   id uuid NOT NULL DEFAULT gen_random_uuid()  PK
--   action text NOT NULL
--   data jsonb NOT NULL
--   created_at timestamptz NULL DEFAULT now()
--   processed boolean NULL DEFAULT false
--   CHECK (action IN ('visitor','event','conversion'))
--   INDEX btree (action), (created_at), (processed)
--   RLS enabled, force RLS = false
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tracking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  processed boolean DEFAULT false,
  CONSTRAINT tracking_queue_action_check
    CHECK (action = ANY (ARRAY['visitor'::text, 'event'::text, 'conversion'::text]))
);

-- Validação completa se a tabela já existia (tipo, nullability, default,
-- constraints, FORCE RLS). Não corrige divergências estruturais — falha.
-- Índices e ENABLE RLS são aplicados/confirmados nos blocos seguintes.
DO $$
DECLARE
  r record;
  expected constant text[][] := ARRAY[
    ARRAY['id',         'uuid',        'NO',  'gen_random_uuid'],
    ARRAY['action',     'text',        'NO',  ''],
    ARRAY['data',       'jsonb',       'NO',  ''],
    ARRAY['created_at', 'timestamptz', 'YES', 'now()'],
    ARRAY['processed',  'bool',        'YES', 'false']
  ];
  v_typ text;
  v_notnull boolean;
  v_default text;
  v_condef text;
  v_force boolean;
  i integer;
BEGIN
  IF to_regclass('public.tracking_queue') IS NULL THEN
    RAISE EXCEPTION 'public.tracking_queue missing after CREATE TABLE IF NOT EXISTS';
  END IF;

  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT t.typname, a.attnotnull, pg_get_expr(ad.adbin, ad.adrelid)
      INTO v_typ, v_notnull, v_default
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = 'public.tracking_queue'::regclass
      AND a.attname = expected[i][1]
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_typ IS NULL THEN
      RAISE EXCEPTION 'tracking_queue.% is missing', expected[i][1];
    END IF;
    IF v_typ <> expected[i][2] THEN
      RAISE EXCEPTION
        'tracking_queue.% unexpected type % (expected %)',
        expected[i][1], v_typ, expected[i][2];
    END IF;
    IF (expected[i][3] = 'NO') <> v_notnull THEN
      RAISE EXCEPTION
        'tracking_queue.% unexpected nullability (expected nullable=%)',
        expected[i][1], expected[i][3];
    END IF;

    IF expected[i][4] = '' THEN
      IF v_default IS NOT NULL THEN
        RAISE EXCEPTION
          'tracking_queue.% unexpected default % (expected none)',
          expected[i][1], v_default;
      END IF;
    ELSIF v_default IS NULL OR position(expected[i][4] in v_default) = 0 THEN
      RAISE EXCEPTION
        'tracking_queue.% unexpected default % (expected to contain %)',
        expected[i][1], v_default, expected[i][4];
    END IF;
  END LOOP;

  -- Colunas extras não esperadas
  FOR r IN
    SELECT a.attname
    FROM pg_attribute a
    WHERE a.attrelid = 'public.tracking_queue'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('id', 'action', 'data', 'created_at', 'processed')
  LOOP
    RAISE EXCEPTION 'tracking_queue has unexpected column %', r.attname;
  END LOOP;

  -- PK
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tracking_queue'::regclass
      AND contype = 'p'
      AND conname = 'tracking_queue_pkey'
  ) THEN
    RAISE EXCEPTION 'tracking_queue missing primary key tracking_queue_pkey';
  END IF;

  -- CHECK action
  SELECT pg_get_constraintdef(oid)
    INTO v_condef
  FROM pg_constraint
  WHERE conrelid = 'public.tracking_queue'::regclass
    AND conname = 'tracking_queue_action_check';

  IF v_condef IS NULL THEN
    ALTER TABLE public.tracking_queue
      ADD CONSTRAINT tracking_queue_action_check
      CHECK (action = ANY (ARRAY['visitor'::text, 'event'::text, 'conversion'::text]));
  ELSIF v_condef NOT ILIKE '%visitor%'
     OR v_condef NOT ILIKE '%event%'
     OR v_condef NOT ILIKE '%conversion%' THEN
    RAISE EXCEPTION
      'tracking_queue_action_check unexpected definition: %', v_condef;
  END IF;

  -- FORCE RLS deve permanecer false (live)
  SELECT c.relforcerowsecurity
    INTO v_force
  FROM pg_class c
  WHERE c.oid = 'public.tracking_queue'::regclass;

  IF v_force IS TRUE THEN
    RAISE EXCEPTION 'tracking_queue has FORCE ROW LEVEL SECURITY enabled (expected false)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tracking_queue_action
  ON public.tracking_queue USING btree (action);

CREATE INDEX IF NOT EXISTS idx_tracking_queue_created_at
  ON public.tracking_queue USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_tracking_queue_processed
  ON public.tracking_queue USING btree (processed);

-- Confirma índices após criação idempotente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tracking_queue'
      AND indexname = 'idx_tracking_queue_action'
  ) THEN
    RAISE EXCEPTION 'missing index idx_tracking_queue_action';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tracking_queue'
      AND indexname = 'idx_tracking_queue_created_at'
  ) THEN
    RAISE EXCEPTION 'missing index idx_tracking_queue_created_at';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tracking_queue'
      AND indexname = 'idx_tracking_queue_processed'
  ) THEN
    RAISE EXCEPTION 'missing index idx_tracking_queue_processed';
  END IF;
END $$;

ALTER TABLE public.tracking_queue ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_rls boolean;
BEGIN
  SELECT c.relrowsecurity
    INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'tracking_queue';

  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'tracking_queue RLS is not enabled after ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Policies INSERT de tracking (somente se ausentes)
-- ---------------------------------------------------------------------------
-- Live confirmado:
--   visitors / behavior_events / conversions:
--     nome, FOR INSERT, TO anon, WITH CHECK (true)  — espelho exato
--   tracking_queue:
--     "Anyone can insert tracking data", FOR INSERT, TO PUBLIC, WITH CHECK (true)
--
-- Papel escolhido para tracking_queue nesta migration: TO anon
--   * api/track.js insere via Supabase REST com apikey anon
--   * PUBLIC inclui authenticated/postgres desnecessariamente
--   * em banco novo: cria TO anon (mínimo necessário)
--   * em banco live: policy já existe (PUBLIC) → não DROP / não recria
--     (preserva comportamento live; alinhamento PUBLIC→anon fica para hardening)
--
-- Grants de tabela (anon/authenticated ALL no live): NÃO alterados aqui → 0B.8
-- Policies SELECT/UPDATE/DELETE de tracking_queue: fora do escopo 0B.1
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.visitors') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'visitors'
         AND policyname = 'Anonymous users can create visitors'
     )
  THEN
    EXECUTE $policy$
      CREATE POLICY "Anonymous users can create visitors"
        ON public.visitors
        FOR INSERT
        TO anon
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.behavior_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'behavior_events'
         AND policyname = 'Anonymous users can create behavior events'
     )
  THEN
    EXECUTE $policy$
      CREATE POLICY "Anonymous users can create behavior events"
        ON public.behavior_events
        FOR INSERT
        TO anon
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.conversions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'conversions'
         AND policyname = 'Anonymous users can create conversions'
     )
  THEN
    EXECUTE $policy$
      CREATE POLICY "Anonymous users can create conversions"
        ON public.conversions
        FOR INSERT
        TO anon
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

-- Cria apenas se ausente. Novo ambiente: TO anon.
-- Live com PUBLIC de mesmo nome: no-op (não amplia, não reduz neste lote).
DO $$
BEGIN
  IF to_regclass('public.tracking_queue') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'tracking_queue'
         AND policyname = 'Anyone can insert tracking data'
     )
  THEN
    EXECUTE $policy$
      CREATE POLICY "Anyone can insert tracking data"
        ON public.tracking_queue
        FOR INSERT
        TO anon
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Notas 0B.8 (grants) — não aplicar neste lote
-- ---------------------------------------------------------------------------
-- Live: anon/authenticated/service_role possuem privilegios amplos de tabela
-- (INSERT/SELECT/UPDATE/DELETE/…) em visitors, behavior_events, conversions
-- e tracking_queue. Esta migration NÃO emite GRANT/REVOKE.
-- Revisar grants mínimos no Lote 0B.8 junto com grants das RPCs canônicas.
-- ---------------------------------------------------------------------------

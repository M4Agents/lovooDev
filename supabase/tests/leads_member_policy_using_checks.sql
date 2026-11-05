-- Testes manuais da migration 20261105152944_optimize_leads_member_policy_using.
--
-- Nenhum bloco deste arquivo é automatizado. Não há pgTAP, vitest nem passo
-- de CI. Rodar no SQL editor, como postgres, somente depois da aplicação
-- aprovada. Cada bloco abre transação e termina com ROLLBACK. Não há COMMIT.
--
-- As seções 1 a 8 são scripts executáveis. A seção 8 impersona o usuário
-- encontrado em company_users, partner_company_links ou auth.users: grava o
-- sub no JWT e faz SET ROLE authenticated. O número esperado é calculado
-- antes disso, com os helpers atuais e a política leads_support_partner_access,
-- que esta migration não altera. Divergência ou perfil ausente gera erro.

-- ---------------------------------------------------------------------------
-- 1. EXECUTÁVEL. uid nulo devolve zero linhas nas quatro funções.
--    Não depende de short-circuit da política.
-- ---------------------------------------------------------------------------

BEGIN;

SELECT set_config('request.jwt.claims', '{}', true);

SELECT
  (SELECT count(*) FROM private.lead_member_company_ids()) AS member_n,
  (SELECT count(*) FROM private.lead_parent_admin_company_ids()) AS parent_n,
  (SELECT count(*) FROM private.lead_unrestricted_company_ids()) AS unrestricted_n,
  (SELECT count(*) FROM private.lead_view_all_company_ids()) AS view_all_n;

-- Esperado: os quatro valores iguais a 0.

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 2. EXECUTÁVEL. Empresas sem restrição não saem do escopo membro ou admin pai.
-- ---------------------------------------------------------------------------

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', u.id::text, 'role', 'authenticated')::text,
  true
)
FROM auth.users u
WHERE u.email = 'moniquinhallj@gmail.com';

SELECT count(*) AS fora_do_escopo
  FROM (
    SELECT private.lead_unrestricted_company_ids()
    EXCEPT
    (
      SELECT private.lead_member_company_ids()
      UNION
      SELECT private.lead_parent_admin_company_ids()
    )
  ) extra;

-- Esperado: fora_do_escopo = 0.
-- Repetir o mesmo SELECT depois de trocar o e-mail pelos usuários da seção 8.

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 3. EXECUTÁVEL. Equivalência do predicado "vê todos os leads da empresa"
--    com os helpers. Não varre a tabela leads.
--    O recorte de lead_unrestricted_company_ids torna falsa a comparação
--    isolada "não restrito = irrestrita ou view_all" numa empresa fora do
--    escopo. A comparação abaixo inclui o mesmo membro/admin pai dos dois lados.
-- ---------------------------------------------------------------------------

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', u.id::text, 'role', 'authenticated')::text,
  true
)
FROM auth.users u
WHERE u.email = 'moniquinhallj@gmail.com';

SELECT
  c.id,
  c.name,
  public.auth_user_is_company_member(c.id)
    = (c.id IN (SELECT private.lead_member_company_ids())) AS member_ok,
  public.auth_user_is_parent_admin(c.id)
    = (c.id IN (SELECT private.lead_parent_admin_company_ids())) AS parent_ok,
  (
    (public.auth_user_is_company_member(c.id) OR public.auth_user_is_parent_admin(c.id))
    AND NOT public.auth_user_restricted_to_own_leads(c.id)
  )
    = (
      (
        c.id IN (SELECT private.lead_member_company_ids())
        OR c.id IN (SELECT private.lead_parent_admin_company_ids())
      )
      AND (
        c.id IN (SELECT private.lead_unrestricted_company_ids())
        OR c.id IN (SELECT private.lead_view_all_company_ids())
      )
    ) AS full_visibility_ok
FROM public.companies c
WHERE c.id = 'c4f8d5e7-7c46-4836-aa86-f699f0a9139a'
   OR c.parent_company_id = 'c4f8d5e7-7c46-4836-aa86-f699f0a9139a';

-- Esperado: member_ok, parent_ok e full_visibility_ok verdadeiros.
-- responsible_user_id e o CASE da transferência não entram aqui: o texto
-- desses dois ramos no USING é o da política anterior.

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 4. EXECUTÁVEL. service_role não executa as funções.
--    A exceção esperada é capturada. A transação termina com ROLLBACK.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM 1 FROM private.lead_unrestricted_company_ids();
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'service_role executou private.lead_unrestricted_company_ids';
  END IF;
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5. EXECUTÁVEL, somente leitura. Performance e lista.
-- ---------------------------------------------------------------------------

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT id::text FROM auth.users WHERE email = 'moniquinhallj@gmail.com'),
    'role', 'authenticated'
  ),
  true
);
SET LOCAL statement_timeout = '8s';
SET LOCAL ROLE authenticated;

SELECT clock_timestamp() AS started_at, public.get_lead_dashboard_stats(
  'c4f8d5e7-7c46-4836-aa86-f699f0a9139a',
  NULL, NULL, NULL, NULL, NULL, NULL
);
SELECT clock_timestamp() AS started_at, public.get_lead_dashboard_stats(
  'c4f8d5e7-7c46-4836-aa86-f699f0a9139a',
  NULL, NULL, NULL, NULL, NULL, NULL
);
SELECT clock_timestamp() AS started_at, public.get_lead_dashboard_stats(
  'c4f8d5e7-7c46-4836-aa86-f699f0a9139a',
  NULL, NULL, NULL, NULL, NULL, NULL
);

ROLLBACK;

-- Esperado: três jsonb iguais, cada um abaixo de 2s. Se passar de 2s, parar.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT id::text FROM auth.users WHERE email = 'marcio@m4digital.co'),
    'role', 'authenticated'
  ),
  true
);
SET LOCAL statement_timeout = '8s';
SET LOCAL ROLE authenticated;

SELECT clock_timestamp() AS started_at, public.get_lead_dashboard_stats(
  'c4f8d5e7-7c46-4836-aa86-f699f0a9139a',
  NULL, NULL, NULL, NULL, NULL, NULL
);

ROLLBACK;

-- Esperado: totais iguais aos da Mônica e não acima da medição anterior, cerca de 1,1s.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT id::text FROM auth.users WHERE email = 'moniquinhallj@gmail.com'),
    'role', 'authenticated'
  ),
  true
);
SET LOCAL ROLE authenticated;

EXPLAIN
SELECT id
  FROM public.leads
 WHERE company_id = 'c4f8d5e7-7c46-4836-aa86-f699f0a9139a'
 ORDER BY created_at DESC
 LIMIT 20;

ROLLBACK;

-- Esperado: Index Scan por company_id e SubPlan ou InitPlan das funções.
-- EXPLAIN como postgres não mostra o RLS. O SET ROLE acima é obrigatório.

-- ---------------------------------------------------------------------------
-- 6. EXECUTÁVEL, somente leitura. Amanda não vê lead de outra pessoa.
-- ---------------------------------------------------------------------------

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT id::text FROM auth.users WHERE email = 'vox.comercial05@gmail.com'),
    'role', 'authenticated'
  ),
  true
);
SET LOCAL ROLE authenticated;

SELECT
  count(*) FILTER (WHERE responsible_user_id = auth.uid()) AS proprios,
  count(*) FILTER (WHERE responsible_user_id IS DISTINCT FROM auth.uid()) AS outros
FROM public.leads
WHERE company_id = 'b41a807e-6694-46c2-9f78-1246131c7220';

ROLLBACK;

-- Esperado: outros = 0.

-- ---------------------------------------------------------------------------
-- 7. EXECUTÁVEL. Transferência dentro de transação desfeita com ROLLBACK.
--    O update do seller e o bloqueio do admin não fazem COMMIT.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_seller uuid;
  v_target uuid;
  v_lead_id integer;
  v_seen integer;
BEGIN
  SELECT id INTO v_seller FROM auth.users WHERE email = 'vox.comercial05@gmail.com';
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_seller::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE company_id = 'b41a807e-6694-46c2-9f78-1246131c7220'
     AND responsible_user_id = v_seller
   LIMIT 1;

  SELECT cu.user_id INTO v_target
    FROM public.company_users cu
   WHERE cu.company_id = 'b41a807e-6694-46c2-9f78-1246131c7220'
     AND cu.is_active = true
     AND cu.role = 'seller'
     AND cu.user_id <> v_seller
   LIMIT 1;

  UPDATE public.leads
     SET responsible_user_id = v_target
   WHERE id = v_lead_id
  RETURNING id INTO v_seen;

  IF v_seen IS NULL THEN
    RAISE EXCEPTION 'transferencia para seller nao devolveu a linha';
  END IF;

  PERFORM 1 FROM public.leads WHERE id = v_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'seller deixou de ver o proprio lead apos a transferencia';
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_seller uuid;
  v_target uuid;
  v_lead_id integer;
  v_blocked boolean := false;
BEGIN
  SELECT id INTO v_seller FROM auth.users WHERE email = 'vox.comercial05@gmail.com';
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_seller::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE company_id = 'b41a807e-6694-46c2-9f78-1246131c7220'
     AND responsible_user_id = v_seller
   LIMIT 1;

  SELECT cu.user_id INTO v_target
    FROM public.company_users cu
   WHERE cu.company_id = 'b41a807e-6694-46c2-9f78-1246131c7220'
     AND cu.is_active = true
     AND cu.role = 'admin'
   LIMIT 1;

  BEGIN
    UPDATE public.leads
       SET responsible_user_id = v_target
     WHERE id = v_lead_id;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'destino admin nao foi bloqueado';
  END IF;
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 8. EXECUTÁVEL, somente leitura. Um perfil real por bloco.
--    Esperado: a contagem sob RLS, já como authenticated, é igual à contagem
--    dos helpers e da política de partner. Perfil ausente ou número diferente
--    interrompe o bloco. O ROLLBACK seguinte encerra a transação.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_expected bigint;
  v_actual bigint;
  v_total bigint;
BEGIN
  SELECT cu.user_id, cu.company_id
    INTO v_user, v_company
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
   WHERE cu.role = 'manager'
     AND cu.is_active = true
     AND c.restrict_leads_to_owner = true
     AND coalesce((cu.permissions ->> 'view_all_leads')::boolean, false)
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = cu.user_id
          AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: manager com view_all_leads em empresa restrita';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  SELECT count(*) INTO v_total FROM public.leads WHERE company_id = v_company;
  SELECT count(*) INTO v_expected
    FROM public.leads l
   WHERE l.company_id = v_company
     AND (
       (public.auth_user_is_company_member(l.company_id) OR public.auth_user_is_parent_admin(l.company_id))
       AND (NOT public.auth_user_restricted_to_own_leads(l.company_id) OR l.responsible_user_id = auth.uid())
     );

  IF v_total = 0 OR v_expected <> v_total THEN
    RAISE EXCEPTION 'manager com view_all deveria ver todos os leads de %: total %, helpers %', v_company, v_total, v_expected;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do manager com view_all nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'manager com view_all divergiu em %: rls %, esperado %', v_company, v_actual, v_expected;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_expected bigint;
  v_actual bigint;
  v_own bigint;
  v_others bigint;
  v_hidden bigint;
BEGIN
  SELECT cu.user_id, cu.company_id
    INTO v_user, v_company
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
   WHERE cu.role = 'manager'
     AND cu.is_active = true
     AND c.restrict_leads_to_owner = true
     AND NOT coalesce((cu.permissions ->> 'view_all_leads')::boolean, false)
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = cu.user_id AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies child
       JOIN public.company_users parent_admin
         ON parent_admin.company_id = child.parent_company_id
      WHERE child.id = cu.company_id
        AND parent_admin.user_id = cu.user_id
        AND parent_admin.is_active = true
        AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = cu.user_id
          AND pcl.company_id = cu.company_id
          AND pcl.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies created
        WHERE created.id = cu.company_id
          AND created.created_by_partner_id = cu.user_id
     )
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: manager sem view_all_leads em empresa restrita';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  SELECT count(*) FILTER (WHERE responsible_user_id = v_user),
         count(*) FILTER (WHERE responsible_user_id IS DISTINCT FROM v_user)
    INTO v_own, v_hidden
    FROM public.leads
   WHERE company_id = v_company;

  IF v_hidden = 0 THEN
    RAISE EXCEPTION 'empresa % nao tem lead de terceiro para provar a restricao', v_company;
  END IF;

  SELECT count(*) INTO v_expected
    FROM public.leads l
   WHERE l.company_id = v_company
     AND (public.auth_user_is_company_member(l.company_id) OR public.auth_user_is_parent_admin(l.company_id))
     AND (NOT public.auth_user_restricted_to_own_leads(l.company_id) OR l.responsible_user_id = auth.uid());

  IF v_expected <> v_own THEN
    RAISE EXCEPTION 'helper do manager sem view_all em % devolveu % e os proprios sao %', v_company, v_expected, v_own;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do manager sem view_all nao foi aplicado';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE responsible_user_id IS DISTINCT FROM auth.uid())
    INTO v_actual, v_others
    FROM public.leads
   WHERE company_id = v_company;

  IF v_actual <> v_expected OR v_others <> 0 THEN
    RAISE EXCEPTION 'manager sem view_all divergiu em %: rls %, outros %, esperado %', v_company, v_actual, v_others, v_expected;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_other uuid;
  v_expected bigint;
  v_actual bigint;
  v_total bigint;
BEGIN
  SELECT pcl.partner_user_id, pcl.company_id
    INTO v_user, v_company
    FROM public.partner_company_links pcl
   WHERE pcl.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = pcl.partner_user_id
          AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = pcl.company_id)
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: partner com partner_company_links ativo';
  END IF;

  SELECT c.id INTO v_other
    FROM public.companies c
   WHERE c.id <> v_company
     AND c.created_by_partner_id IS DISTINCT FROM v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = v_user AND pcl.company_id = c.id AND pcl.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = v_user AND cu.company_id = c.id AND cu.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies child
       JOIN public.company_users parent_admin ON parent_admin.company_id = child.parent_company_id
        WHERE child.id = c.id AND parent_admin.user_id = v_user AND parent_admin.is_active = true
          AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
   LIMIT 1;

  IF v_other IS NULL THEN
    RAISE EXCEPTION 'partner % nao tem outra empresa para o teste negativo', v_user;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  SELECT count(*) INTO v_total FROM public.leads WHERE company_id = v_company;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do partner com empresa atribuida nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  SELECT count(*) INTO v_expected FROM public.leads WHERE company_id = v_other;
  IF v_actual <> v_total OR v_total = 0 OR v_expected <> 0 THEN
    RAISE EXCEPTION 'partner com link divergiu: empresa % rls % total %; outra empresa % rls %', v_company, v_actual, v_total, v_other, v_expected;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_actual bigint;
BEGIN
  SELECT cu.user_id INTO v_user
    FROM public.company_users cu
   WHERE cu.role = 'partner'
     AND cu.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = cu.user_id AND pcl.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies c WHERE c.created_by_partner_id = cu.user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = cu.user_id AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: partner sem empresa atribuida';
  END IF;

  SELECT c.id INTO v_company
    FROM public.companies c
   WHERE c.created_by_partner_id IS DISTINCT FROM v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = v_user AND cu.company_id = c.id AND cu.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies child
       JOIN public.company_users parent_admin ON parent_admin.company_id = child.parent_company_id
        WHERE child.id = c.id AND parent_admin.user_id = v_user AND parent_admin.is_active = true
          AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
   LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'partner sem atribuicao % nao tem empresa alheia com leads', v_user;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do partner sem empresa atribuida nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  IF v_actual <> 0 THEN
    RAISE EXCEPTION 'partner sem atribuicao viu % leads da empresa %', v_actual, v_company;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_actual bigint;
  v_total bigint;
BEGIN
  SELECT cu.user_id INTO v_user
    FROM public.company_users cu
   WHERE cu.role = 'support' AND cu.is_active = true
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: support ativo';
  END IF;

  SELECT c.id INTO v_company
    FROM public.companies c
   WHERE NOT EXISTS (
       SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = v_user AND cu.company_id = c.id AND cu.is_active = true
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
   LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'support % nao tem empresa alheia com leads', v_user;
  END IF;

  SELECT count(*) INTO v_total FROM public.leads WHERE company_id = v_company;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do support nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  IF v_total = 0 OR v_actual <> v_total THEN
    RAISE EXCEPTION 'support divergiu na empresa %: rls %, total %', v_company, v_actual, v_total;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_child uuid;
  v_other uuid;
  v_global boolean;
  v_expected bigint;
  v_actual bigint;
  v_total bigint;
  v_other_total bigint;
  v_other_actual bigint;
BEGIN
  SELECT parent_admin.user_id, child.id
    INTO v_user, v_child
    FROM public.company_users parent_admin
    JOIN public.companies child ON child.parent_company_id = parent_admin.company_id
   WHERE parent_admin.role = 'system_admin'
     AND parent_admin.is_active = true
     AND child.parent_company_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = parent_admin.user_id AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = parent_admin.user_id
          AND pcl.company_id = child.id
          AND pcl.is_active = true
     )
     AND child.created_by_partner_id IS DISTINCT FROM parent_admin.user_id
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = child.id)
   LIMIT 1;

  v_global := false;
  IF v_user IS NULL THEN
    SELECT parent_admin.user_id, child.id
      INTO v_user, v_child
      FROM public.company_users parent_admin
      JOIN public.companies child ON child.parent_company_id = parent_admin.company_id
     WHERE parent_admin.role = 'super_admin'
       AND parent_admin.is_active = true
       AND child.parent_company_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = child.id)
     LIMIT 1;
    v_global := v_user IS NOT NULL;
  END IF;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: admin da empresa pai';
  END IF;

  SELECT c.id INTO v_other
    FROM public.companies c
   WHERE c.id <> v_child
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = v_user AND cu.company_id = c.id AND cu.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.companies child
         JOIN public.company_users parent_admin
           ON parent_admin.company_id = child.parent_company_id
        WHERE child.id = c.id
          AND parent_admin.user_id = v_user
          AND parent_admin.is_active = true
          AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND c.created_by_partner_id IS DISTINCT FROM v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = v_user AND pcl.company_id = c.id AND pcl.is_active = true
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
   LIMIT 1;

  IF v_other IS NULL THEN
    RAISE EXCEPTION 'admin pai % nao tem empresa fora da filha para comparar', v_user;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  IF NOT public.auth_user_is_parent_admin(v_child) THEN
    RAISE EXCEPTION 'usuario % nao e admin pai da filha %', v_user, v_child;
  END IF;

  SELECT count(*) INTO v_total FROM public.leads WHERE company_id = v_child;
  SELECT count(*) INTO v_expected
    FROM public.leads l
   WHERE l.company_id = v_child
     AND (
       (
         (public.auth_user_is_company_member(l.company_id) OR public.auth_user_is_parent_admin(l.company_id))
         AND (NOT public.auth_user_restricted_to_own_leads(l.company_id) OR l.responsible_user_id = auth.uid())
       )
       OR v_global
     );
  SELECT count(*) INTO v_other_total FROM public.leads WHERE company_id = v_other;

  IF NOT v_global AND NOT public.auth_user_restricted_to_own_leads(v_child) AND v_expected <> v_total THEN
    RAISE EXCEPTION 'admin pai deveria ver todos os leads da filha %', v_child;
  END IF;
  IF NOT v_global AND public.auth_user_restricted_to_own_leads(v_child) AND (
    v_expected <> (SELECT count(*) FROM public.leads WHERE company_id = v_child AND responsible_user_id = v_user)
    OR v_total <= v_expected
  ) THEN
    RAISE EXCEPTION 'admin pai de filha restrita % deveria ver so os proprios leads e existir lead de terceiro', v_child;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do admin pai nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_child;
  SELECT count(*) INTO v_other_actual FROM public.leads WHERE company_id = v_other;

  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'admin pai divergiu na filha %: rls %, esperado %', v_child, v_actual, v_expected;
  END IF;
  IF NOT v_global AND v_other_actual <> 0 THEN
    RAISE EXCEPTION 'admin pai viu % leads da empresa fora do escopo %', v_other_actual, v_other;
  END IF;
  IF v_global AND v_other_actual <> v_other_total THEN
    RAISE EXCEPTION 'super_admin pai divergiu fora da filha %: rls %, total %', v_other, v_other_actual, v_other_total;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_actual bigint;
  v_expected bigint;
BEGIN
  SELECT cu.user_id, cu.company_id
    INTO v_user, v_company
    FROM public.company_users cu
   WHERE cu.is_active = false
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users active_row
        WHERE active_row.user_id = cu.user_id
          AND active_row.company_id = cu.company_id
          AND active_row.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = cu.user_id AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = cu.user_id AND pcl.company_id = cu.company_id AND pcl.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies c
        WHERE c.id = cu.company_id AND c.created_by_partner_id = cu.user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies child
       JOIN public.company_users parent_admin ON parent_admin.company_id = child.parent_company_id
        WHERE child.id = cu.company_id AND parent_admin.user_id = cu.user_id
          AND parent_admin.is_active = true
          AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = cu.company_id)
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: membership inativa com leads na empresa';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  SELECT count(*) INTO v_expected
    FROM public.leads l
   WHERE l.company_id = v_company
     AND (
       (
         (public.auth_user_is_company_member(l.company_id) OR public.auth_user_is_parent_admin(l.company_id))
         AND (NOT public.auth_user_restricted_to_own_leads(l.company_id) OR l.responsible_user_id = auth.uid())
       )
       OR l.company_id IN (
         SELECT pcl.company_id FROM public.partner_company_links pcl
          WHERE pcl.partner_user_id = auth.uid() AND pcl.is_active = true
       )
       OR l.company_id IN (
         SELECT c.id FROM public.companies c WHERE c.created_by_partner_id = auth.uid()
       )
     );

  IF v_expected <> 0 THEN
    RAISE EXCEPTION 'helper ainda libera membership inativa na empresa %: % leads', v_company, v_expected;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto da membership inativa nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  IF v_actual <> 0 THEN
    RAISE EXCEPTION 'membership inativa viu % leads da empresa %', v_actual, v_company;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company uuid;
  v_actual bigint;
BEGIN
  SELECT u.id INTO v_user
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.company_users cu WHERE cu.user_id = u.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = u.id AND pcl.is_active = true
     )
     AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.created_by_partner_id = u.id)
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: usuario sem vinculo';
  END IF;

  SELECT l.company_id INTO v_company FROM public.leads l LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'nao ha lead para o teste de usuario sem vinculo';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do usuario sem vinculo nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_actual FROM public.leads WHERE company_id = v_company;
  IF v_actual <> 0 THEN
    RAISE EXCEPTION 'usuario sem vinculo viu % leads da empresa %', v_actual, v_company;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_home uuid;
  v_other uuid;
  v_home_expected bigint;
  v_home_actual bigint;
  v_other_actual bigint;
BEGIN
  SELECT cu.user_id, cu.company_id
    INTO v_user, v_home
    FROM public.company_users cu
    JOIN public.companies home ON home.id = cu.company_id
   WHERE cu.is_active = true
     AND cu.role IN ('admin', 'manager', 'seller')
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users g
        WHERE g.user_id = cu.user_id AND g.is_active = true
          AND g.role IN ('super_admin', 'support')
     )
     AND (
       home.restrict_leads_to_owner = false
       OR coalesce((cu.permissions ->> 'view_all_leads')::boolean, false)
       OR EXISTS (
         SELECT 1 FROM public.leads own_lead
          WHERE own_lead.company_id = cu.company_id
            AND own_lead.responsible_user_id = cu.user_id
       )
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = cu.company_id)
   LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'perfil ausente: membro ativo para o teste entre tenants';
  END IF;

  SELECT c.id INTO v_other
    FROM public.companies c
   WHERE c.id <> v_home
     AND c.created_by_partner_id IS DISTINCT FROM v_user
     AND NOT EXISTS (
       SELECT 1 FROM public.company_users cu
        WHERE cu.user_id = v_user AND cu.company_id = c.id AND cu.is_active = true
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.companies child
       JOIN public.company_users parent_admin ON parent_admin.company_id = child.parent_company_id
        WHERE child.id = c.id AND parent_admin.user_id = v_user AND parent_admin.is_active = true
          AND parent_admin.role IN ('super_admin', 'system_admin')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_links pcl
        WHERE pcl.partner_user_id = v_user AND pcl.company_id = c.id AND pcl.is_active = true
     )
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
   LIMIT 1;

  IF v_other IS NULL THEN
    RAISE EXCEPTION 'membro % nao tem outro tenant com leads', v_user;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('lovoo.seller_reassign_visible_lead_id', '', true);

  SELECT count(*) INTO v_home_expected
    FROM public.leads l
   WHERE l.company_id = v_home
     AND (public.auth_user_is_company_member(l.company_id) OR public.auth_user_is_parent_admin(l.company_id))
     AND (NOT public.auth_user_restricted_to_own_leads(l.company_id) OR l.responsible_user_id = auth.uid());

  IF v_home_expected = 0 THEN
    RAISE EXCEPTION 'membro % nao tem lead visivel no proprio tenant %', v_user, v_home;
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'contexto do teste entre tenants nao foi aplicado';
  END IF;

  SELECT count(*) INTO v_home_actual FROM public.leads WHERE company_id = v_home;
  SELECT count(*) INTO v_other_actual FROM public.leads WHERE company_id = v_other;

  IF v_home_actual <> v_home_expected OR v_other_actual <> 0 THEN
    RAISE EXCEPTION 'acesso entre tenants divergiu: casa % rls % esperado %; outra % rls %', v_home, v_home_actual, v_home_expected, v_other, v_other_actual;
  END IF;
END $$;

ROLLBACK;

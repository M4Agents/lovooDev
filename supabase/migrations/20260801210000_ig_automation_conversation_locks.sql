-- =====================================================================
-- Migration E — Tabela de lease atômica por conversa
--
-- Objetivo:
--   Serializar o processamento de mensagens da mesma conversa Instagram.
--   Impede que dois schedules de DMs distintas da mesma conversation_id
--   sejam processados simultaneamente por workers diferentes do cron.
--
-- Por que não pg_try_advisory_lock:
--   Advisory locks de sessão não são confiáveis em pools de conexão
--   (PgBouncer). O lock seria liberado ao devolver a conexão para o pool,
--   não quando o processador terminar. Com chamadas externas à OpenAI e
--   à Meta, a conexão pode ser devolvida ao pool durante a espera.
--
-- Modelo:
--   A lease é uma linha nesta tabela. A aquisição é atômica via INSERT
--   ON CONFLICT (claim_automation_conversation_lock_v1 RPC).
--   expires_at permite recuperação automática quando um worker cai.
--
-- Unicidade: (company_id, channel, conversation_id) — uma lease ativa
--   por conversa de cada canal de cada empresa.
--
-- Duração inicial: 3 minutos. Cobre:
--   - Avaliação de flows e criação de executions (~100ms)
--   - Chamada ao agente de IA (~10–15s)
--   - Envio pela Meta Graph API (~2–3s)
--   - Persistência e cleanup (~100ms)
--   Margem de segurança para flows com múltiplos nós.
--   Configurável: o processador passa a duração desejada à RPC.
-- =====================================================================

CREATE TABLE public.automation_conversation_locks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL,
  conversation_id UUID        NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  schedule_id     UUID,       -- nullable: vínculo informativo com o schedule atual
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT acl_unique_conversation
    UNIQUE (company_id, channel, conversation_id)
);

-- Índice de suporte para queries de cleanup e expiração de leases.
--
-- Por que sem WHERE:
--   PostgreSQL exige que funções em predicados de índice parcial sejam
--   IMMUTABLE. A função now() é STABLE (valor consistente dentro de uma
--   transação, mas variável entre transações) — portanto não pode ser usada
--   em predicado parcial. A tentativa de usar WHERE expires_at < now()
--   resultaria em:
--     ERROR: functions in index predicate must be marked IMMUTABLE
--
--   O índice sem WHERE é correto: cobre todas as linhas e permite que
--   qualquer query filtrando por expires_at (incluindo expires_at < now())
--   utilize Index Scan. O custo de indexar linhas com expires_at no futuro
--   é irrelevante dado o volume pequeno esperado da tabela.
CREATE INDEX idx_acl_expires
  ON automation_conversation_locks (expires_at);

-- RLS: leitura/escrita somente por membros ou admin pai da empresa
ALTER TABLE public.automation_conversation_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY acl_select_member_or_parent_admin
  ON public.automation_conversation_locks
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

CREATE POLICY acl_insert_member_or_parent_admin
  ON public.automation_conversation_locks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

CREATE POLICY acl_update_member_or_parent_admin
  ON public.automation_conversation_locks
  FOR UPDATE
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
  WITH CHECK (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

CREATE POLICY acl_delete_member_or_parent_admin
  ON public.automation_conversation_locks
  FOR DELETE
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

COMMENT ON TABLE public.automation_conversation_locks IS
  'Lease atômica por conversa para o motor de automação.
   Serializa processamento de mensagens da mesma conversation_id.
   Substituível por pg_try_advisory_lock somente com conexão dedicada
   (sem pool). Leases expiradas são recuperadas atomicamente pela RPC.';

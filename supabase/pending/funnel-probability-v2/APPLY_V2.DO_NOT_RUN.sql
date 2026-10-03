-- NÃO EXECUTAR sem autorização explícita.
-- Banco compartilhado. Cria SOMENTE as RPCs v2. Não dropa as atuais.
-- Aplicar como postgres, com o conteúdo de
-- supabase/migrations/20261003120000_create_funnel_assignee_probability_range_v2.sql
--
-- lock_timeout 3s: falha rápido se o catálogo estiver lockado.
-- statement_timeout 30s: dois CREATE OR REPLACE; esperado < 5s.
-- idle_in_transaction 15s: não deixar transação aberta se a sessão travar.
--
-- A migration já contém SET/RESET de timeout, CREATE das v2,
-- ALTER OWNER TO postgres, REVOKE PUBLIC/anon/service_role,
-- GRANT authenticated e NOTIFY pgrst.
--
-- Se o cliente SQL não abrir transação sozinho:

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
-- << colar aqui o corpo da migration 20261003120000 >>
COMMIT;

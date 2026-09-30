# SQL enviado ao execute_sql (evidência)

Duas chamadas MCP `user-supabase` / `execute_sql`. Sem `BEGIN`/`COMMIT` explícitos.
Não há prova no servidor de que o runner envolveu cada chamada numa transação.

## Chamada 1 — positions

Ordem no **mesmo** `query`:

1. `DO $guard$` — aborta se `get_stage_positions_paged_assignee` já existir
2. `CREATE FUNCTION public.get_stage_positions_paged_assignee(...)` (corpo compactado: listas SELECT em menos linhas; mesma lógica do SQL revisado)
3. `REVOKE ALL ... FROM PUBLIC, anon, service_role`
4. `GRANT EXECUTE ... TO authenticated`

## Chamada 2 — counts

1. `DO $guard$` — aborta se `get_funnel_stage_counts_assignee` já existir
2. `CREATE FUNCTION public.get_funnel_stage_counts_assignee(...)`
3. `REVOKE ALL ... FROM PUBLIC, anon, service_role`
4. `GRANT EXECUTE ... TO authenticated`
5. `NOTIFY pgrst, 'reload schema'`

## Transação

**Não comprovável após o fato.** O que se sabe:

- Cada chamada foi um HTTP `execute_sql` separado (duas sessões possíveis).
- CREATE + ACL da **mesma** função foram o mesmo string SQL.
- Sem `BEGIN`/`COMMIT` no texto. Se o protocolo for simple-query, o Postgres trata o string como transação implícita; isso **não** foi inspecionado no runner.
- Se cada statement fez autocommit, existiu janela com ACL default (PUBLIC/anon/service_role) entre CREATE e REVOKE. O estado **atual** já está autenticado-only.

Não repetir apply. Não rollback nesta etapa.

# Reconciliação histórica (documentação local — não aplicar)

Projeto `etzdsywunlpbgxkphuil`. Sem alteração de `schema_migrations`. Sem DDL.

## Decisão

- **Manter** os registros MCP `20260930173216` e `20260930173335` como estão.
- **Documentar aqui** a execução real: os corpos das RPCs foram criados via `execute_sql`, não via esses records.
- **Não** criar outra migration / version só para uma nota de histórico.
- **Não** registrar `20260930150000` depois do fato.
- **Não** gravar `pg_get_functiondef` como se fosse a migration original.

O arquivo `20260930150000_PROPOSED_history_note.DO_NOT_APPLY.sql` ficou **retirado**. Não aplicar e não registrar.

---

## O que os records MCP contêm (manter)

| version | name | `statements` |
|---|---|---|
| `20260930173216` | `create_funnel_assignee_rpcs` | `CREATE TEMP` + `INSERT` baseline + `DO $preflight$`. Sem `CREATE FUNCTION`. |
| `20260930173335` | `create_funnel_assignee_rpc_functions` | `CREATE TEMP` + `INSERT` baseline. Sem `CREATE FUNCTION`. |
| `20260930150000` | — | Ausente. |

Export: `supabase/rollback/mcp_records_20260930173216_20260930173335.sql.txt`

## Execução real (fora do histórico MCP)

Duas chamadas `execute_sql`:

1. `DO $guard$` + `CREATE FUNCTION get_stage_positions_paged_assignee` + `REVOKE`/`GRANT`
2. `DO $guard$` + `CREATE FUNCTION get_funnel_stage_counts_assignee` + `REVOKE`/`GRANT` + `NOTIFY pgrst`

Payloads: `supabase/rollback/20260930150000_EXECUTE_SQL_PAYLOADS.md`

`pg_get_functiondef` vivo (md5 2026-09-30):

- `get_stage_positions_paged_assignee` → `48cfc690bcbaacd62d1c36eeff6a2d1f`
- `get_funnel_stage_counts_assignee` → `234df0f72a9efadb203698c77b822d7e`

## Script executável (outro banco virgem)

`supabase/pending/20260930150000_create_funnel_assignee_rpcs.sql` — não rodar neste projeto (os nomes `*_assignee` já existem).

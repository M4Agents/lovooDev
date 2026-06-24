# Rollback — Funis por Usuário

## ⚠️ AVISO CRÍTICO — Banco Compartilhado DEV/PROD

**DEV e PRODUÇÃO compartilham o mesmo banco Supabase.**
Qualquer rollback executado neste ambiente **afeta imediatamente a produção**.
Não execute scripts de rollback sem aprovação explícita e consciência do impacto em produção.

---

## Quando usar rollback

Executar o rollback quando, após a aplicação das migrations (M0 a M6c), ocorrer:

- Erro crítico em funcionalidade de produção (Kanban não carrega, Dashboard quebrado, etc.)
- Regressão de segurança identificada (acesso indevido a dados, RLS bypassada)
- Comportamento inesperado em fechamento ou movimentação de oportunidades
- Falha nos testes de validação pós-deploy
- Decisão de negócio de reverter a feature antes de ativá-la para usuários

**Não executar rollback em caso de:**
- Comportamento esperado da feature (is_enabled = true restringindo seller)
- Erros de frontend corrigíveis sem alteração de banco
- Dúvidas — verificar primeiro antes de reverter

---

## Ordem de rollback completo (recomendada)

Execute os scripts em ordem **do maior para o menor número**:

```
11_rollback_m6c_dashboard_rpcs.sql    → Restaura RPCs de Dashboard
10_rollback_m6b_reports_rpcs.sql      → Remove resolve_user_funnel_ids_access + restaura Reports
09_rollback_m6a_kanban_rpcs.sql       → Restaura RPCs do Kanban
08_rollback_m4_m5_settings_rpcs.sql   → Remove RPCs de settings
07_rollback_m3_sales_funnels_policy.sql → Restaura policy SELECT original de sales_funnels
06_rollback_m1_tables.sql             → Remove tabelas user_funnel_settings e user_allowed_funnels
05_rollback_m0_m2_helpers.sql         → Remove helpers auth_user_can_access_funnel e auth_user_is_partner_for_company
```

**Justificativa da ordem:** as funções dependem dos helpers. Remover os helpers (05) antes
de restaurar as RPCs que os referenciam (09, 10, 11) causaria erros de dependência.
Seguindo a ordem inversa, cada objeto é removido/substituído antes de seus dependentes.

### Rollback parcial

Se apenas uma camada apresentar problemas:
- Só dashboard com problema → executar apenas `11`
- Só reports com problema → executar apenas `10`
- Só Kanban com problema → executar apenas `09`
- Só policy de sales_funnels → executar apenas `07`

**Atenção:** rollback parcial de 05 (helpers) sem reverter 09+10+11 causará erros em produção.

---

## Quando usar restore de backup/snapshot em vez de rollback manual

Prefira **restore de backup** quando:

- O banco apresentar inconsistência de dados (registros corrompidos)
- Mais de 3 migrations foram aplicadas e há dependências complexas
- Houver dados gravados em `user_funnel_settings` ou `user_allowed_funnels` que precisam ser preservados
- O rollback manual falhar com erros inesperados
- Não for possível identificar exatamente quais migrations foram aplicadas

O Supabase oferece **Point-in-Time Recovery (PITR)** no painel.
Restaurar para um ponto antes da aplicação das migrations é sempre mais seguro
do que rollback manual quando há risco de inconsistência de dados.

---

## Riscos do rollback manual

### Risco 1 — Diferenças estruturais em M6a
M6a alterou o corpo das RPCs além do guard de acesso. As diferenças identificadas são:

**`close_opportunity` (M6a vs original):**
- M6a usa `INSERT INTO lead_stage_history` (tabela diferente)
- Original usa `INSERT INTO opportunity_stage_history` + `INSERT INTO opportunity_status_history`
- Consequência: registros em `opportunity_status_history` podem ter lacunas se M6a ficou ativo por tempo

**`move_opportunity` (M6a vs original):**
- M6a usa `INSERT INTO lead_stage_history`
- Original usa `INSERT INTO opportunity_stage_history`
- M6a perdeu a validação de `stage_type IS NULL` e a lógica de reversão para etapas `active`

**`get_stage_positions_paged` (M6a vs original):**
- M6a remove `tags`, `profile_picture_url` e `chat_conversations` da resposta JSON
- M6a adiciona `value_mode`, `computed_value`, `responsible_user_id`
- Consequência: o frontend pode apresentar campos ausentes até o rollback ser aplicado

### Risco 2 — Janela de inconsistência
Durante o rollback, entre a execução de `11` e `05`, haverá uma janela
onde algumas RPCs já foram restauradas mas os helpers ainda existem.
Isso é inofensivo — os helpers restaurados não são chamados pelas funções restauradas.

### Risco 3 — Dados gravados antes do rollback
Se algum usuário tiver `is_enabled = true` gravado em `user_funnel_settings`,
remover a tabela (rollback 06) apagará essas configurações permanentemente.
Fazer backup da tabela antes de executar o rollback 06 se houver dados relevantes:

```sql
-- Backup antes de executar 06_rollback_m1_tables.sql (se tabela existir)
CREATE TABLE user_funnel_settings_backup AS TABLE user_funnel_settings;
CREATE TABLE user_allowed_funnels_backup AS TABLE user_allowed_funnels;
```

### Risco 4 — Impacto em produção
Como DEV e PROD compartilham o banco, o rollback afeta usuários em produção em tempo real.
Execute somente em janela de baixo uso, com comunicação prévia à equipe.

---

## Como validar após rollback

Execute as seguintes verificações após cada rollback completo:

### 1. Verificar policy de sales_funnels
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'sales_funnels' AND cmd = 'SELECT';
-- Esperado: sf_select_member_or_parent_admin usando auth_user_is_company_member
```

### 2. Verificar helpers removidos
```sql
SELECT proname FROM pg_proc
WHERE proname IN ('auth_user_can_access_funnel', 'auth_user_is_partner_for_company',
                  'resolve_user_funnel_ids_access');
-- Esperado: 0 linhas (helpers removidos)
```

### 3. Verificar tabelas removidas
```sql
SELECT tablename FROM pg_tables
WHERE tablename IN ('user_funnel_settings', 'user_allowed_funnels')
  AND schemaname = 'public';
-- Esperado: 0 linhas (tabelas removidas)
```

### 4. Verificar constraint removida
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'sales_funnels'::regclass
  AND conname = 'sales_funnels_id_company_id_uniq';
-- Esperado: 0 linhas (constraint removida)
```

### 5. Funcional — Kanban carrega
- Acessar o Funil de Vendas em produção
- Verificar se os cards carregam normalmente
- Testar movimentação de card entre etapas
- Testar fechamento de oportunidade

### 6. Funcional — Reports carregam
- Acessar o módulo de Relatórios
- Testar Visão Geral, Por Etapa, Por Vendedor, Tempo de Ciclo

### 7. Funcional — Dashboard carrega
- Acessar o Dashboard
- Verificar Funil Executivo, Forecast e métricas de período

### 8. Verificar comportamento de usuários
- Todos os usuários (admin, manager, seller) devem ver todos os funis da empresa
- Nenhum usuário deve ser restrito por controle de funis (feature desativada pós-rollback)

---

## Estrutura dos arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `01_current_state_sales_funnels_policy.sql` | Estado atual da policy SELECT de sales_funnels |
| `02_current_state_kanban_rpcs.sql` | Estado atual das 5 RPCs do Kanban |
| `03_current_state_reports_rpcs.sql` | Estado atual das 4 RPCs de Reports |
| `04_current_state_dashboard_rpcs.sql` | Estado atual das 3 RPCs de Dashboard |
| `05_rollback_m0_m2_helpers.sql` | DROP dos helpers de acesso a funis |
| `06_rollback_m1_tables.sql` | DROP das tabelas e constraint |
| `07_rollback_m3_sales_funnels_policy.sql` | Restaura policy SELECT original |
| `08_rollback_m4_m5_settings_rpcs.sql` | DROP das RPCs de settings |
| `09_rollback_m6a_kanban_rpcs.sql` | Restaura RPCs do Kanban ao estado pré-M6a |
| `10_rollback_m6b_reports_rpcs.sql` | DROP de resolve_user_funnel_ids_access + restaura Reports |
| `11_rollback_m6c_dashboard_rpcs.sql` | Restaura RPCs de Dashboard ao estado pré-M6c |

---

## Observação sobre os arquivos de estado atual (01–04)

Os arquivos `01_current_state_*.sql` a `04_current_state_*.sql` representam
o estado do banco **extraído das migrations existentes**, não do banco em tempo real.
Se houver dúvida sobre o estado real do banco, consultar a definição atual
via Supabase Dashboard → Database → Functions antes de executar qualquer rollback.

---

## Responsáveis pela aprovação

Qualquer execução de rollback deve ser aprovada explicitamente pelo responsável técnico
antes de ser executada, dado o impacto direto em produção.

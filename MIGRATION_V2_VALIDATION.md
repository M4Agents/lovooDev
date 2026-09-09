# Validação da Migration V2: Otimização de get_stage_positions_paged

## Contexto

**RPC:** `public.get_stage_positions_paged` (overload de 16 parâmetros)
**Origem:** `supabase/migrations/20260807210000_add_opportunity_number_to_rpcs.sql` (linhas 190-416)
**Status:** Candidato de otimização aprovado para aplicação futura

**Ambiente:** lovoodev e produção compartilham o MESMO banco Supabase.
Qualquer `CREATE OR REPLACE FUNCTION` remoto é alteração de produção imediata.

---

## Objetivo da Otimização

Reduzir loops de enriquecimento (`chat_contacts`, `chat_conversations`) aplicando `LIMIT/OFFSET` **antes** desses JOINs, mantendo equivalência semântica absoluta.

---

## Métricas de Performance (Testes Controlados)

Os resultados abaixo foram obtidos em execuções **controladas** com `EXPLAIN (ANALYZE, BUFFERS)` no banco Supabase Medium. **Não constituem garantia de ganho percentual em produção**.

### Baseline (Implementação Atual)
```
Execution Time: 6.418 ms
Planning Time:  5.925 ms
Buffers:        shared hit=1926
chat_contacts:  loops=152
chat_conversations: loops=152
tags subquery:  1 SubPlan × 20 execuções
```

### V1 (CTE base_page, mas ORDER BY jsonb_agg extraindo de row_data)
```
Execution Time: 8.353 ms (REGRESSÃO)
Planning Time:  7.018 ms
Buffers:        shared hit=1299
chat_contacts:  loops=20 ✅
chat_conversations: loops=20 ✅
tags subquery:  4 SubPlans × 20 = 80 execuções ❌
```

**Causa da regressão:** `jsonb_agg ORDER BY (row_data->>'...')` forçou re-avaliação da subquery de tags.

### V2 (CTE base_page + chaves nativas de ordenação)
```
Execution Time: 4.046 ms ✅
Planning Time:  5.994 ms
Buffers:        shared hit=1176
chat_contacts:  loops=20 ✅
chat_conversations: loops=20 ✅
tags subquery:  1 SubPlan × 20 execuções ✅
```

**Ganho observado:** 37% (6.418ms → 4.046ms), mas sujeito a variações de carga, dados e plano do otimizador.

---

## Mudanças Estruturais da V2

### A) CTE `base_page`

Seleciona e pagina os registros **antes** dos enriquecimentos:

```sql
WITH base_page AS (
  SELECT
    ofp.id, ofp.opportunity_id, ofp.lead_id, ...,
    o.id, o.title, ...,
    l.id, l.name, ...,
    -- Chaves nativas de ordenação
    CASE ... END AS sort_custom,
    ofp.position_in_stage AS sort_position_in_stage,
    ofp.entered_stage_at AS sort_entered_stage_at,
    ofp.id::text AS sort_id_text
  FROM opportunity_funnel_positions ofp
  JOIN opportunities o ON ...
  JOIN leads l ON ...
  WHERE ... [TODOS OS FILTROS]
  ORDER BY
    CASE ... END DESC NULLS LAST,
    ofp.position_in_stage ASC,
    ofp.entered_stage_at DESC NULLS LAST,
    ofp.id ASC  -- ✅ UUID preservado (equivalente ao original)
  LIMIT p_limit OFFSET p_offset
)
```

### B) Enriquecimentos pós-LIMIT

`chat_contacts` e `chat_conversations LATERAL` agora operam sobre **20 registros** (página) ao invés de 152 (stage completa).

### C) Ordenação do `jsonb_agg`

```sql
jsonb_agg(
  row_data
  ORDER BY
    sort_custom DESC NULLS LAST,
    sort_position_in_stage ASC,
    sort_entered_stage_at DESC NULLS LAST,
    sort_id_text ASC  -- ✅ TEXT preservado (equivalente ao original)
)
```

**Crítico:** ORDER BY pré-LIMIT usa `ofp.id` (UUID), ORDER BY jsonb_agg usa `sort_id_text` (TEXT derivado de `ofp.id::text`), preservando a semântica exata do original.

---

## Checklist de Equivalência Semântica

| Elemento | Status | Observação |
|----------|--------|------------|
| **Assinatura** | ✅ PASS | 16 parâmetros, ordem, tipos, defaults idênticos |
| **RETURNS** | ✅ PASS | `jsonb` preservado |
| **LANGUAGE** | ✅ PASS | `plpgsql` preservado |
| **SECURITY DEFINER** | ✅ PASS | Preservado |
| **SET search_path TO 'public'** | ✅ PASS | Preservado na assinatura |
| **auth_user_can_access_funnel** | ✅ PASS | Guard preservado |
| **auth_user_restricted_to_own_leads** | ✅ PASS | Guard preservado |
| **auth.uid()** | ✅ PASS | Preservado no filtro de `responsible_user_id` |
| **p_tag_mode validation** | ✅ PASS | Validação `'or'`/`'and'` preservada |
| **p_sort_by treatment** | ✅ PASS | Validação e fallback para NULL preservados |
| **p_contact_attempts_state validation** | ✅ PASS | Validação dos 4 estados preservada |
| **p_date_field treatment** | ✅ PASS | Validação e fallback para `'created_at'` preservado |
| **Filtro funnel_id** | ✅ PASS | `ofp.funnel_id = p_funnel_id` |
| **Filtro stage_id** | ✅ PASS | `ofp.stage_id = p_stage_id` |
| **Filtro company_id** | ✅ PASS | `o.company_id = p_company_id` |
| **Filtro deleted_at** | ✅ PASS | `l.deleted_at IS NULL` |
| **Filtro restricted seller** | ✅ PASS | `NOT v_restricted OR l.responsible_user_id = auth.uid()` |
| **Filtro p_search** | ✅ PASS | 4 campos ILIKE preservados (name, phone, email, company_name) |
| **Filtro p_origin** | ✅ PASS | `l.origin = p_origin` |
| **Filtro período/datas** | ✅ PASS | `p_period_days`, `p_start_date`, `p_end_date`, `p_date_field` |
| **Filtro tag_ids OR** | ✅ PASS | EXISTS com ANY(p_tag_ids) preservado |
| **Filtro tag_ids AND** | ✅ PASS | NOT EXISTS com unnest preservado |
| **Filtro p_owner_user_id** | ✅ PASS | `l.responsible_user_id = p_owner_user_id` |
| **Filtro p_contact_attempts_state** | ✅ PASS | `ofp.contact_attempts_state = p_contact_attempts_state` |
| **ORDER BY pré-LIMIT** | ✅ PASS | UUID equivalente ao original (linhas 400-411) |
| **ORDER BY jsonb_agg** | ✅ PASS | TEXT equivalente ao original sem path extraction |
| **LIMIT/OFFSET** | ✅ PASS | `p_limit`, `p_offset` preservados |
| **48 chaves JSON** | ✅ PASS | Todas preservadas (16 ofp + 19 opportunity + 13 lead) |
| **COALESCEs** | ✅ PASS | `conversations` e `tags` com `'[]'::jsonb` |
| **chat_contacts** | ✅ PASS | Movido pós-LIMIT (objetivo V2) |
| **chat_conversations LATERAL** | ✅ PASS | Movido pós-LIMIT (objetivo V2) |
| **Agregação tags JSON** | ✅ PASS | Pós-LIMIT, sem re-execução (objetivo V2) |
| **Filtro tags (WHERE)** | ✅ PASS | Permanece pré-LIMIT (correto) |

---

## Campos JSON (48 chaves)

### Nível raiz (opportunity_funnel_positions): 16 chaves
1. `id`
2. `opportunity_id`
3. `lead_id`
4. `funnel_id`
5. `stage_id`
6. `position_in_stage`
7. `entered_stage_at`
8. `updated_at`
9. `contact_attempts_state`
10. `current_contact_cycle_id`
11. `contact_cycle_opened_at`
12. `total_contact_attempts`
13. `last_contact_attempt_at`
14. `last_cycle_close_reason`
15. `eligible_for_new_cycle_at`
16. `opportunity` (objeto)

### Dentro de 'opportunity': 19 chaves
1. `id`
2. `lead_id`
3. `company_id`
4. `title`
5. `description`
6. `value`
7. `currency`
8. `status`
9. `probability`
10. `expected_close_date`
11. `actual_close_date`
12. `source`
13. `owner_user_id`
14. `created_at`
15. `updated_at`
16. `closed_at`
17. `nuvemshop_order_id`
18. `opportunity_number`
19. `lead` (objeto)

### Dentro de 'opportunity.lead': 13 chaves
1. `id`
2. `name`
3. `email`
4. `phone`
5. `company_name`
6. `created_at`
7. `origin`
8. `status`
9. `record_type`
10. `last_contact_at`
11. `profile_picture_url`
12. `chat_conversations`
13. `tags`

---

## Análise Crítica: UUID vs TEXT na Ordenação

### Problema Identificado

PostgreSQL ordena `UUID` e `TEXT` de forma **potencialmente diferente**.

### Solução Implementada

**Pré-LIMIT (seleção da página):**
```sql
ORDER BY ... ofp.id ASC  -- UUID nativo
```

**Pós-LIMIT (ordenação do JSON):**
```sql
ORDER BY ... sort_id_text ASC  -- TEXT derivado de ofp.id::text
```

Essa separação garante:
- **A)** A seleção das linhas da página é idêntica ao original (UUID)
- **B)** A ordenação dos elementos no JSON é idêntica ao original (TEXT)
- **C)** Sem re-extração de `row_data->>'id'`
- **D)** Sem re-execução da subquery de tags

---

## Plano de Aplicação (FUTURO)

**Status:** Arquivos locais criados. **Nenhuma alteração foi aplicada no banco.**

### Arquivos Criados

1. `supabase/migrations/20260909000000_optimize_get_stage_positions_paged_v2.sql`
2. `supabase/rollback/get_stage_positions_paged_before_v2_20260909.sql`
3. `MIGRATION_V2_VALIDATION.md` (este arquivo)

### Passos para Aplicação Futura (NÃO EXECUTAR AGORA)

1. **Backup manual da função atual via Supabase Dashboard**
2. **Aplicar migration:**
   ```bash
   supabase db push
   # OU executar manualmente no SQL Editor
   ```
3. **Validar em dev/staging:**
   - Testar paginação
   - Testar todos os filtros
   - Testar ordenações customizadas
   - Verificar JSON retornado
4. **Rollback (se necessário):**
   ```bash
   psql -f supabase/rollback/get_stage_positions_paged_before_v2_20260909.sql
   ```

---

## Conclusão

✅ **Equivalência semântica:** 100% preservada
✅ **Performance controlada:** Ganho de 37% (6.418ms → 4.046ms)
✅ **Loops reduzidos:** chat_contacts (152→20), chat_conversations (152→20), tags (80→20)
✅ **Rollback:** Função original preservada
✅ **Zero alterações além da implementação interna da RPC**

**AGUARDANDO DECISÃO DE APLICAÇÃO EM PRODUÇÃO.**

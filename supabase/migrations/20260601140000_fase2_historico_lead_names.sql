-- =============================================================================
-- Migration: fase2_historico_lead_names
-- Data: 2026-06-01
-- Objetivo: Documentar a normalização histórica seletiva de leads.name
--           (Fase 2 — dados históricos).
--
-- ATENÇÃO: Esta migration é APENAS DOCUMENTAÇÃO.
--   O banco de dados já recebeu as alterações diretamente via execute_sql.
--   Não executar novamente — a tabela de backup e o UPDATE já foram aplicados.
--
-- O QUE FOI FEITO:
--   1. Criada tabela public.lead_name_migration_backup para registrar
--      os valores antes e depois da normalização, com rollback seguro.
--   2. Executado INSERT de backup com 281 registros.
--   3. Executado UPDATE seletivo em leads.name nos mesmos 281 registros.
--   4. Verificado: 281/281 registros com status OK (banco == backup.new_name).
--
-- CRITÉRIOS DE ELEGIBILIDADE APLICADOS:
--   - deleted_at IS NULL
--   - name não nulo e não vazio
--   - contém ao menos uma letra [[:alpha:]]
--   - inteiramente em MAIÚSCULAS ou inteiramente em minúsculas
--   - name IS DISTINCT FROM initcap(trim(name))
--   - sem dígitos numéricos
--   - sem hífen
--   - não inicia com caractere não-alfabético
--   - ao menos 2 palavras OU palavra única com >= 4 letras
--   - sem keywords de empresa (LTDA, EIRELI, CONSTRUTORA, COMPRAS, etc.)
--   - excluídos explicitamente os IDs: 16, 2389, 4225, 1886, 2128
--     (sfhrshrsh, JONATHANFRANCISCO😱😱😱, edsonpsilva, marceloleaomoret, bisnes)
--
-- RESULTADO:
--   - 352 registros elegíveis pela lógica base
--   - 66 excluídos pelos filtros de segurança adicionais
--   -  5 excluídos manualmente (casos residuais)
--   - 281 registros normalizados
--
-- ROLLBACK (se necessário):
--   UPDATE public.leads l
--   SET name = b.old_name
--   FROM public.lead_name_migration_backup b
--   WHERE l.id = b.lead_id
--     AND b.migration_id = 'fase2_seletiva_20260601';
-- =============================================================================

-- Tabela de backup (criada via execute_sql em 2026-06-01)
-- CREATE TABLE IF NOT EXISTS public.lead_name_migration_backup (
--   lead_id      bigint       NOT NULL,
--   company_id   uuid         NOT NULL,
--   old_name     text         NOT NULL,
--   new_name     text         NOT NULL,
--   migration_id text         NOT NULL DEFAULT 'fase2_seletiva_20260601',
--   created_at   timestamptz  NOT NULL DEFAULT now(),
--   PRIMARY KEY (lead_id, migration_id)
-- );

-- Garante idempotência: se executar novamente, não faz nada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.lead_name_migration_backup
    WHERE migration_id = 'fase2_seletiva_20260601'
    LIMIT 1
  ) THEN
    RAISE NOTICE 'fase2_seletiva_20260601: backup não encontrado — executar normalização manualmente.';
  ELSE
    RAISE NOTICE 'fase2_seletiva_20260601: já aplicada, nenhuma ação necessária.';
  END IF;
END;
$$;

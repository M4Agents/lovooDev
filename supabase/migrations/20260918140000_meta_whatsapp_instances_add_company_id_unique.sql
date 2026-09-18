-- =============================================================================
-- Meta WhatsApp Cloud API — MVP2 / Migration T1.1 (2C.2)
-- Tabela: public.meta_whatsapp_instances
--
-- Objetivo:
--   Adicionar UNIQUE CONSTRAINT em (company_id, id) para permitir
--   que a futura tabela meta_whatsapp_messages referencie
--   ambas as colunas via FOREIGN KEY composta:
--
--     FOREIGN KEY (company_id, instance_id)
--     REFERENCES public.meta_whatsapp_instances(company_id, id)
--
--   Essa FK composta garante declarativamente que company_id e instance_id
--   em meta_whatsapp_messages pertencem ao mesmo tenant —
--   sem depender de trigger ou validação exclusivamente via código.
--
-- Tipo da alteração: EXCLUSIVAMENTE ADDITIVE
--   - Adiciona 1 UNIQUE CONSTRAINT (company_id, id)
--   - Nenhuma coluna alterada
--   - Nenhuma row modificada
--   - Nenhum índice existente removido
--   - PK(id) e idx_mwi_phone_number_id_owner continuam intactos
--
-- Segurança:
--   - UNIQUE CONSTRAINT é a forma correta no PostgreSQL (15.x) para
--     servir como chave referenciada por FK composta.
--     CREATE UNIQUE INDEX manual NÃO é aceito como alvo de FK.
--   - ADD CONSTRAINT UNIQUE cria internamente um supporting index.
--   - Verificado: 0 duplicatas em (company_id, id) — migration é segura.
--
-- Rollback (se necessário, SOMENTE com aprovação explícita):
--   ALTER TABLE public.meta_whatsapp_instances
--   DROP CONSTRAINT mwi_company_id_id_unique;
--   (O supporting index é removido automaticamente com a constraint.)
-- =============================================================================

ALTER TABLE public.meta_whatsapp_instances
  ADD CONSTRAINT mwi_company_id_id_unique
  UNIQUE (company_id, id);

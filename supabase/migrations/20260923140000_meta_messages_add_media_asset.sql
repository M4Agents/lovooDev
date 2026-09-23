-- =============================================================
-- Migration: 20260923140000_meta_messages_add_media_asset.sql
-- MVP4B — Etapa 4B.5
-- Aditiva pura: sem DROP, sem backfill, sem alteração de RLS
-- =============================================================
--
-- Objetivo:
--   Permitir que meta_messages referencie opcionalmente um asset
--   de company_media_library com integridade multi-tenant
--   garantida pelo PostgreSQL (FK composta tenant-aware).
--
-- Requerimento obrigatório:
--   PostgreSQL >= 15 (ON DELETE SET NULL com lista de colunas)
--   Verificado: SHOW server_version → '15.8'
--
-- Preconditions verificadas (2026-09-23, read-only):
--   company_media_library.id          → UUID NOT NULL (PK)
--   company_media_library.company_id  → UUID NOT NULL
--   meta_messages.company_id          → UUID NOT NULL
--   UNIQUE(company_id, id) em cml     → NÃO EXISTE → criando aqui
--   meta_messages.media_asset_id      → NÃO EXISTE → criando aqui
--   duplicatas (company_id, id) em cml → 0
--   NULLs em cml.company_id           → 0
--   NULLs em mm.company_id            → 0
-- =============================================================

-- -------------------------------------------------------------
-- PASSO 1: Unique constraint tenant-aware em company_media_library
-- -------------------------------------------------------------
-- Necessário para que a FK composta (company_id, media_asset_id)
-- tenha um target UNIQUE compatível além do PK simples em (id).
-- Sem este UNIQUE, o PostgreSQL rejeita a FK composta porque o
-- PK(id) não cobre company_id — impossível garantir tenant-safety
-- apenas via PK.
--
-- Efeito: impede cross-tenant no nível do banco — a FK só enxerga
-- pares (company_id, id) confirmadamente pertencentes à mesma empresa.
--
-- O nome segue o padrão uq_<tabela>_<colunas>; confirmado ausente.

ALTER TABLE public.company_media_library
  ADD CONSTRAINT uq_company_media_library_company_id_id
  UNIQUE (company_id, id);

-- -------------------------------------------------------------
-- PASSO 2: Coluna media_asset_id em meta_messages
-- -------------------------------------------------------------
-- NULL = mensagem sem asset referenciado (text, template text, etc.)
-- Sem DEFAULT: linhas existentes ficam NULL sem backfill.
-- Sem NOT NULL: compatibilidade total com todo fluxo atual (Uazapi,
-- template text, inbound).

ALTER TABLE public.meta_messages
  ADD COLUMN media_asset_id UUID NULL;

-- -------------------------------------------------------------
-- PASSO 3: FK composta tenant-safe com ON DELETE SET NULL parcial
-- -------------------------------------------------------------
-- PostgreSQL >=15: ON DELETE SET NULL (media_asset_id) garante que
-- somente media_asset_id é zerado no DELETE do asset referenciado.
-- company_id NÃO é tocado — a mensagem mantém seu tenant original.
--
-- Garantias por cenário:
--   T1: msg company=A + asset company=A → FK satisfeita → OK
--   T2: msg company=A + asset company=B → FK falha → REJEITADO
--   T3: media_asset_id = NULL → FK não aplica → OK
--   T4: asset deletado → media_asset_id → NULL; company_id permanece A
--   T5: msgs históricas (media_asset_id NULL) → inalteradas → OK
--   T6: fluxo Uazapi (sem media_asset_id) → campo NULL → intacto
--
-- CASCADE é explicitamente proibido neste contexto:
--   deletar um asset NÃO deve deletar a mensagem histórica.

ALTER TABLE public.meta_messages
  ADD CONSTRAINT meta_messages_company_media_asset_fk
  FOREIGN KEY (company_id, media_asset_id)
  REFERENCES public.company_media_library (company_id, id)
  ON DELETE SET NULL (media_asset_id);

-- -------------------------------------------------------------
-- ÍNDICE NO LADO REFERENCING: decisão explícita de NÃO adicionar
-- -------------------------------------------------------------
-- A FK não cria índice automaticamente em meta_messages.
-- Análise (2026-09-23):
--   volume meta_messages = 16 rows → seqscan irrelevante
--   volume company_media_library = 537 assets → DELETE raro em prod
--   lookup por media_asset_id não é parte de nenhuma query mapeada
--
-- Conclusão: sem necessidade concreta hoje.
-- Um índice parcial em (company_id, media_asset_id) WHERE media_asset_id IS NOT NULL
-- será adicionado em migration separada quando volume justificar
-- ou quando queries de lookup forem implementadas.
--
-- Impacto da ausência hoje: seqscan em 16 rows = microssegundos.

-- -------------------------------------------------------------
-- RLS / REALTIME: NADA ALTERADO
-- -------------------------------------------------------------
-- RLS continua habilitado em ambas as tabelas (rowsecurity = true).
-- Policy única de meta_messages (meta_messages_select_meta_view)
-- continua baseada em company_id + membership — inalterada.
-- Nenhuma policy nova, sem ALTER PUBLICATION, sem replica identity.

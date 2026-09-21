-- =============================================================================
-- Migration: create_meta_conversations
-- Timestamp: 20260921100000
--
-- Objetivo:
--   Criar a tabela public.meta_conversations para persistência de conversas
--   inbound do Meta WhatsApp Cloud API (MVP3A).
--
-- Escopo MVP3A:
--   - Backend-only: nenhuma policy para authenticated/anon.
--   - Sem Realtime: sem REPLICA IDENTITY FULL e sem publicação.
--   - Inbound text apenas: campos adicionais (media_url, ai_state, etc.)
--     serão adicionados em migrations subsequentes.
--
-- Isolamento multi-tenant:
--   - FK composta (company_id, instance_id) → meta_whatsapp_instances(company_id, id)
--     impede estruturalmente que uma conversation de company A aponte para
--     uma Meta instance de company B.
--   - Pré-requisito: UNIQUE (company_id, id) em meta_whatsapp_instances
--     existe via migration 20260918140000 (mwi_company_id_id_unique).
--
-- Idempotência de conversa:
--   - UNIQUE (company_id, instance_id, wa_id) garante uma única conversa
--     por contato dentro da mesma instância e tenant.
--
-- updated_at:
--   - Mantido por trigger via public.update_updated_at_column() — função
--     já existente no projeto, usada por instagram_conversations e outras
--     tabelas. Seguro para múltiplos caminhos de atualização (RPC inbound,
--     unread reset, lead linking futuro).
--
-- RLS:
--   - service_role-only, mesmo padrão de meta_whatsapp_messages e
--     meta_whatsapp_credentials. Policy authenticated será adicionada
--     somente quando existir consumer frontend (MVP3C).
--
-- Backward-compatible:
--   - 100% aditiva; nenhuma tabela existente é alterada.
--   - Não altera meta_whatsapp_messages, chat_conversations, chat_messages
--     ou qualquer tabela Uazapi/Instagram.
--
-- Rollback conceitual (em caso de necessidade):
--   DROP TABLE IF EXISTS public.meta_conversations;
-- =============================================================================

-- =============================================================================
-- TABELA PRINCIPAL
-- =============================================================================

CREATE TABLE public.meta_conversations (

  -- Identificador interno
  id                   UUID        NOT NULL DEFAULT gen_random_uuid(),

  -- Multi-tenant: company_id é obrigatório e é a raiz de todo isolamento.
  -- FK → companies garante referential integrity e cascade delete.
  company_id           UUID        NOT NULL,

  -- Qual instância Meta recebeu esta conversa.
  -- Junto com company_id forma a FK composta para meta_whatsapp_instances.
  instance_id          UUID        NOT NULL,

  -- Identificador WhatsApp do contato externo.
  -- Valor exato de messages[].from do webhook Meta Cloud API.
  -- Formato: wa_id (E.164 sem "+", ex: "5511987654321").
  -- Nunca normalizado ou prefixado nesta migration.
  wa_id                TEXT        NOT NULL,

  -- Nome de exibição do contato.
  -- Origem: contacts[0].profile.name (opcional no payload Meta).
  -- Nullable: contacts[] pode estar ausente no webhook.
  -- Pode ser atualizado pela RPC de processamento inbound.
  contact_name         TEXT        NULL,

  -- Estado da conversa.
  -- Padrão do projeto (instagram_conversations): TEXT com CHECK.
  -- Não usar enum PostgreSQL para manter flexibilidade de ALTER.
  -- Valores válidos MVP3A: 'active' | 'archived'.
  -- Apenas 'active' será produzido por MVP3A; 'archived' reservado para UI futura.
  status               TEXT        NOT NULL DEFAULT 'active',

  -- Contador de mensagens inbound não lidas.
  -- Incrementado pela RPC de processamento inbound.
  -- Resetado para 0 quando operador visualizar a conversa (MVP3C+).
  -- CHECK >= 0 impede valores negativos por bug de concorrência.
  unread_count         INTEGER     NOT NULL DEFAULT 0,

  -- Timestamp da última mensagem (inbound ou outbound futuro).
  -- Nullable: nova conversa sem mensagens ainda (raro, mas possível).
  -- Usado para ordenação da lista de conversas.
  last_message_at      TIMESTAMPTZ NULL,

  -- Preview da última mensagem (máximo 100 chars, truncado pela RPC).
  -- Nullable: mesma razão que last_message_at.
  last_message_preview TEXT        NULL,

  -- Timestamps de auditoria
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ─────────────────────────────────────────────────────────────────────────
  -- CONSTRAINTS
  -- ─────────────────────────────────────────────────────────────────────────

  -- PK
  CONSTRAINT meta_conversations_pkey
    PRIMARY KEY (id),

  -- FK → companies: isolamento multi-tenant de nível 1.
  -- CASCADE: se a empresa for deletada, as conversas são removidas.
  CONSTRAINT mc_company_fk
    FOREIGN KEY (company_id)
    REFERENCES public.companies(id)
    ON DELETE CASCADE,

  -- FK composta → meta_whatsapp_instances(company_id, id):
  -- Garante estruturalmente que company_id e instance_id pertencem ao mesmo tenant.
  -- Impede que uma conversation de company A aponte para uma Meta instance de company B.
  -- Pré-requisito: UNIQUE (company_id, id) em meta_whatsapp_instances
  --   (migration 20260918140000 — mwi_company_id_id_unique).
  -- CASCADE: se a instância Meta for removida, as conversas são removidas.
  CONSTRAINT mc_company_instance_fk
    FOREIGN KEY (company_id, instance_id)
    REFERENCES public.meta_whatsapp_instances(company_id, id)
    ON DELETE CASCADE,

  -- Idempotência de conversa: uma única thread por contato/wa_id dentro
  -- da mesma instância Meta e tenant.
  -- Também serve como chave de lookup no UPSERT da RPC.
  CONSTRAINT mc_company_instance_wa_id_unique
    UNIQUE (company_id, instance_id, wa_id),

  -- Garante que status é sempre um dos valores conhecidos.
  -- Padrão do projeto (mesmo padrão de instagram_conversations).
  CONSTRAINT mc_status_check
    CHECK (status IN ('active', 'archived')),

  -- Proteção contra unread_count negativo (bug de concorrência ou update incorreto).
  CONSTRAINT mc_unread_count_check
    CHECK (unread_count >= 0)

);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.meta_conversations IS
'Conversas do Meta WhatsApp Cloud API (MVP3A). '
'Uma linha por contato (wa_id) por instância Meta por empresa. '
'Backend-only em MVP3A; sem policy authenticated até MVP3C.';

COMMENT ON COLUMN public.meta_conversations.wa_id IS
'WhatsApp ID do contato externo — valor de messages[].from do webhook Meta. '
'Formato E.164 sem "+", exatamente como recebido pela Meta Cloud API. '
'Não normalizado nem prefixado.';

COMMENT ON COLUMN public.meta_conversations.contact_name IS
'Nome de exibição do contato. '
'Origem: contacts[0].profile.name no webhook (campo opcional). '
'Nullable: contacts[] pode estar ausente no payload Meta.';

COMMENT ON COLUMN public.meta_conversations.status IS
'Estado da conversa. Valores: active (padrão) | archived. '
'Apenas active é produzido em MVP3A. archived será usado pela UI (MVP3C+).';

COMMENT ON COLUMN public.meta_conversations.unread_count IS
'Mensagens inbound não lidas. '
'Incrementado atomicamente pela RPC de processamento inbound. '
'Reset para 0 pelo operador ao visualizar a conversa (MVP3C+).';

COMMENT ON COLUMN public.meta_conversations.last_message_at IS
'Timestamp da última mensagem. Usado para ordenação da lista de conversas.';

COMMENT ON COLUMN public.meta_conversations.last_message_preview IS
'Preview da última mensagem, truncado em 100 caracteres pela RPC.';

COMMENT ON COLUMN public.meta_conversations.updated_at IS
'Atualizado automaticamente pelo trigger mc_update_updated_at '
'(usa public.update_updated_at_column(), função existente no projeto).';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Índice para listagem ordenada de conversas por instância.
-- Suporta a query principal da sidebar do Chat (MVP3C):
--   WHERE company_id = ? AND instance_id = ? ORDER BY last_message_at DESC
-- Nota: UNIQUE (company_id, instance_id, wa_id) já cria um índice interno,
-- mas não serve para ordenação por last_message_at.
CREATE INDEX idx_mc_company_instance_last_message
  ON public.meta_conversations (company_id, instance_id, last_message_at DESC);

-- =============================================================================
-- TRIGGER updated_at
-- =============================================================================

-- Usa public.update_updated_at_column() — função já existente no projeto.
-- Garante que updated_at reflete a última modificação independentemente
-- do caminho de atualização (RPC inbound, reset unread, lead linking, etc.).
-- Padrão estabelecido por instagram_conversations e outras tabelas do projeto.
CREATE TRIGGER mc_update_updated_at
  BEFORE UPDATE ON public.meta_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- RLS — service_role-only (MVP3A backend-only)
-- =============================================================================

ALTER TABLE public.meta_conversations ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY para authenticated ou anon.
-- authenticated: acesso bloqueado por RLS default (sem policy = sem acesso).
-- anon: idem.
-- service_role: bypassa RLS automaticamente (backend via getSupabaseAdmin()).
-- Policy SELECT para authenticated será adicionada em MVP3C (Chat UI).
-- Mesmo padrão de meta_whatsapp_messages e meta_whatsapp_credentials.

-- =============================================================================
-- GRANT / REVOKE
-- =============================================================================

-- Revogar acesso de PUBLIC, anon e authenticated.
-- Mesmo padrão de meta_whatsapp_messages e meta_whatsapp_credentials.
REVOKE ALL ON TABLE public.meta_conversations FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_conversations FROM anon;
REVOKE ALL ON TABLE public.meta_conversations FROM authenticated;

-- service_role é o único papel de aplicação com acesso direto.
-- Acesso exclusivamente via backend (getSupabaseAdmin()).
GRANT ALL ON TABLE public.meta_conversations TO service_role;

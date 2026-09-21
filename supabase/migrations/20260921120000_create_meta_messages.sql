-- =============================================================================
-- Migration: create_meta_messages
-- Timestamp: 20260921120000
--
-- Objetivo:
--   Criar a tabela public.meta_messages para persistência de mensagens
--   inbound do Meta WhatsApp Cloud API (MVP3A).
--
-- Dependência obrigatória:
--   Esta migration depende de:
--   1. 20260921100000_create_meta_conversations.sql (M1) — tabela base
--   2. 20260921110000_alter_meta_conversations_add_company_instance_id_unique.sql
--      (M1.5) — UNIQUE (company_id, instance_id, id) em meta_conversations,
--      necessário para a FK composta tripla definida abaixo.
--
-- Escopo MVP3A:
--   - Backend-only: nenhuma policy para authenticated/anon.
--   - Sem Realtime: sem REPLICA IDENTITY FULL e sem publicação.
--   - Inbound text apenas: CHECK (message_type IN ('text')).
--   - direction CHECK ('inbound', 'outbound') preparado para MVP3D outbound.
--
-- Separação de responsabilidades:
--   - public.meta_messages: conteúdo/conversa (esta tabela).
--   - public.meta_whatsapp_messages: tracking operacional outbound MVP2.
--   Sem relação direta entre as duas tabelas. Correlação via wamid (meta_message_id).
--
-- Isolamento multi-tenant (tripla camada estrutural):
--   1. company_id → companies(id): verifica existência da empresa.
--   2. (company_id, instance_id, conversation_id)
--      → meta_conversations(company_id, instance_id, id):
--      garante que a mensagem pertence a uma conversa do MESMO tenant E
--      da MESMA instância Meta. Impede structuralmente que uma mensagem
--      de company A referencie uma conversa de company B.
--   3. meta_conversations já possui FK composta para meta_whatsapp_instances,
--      garantindo transitivamente que instance_id pertence ao tenant correto.
--
-- Idempotência de mensagem:
--   UNIQUE (instance_id, meta_message_id): o wamid é único por instância Meta.
--   Sem índice parcial (ambas as colunas são NOT NULL no MVP3A inbound).
--
-- Decisões de schema:
--   - direction CHECK ('inbound', 'outbound'): preparado para MVP3D.
--     Apenas 'inbound' é inserido pela RPC de MVP3A.
--   - message_type CHECK ('text'): restrito ao escopo MVP3A.
--     Alterar quando tipos adicionais forem suportados (MVP3X+).
--   - body NULL: necessário para extensibilidade futura.
--     Quando message_type aceitar 'image', 'audio', etc., body não existirá.
--     A RPC de inbound text validará body IS NOT NULL em código.
--   - provider_timestamp NULL: Meta Cloud API fornece timestamp Unix em
--     messages[].timestamp, mas pode estar ausente em cenários edge.
--
-- updated_at:
--   Trigger via public.update_updated_at_column() — função existente,
--   padrão aprovado em meta_conversations e instagram_conversations.
--
-- RLS:
--   service_role-only, igual a meta_conversations e meta_whatsapp_messages.
--   Policy SELECT para authenticated será adicionada em MVP3E (Realtime).
--
-- Backward-compatible:
--   100% aditiva. Nenhuma tabela existente é alterada por esta migration.
--   meta_whatsapp_messages, chat_conversations, chat_messages e
--   whatsapp_life_instances permanecem intactas.
--
-- Rollback conceitual:
--   DROP TABLE IF EXISTS public.meta_messages;
-- =============================================================================

-- =============================================================================
-- TABELA PRINCIPAL
-- =============================================================================

CREATE TABLE public.meta_messages (

  -- Identificador interno
  id                   UUID        NOT NULL DEFAULT gen_random_uuid(),

  -- Multi-tenant: company_id obrigatório, raiz do isolamento.
  -- FK simples → companies: garante existência da empresa.
  -- Também compõe a FK tripla composta abaixo.
  company_id           UUID        NOT NULL,

  -- Conversa a que esta mensagem pertence.
  -- Junto com company_id e instance_id, forma a FK composta tripla.
  conversation_id      UUID        NOT NULL,

  -- Instância Meta que recebeu/enviou esta mensagem.
  -- Junto com company_id e conversation_id, fecha o isolamento tenant/instância.
  instance_id          UUID        NOT NULL,

  -- ID da mensagem no Meta Cloud API (wamid).
  -- Valor de messages[].id no payload de webhook inbound.
  -- Formato: "wamid.xxx..." (string opaca, não interpretar).
  -- Junto com instance_id, garante idempotência via UNIQUE abaixo.
  meta_message_id      TEXT        NOT NULL,

  -- Direção da mensagem em relação ao operador.
  -- 'inbound': mensagem do cliente para o operador (MVP3A).
  -- 'outbound': mensagem do operador para o cliente (MVP3D+).
  -- CHECK preparado para MVP3D; apenas 'inbound' é produzido em MVP3A.
  direction            TEXT        NOT NULL DEFAULT 'inbound',

  -- Tipo de conteúdo da mensagem.
  -- MVP3A: somente 'text'. Expandir CHECK em migration futura (MVP3X+).
  message_type         TEXT        NOT NULL DEFAULT 'text',

  -- Corpo textual da mensagem.
  -- Para type='text': valor de messages[].text.body (sempre presente por contrato Meta).
  -- NOT NULL: MVP3A aceita exclusivamente message_type='text', para o qual body
  -- é obrigatório por contrato Meta. Integridade garantida pelo banco, não só pela RPC.
  -- Quando tipos não-texto forem suportados (MVP3X+), esta coluna será relaxada
  -- via ALTER TABLE (ou substituída por JSONB genérico) em migration futura.
  body                 TEXT        NOT NULL,

  -- Timestamp Unix da mensagem conforme reportado pela Meta Cloud API.
  -- Origem: messages[].timestamp (inteiro Unix, convertido para TIMESTAMPTZ pela RPC).
  -- NULL: tolerado para casos edge onde timestamp esteja ausente no payload.
  provider_timestamp   TIMESTAMPTZ NULL,

  -- Timestamps de auditoria
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ─────────────────────────────────────────────────────────────────────────
  -- CONSTRAINTS
  -- ─────────────────────────────────────────────────────────────────────────

  -- PK
  CONSTRAINT meta_messages_pkey
    PRIMARY KEY (id),

  -- FK simples → companies: isolamento multi-tenant de nível 1.
  -- CASCADE: se a empresa for deletada, as mensagens são removidas.
  CONSTRAINT mm_company_fk
    FOREIGN KEY (company_id)
    REFERENCES public.companies(id)
    ON DELETE CASCADE,

  -- FK composta tripla → meta_conversations(company_id, instance_id, id):
  -- Garante estruturalmente que:
  --   a) a conversa pertence ao mesmo tenant (company_id bate);
  --   b) a instância Meta é a mesma (instance_id bate);
  --   c) a conversa existe de fato (id bate).
  -- Impede que uma mensagem de company A aponte para conversa de company B.
  -- Requer UNIQUE (company_id, instance_id, id) em meta_conversations
  --   → adicionado em M1.5 (20260921110000).
  -- CASCADE: se a conversa for removida, as mensagens são removidas.
  CONSTRAINT mm_company_instance_conversation_fk
    FOREIGN KEY (company_id, instance_id, conversation_id)
    REFERENCES public.meta_conversations(company_id, instance_id, id)
    ON DELETE CASCADE,

  -- Idempotência de mensagem: um wamid não pode aparecer duas vezes
  -- dentro da mesma instância Meta.
  -- Sem índice parcial: ambas as colunas são NOT NULL (sem condição WHERE).
  -- Serve como chave de deduplicação na RPC de processamento inbound.
  CONSTRAINT mm_instance_meta_message_id_unique
    UNIQUE (instance_id, meta_message_id),

  -- Valores válidos para direction.
  -- MVP3A produz somente 'inbound'; 'outbound' reservado para MVP3D.
  CONSTRAINT mm_direction_check
    CHECK (direction IN ('inbound', 'outbound')),

  -- Valores válidos para message_type.
  -- Restrito a 'text' no MVP3A. Expandir em migration futura.
  CONSTRAINT mm_message_type_check
    CHECK (message_type IN ('text'))

);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.meta_messages IS
'Mensagens do Meta WhatsApp Cloud API (MVP3A). '
'Conteúdo/conversa: separado de meta_whatsapp_messages (tracking operacional MVP2). '
'Backend-only em MVP3A; sem policy authenticated até MVP3E.';

COMMENT ON COLUMN public.meta_messages.meta_message_id IS
'ID da mensagem no Meta Cloud API (wamid). '
'Valor de messages[].id no webhook inbound. '
'String opaca — não interpretar estrutura interna.';

COMMENT ON COLUMN public.meta_messages.direction IS
'Direção: inbound (cliente→operador) | outbound (operador→cliente). '
'MVP3A produz somente inbound. outbound reservado para MVP3D.';

COMMENT ON COLUMN public.meta_messages.message_type IS
'Tipo de conteúdo. MVP3A: somente text. '
'CHECK expandido em migration futura ao suportar outros tipos.';

COMMENT ON COLUMN public.meta_messages.body IS
'Corpo textual. Para type=text: messages[].text.body (sempre presente por contrato Meta). '
'NOT NULL: MVP3A é exclusivamente text; body é obrigatório por contrato. '
'Relaxar para NULL via migration futura ao suportar tipos não-texto.';

COMMENT ON COLUMN public.meta_messages.provider_timestamp IS
'Timestamp Unix da mensagem conforme Meta Cloud API (messages[].timestamp). '
'Convertido para TIMESTAMPTZ pela RPC. NULL tolerado para casos edge.';

COMMENT ON COLUMN public.meta_messages.updated_at IS
'Atualizado automaticamente pelo trigger mm_update_updated_at '
'(usa public.update_updated_at_column(), função existente no projeto).';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Índice para leitura do thread de mensagens de uma conversa.
-- Suporta a query principal da ChatArea (MVP3C/MVP3E):
--   WHERE company_id = ? AND conversation_id = ?
--   ORDER BY provider_timestamp ASC NULLS LAST
-- NULLS LAST: mensagens sem timestamp Meta vão ao final (comportamento correto).
-- Nota: UNIQUE (instance_id, meta_message_id) já cria índice para lookup de wamid.
-- Nota: FK (company_id, instance_id, conversation_id) NÃO cria índice automático
--       na tabela referenciadora — este índice supre essa necessidade.
CREATE INDEX idx_mm_company_conversation_timestamp
  ON public.meta_messages (company_id, conversation_id, provider_timestamp ASC NULLS LAST);

-- =============================================================================
-- TRIGGER updated_at
-- =============================================================================

-- Usa public.update_updated_at_column() — função existente no projeto.
-- Mesmo padrão de meta_conversations e instagram_conversations.
CREATE TRIGGER mm_update_updated_at
  BEFORE UPDATE ON public.meta_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- RLS — service_role-only (MVP3A backend-only)
-- =============================================================================

ALTER TABLE public.meta_messages ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY para authenticated ou anon.
-- authenticated: acesso bloqueado por RLS default (sem policy = sem acesso).
-- anon: idem.
-- service_role: bypassa RLS automaticamente (backend via getSupabaseAdmin()).
-- Policy SELECT para authenticated será adicionada em MVP3E (Realtime + Chat UI).
-- Mesmo padrão de meta_conversations e meta_whatsapp_messages.

-- =============================================================================
-- GRANT / REVOKE
-- =============================================================================

-- Revogar acesso de PUBLIC, anon e authenticated.
REVOKE ALL ON TABLE public.meta_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_messages FROM anon;
REVOKE ALL ON TABLE public.meta_messages FROM authenticated;

-- service_role é o único papel de aplicação com acesso direto.
-- Acesso exclusivamente via backend (getSupabaseAdmin()).
GRANT ALL ON TABLE public.meta_messages TO service_role;

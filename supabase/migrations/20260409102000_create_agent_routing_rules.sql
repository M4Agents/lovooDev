-- =====================================================
-- MIGRATION: Criar tabela agent_routing_rules
-- Data: 2026-04-09
-- Etapa: 5/13
--
-- Propósito:
--   Define QUANDO e EM QUE CONTEXTO um assignment deve ser ativado.
--   Separa "o que o agente faz" (assignment) de "quando é ativado" (routing rule).
--
-- Lógica do Router:
--   1. Recebe evento com (company_id, channel, event_type, source_type, source_identifier)
--   2. Busca regras ativas da empresa ordenadas por priority ASC (menor = mais alta)
--   3. Aplica match pela especificidade:
--      - source_identifier NOT NULL = mais específica (número exato)
--      - source_type NOT NULL = intermediária (tipo de origem)
--      - is_fallback = true = menos específica (catch-all)
--   4. Usa o primeiro match válido
--
-- Campos de filtro:
--   channel           — filtro de canal ('whatsapp', 'web', '*' para qualquer)
--   event_type        — filtro de evento ('message.received', 'lead.created', etc.)
--   source_type       — filtro de origem ('whatsapp_number', 'form', 'webhook', etc.)
--   source_identifier — filtro por identificador exato (ex: número de telefone)
--   is_fallback       — true = regra catch-all quando nenhuma outra bater
--
-- Dependências: Migration 4 (company_agent_assignments) deve existir.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_routing_rules (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant obrigatório
  company_id            UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Assignment que será ativado quando esta regra bater
  assignment_id         UUID          NOT NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE CASCADE,

  -- Canal de entrada — '*' significa qualquer canal (globbing manual pelo Router)
  -- Para MVP, usar 'whatsapp'
  channel               TEXT          NOT NULL DEFAULT 'whatsapp'
                          CHECK (channel IN ('whatsapp', 'web', 'email', 'sms', '*')),

  -- Evento que disparou o processamento
  -- Exemplos: 'message.received', 'lead.created', 'conversation.reopened',
  --           'conversation.idle_timeout', 'human.released_to_ai'
  -- NULL = qualquer evento (menos específico)
  event_type            TEXT          NULL,

  -- Tipo da origem da conversa/evento
  -- Exemplos: 'whatsapp_number', 'form', 'webhook_import', 'manual'
  -- NULL = qualquer origem (menos específico)
  source_type           TEXT          NULL,

  -- Identificador exato da origem (ex: número de WhatsApp '5511999999999')
  -- NULL = qualquer identificador (menos específico)
  -- Quando preenchido: mais alta prioridade de match
  source_identifier     TEXT          NULL,

  -- Prioridade de execução: menor número = maior prioridade
  -- O Router ordena por priority ASC e usa o primeiro match
  priority              SMALLINT      NOT NULL DEFAULT 100
                          CHECK (priority BETWEEN 1 AND 999),

  -- Fallback: se true, esta regra é usada quando nenhuma outra bater
  -- Deve ser a regra menos específica possível
  -- Apenas uma regra is_fallback = true por company_id + channel é recomendável
  is_fallback           BOOLEAN       NOT NULL DEFAULT false,

  -- Controle de ativação sem deleção física
  is_active             BOOLEAN       NOT NULL DEFAULT true,

  -- Metadados opcionais para diagnóstico no painel admin
  description           TEXT          NULL,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Impede duplicação exata de regras para a mesma empresa/assignment
  CONSTRAINT uq_routing_rule UNIQUE (
    company_id, assignment_id, channel, event_type, source_type, source_identifier
  )
);

-- Índice principal: o Router busca regras ativas por empresa e canal
CREATE INDEX IF NOT EXISTS idx_routing_rules_lookup
  ON public.agent_routing_rules (company_id, channel, priority ASC)
  WHERE is_active = true;

-- Índice para cascade: verificar todas as regras de um assignment
CREATE INDEX IF NOT EXISTS idx_routing_rules_assignment
  ON public.agent_routing_rules (assignment_id);

-- Trigger para manter updated_at
CREATE OR REPLACE FUNCTION public.update_routing_rule_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_routing_rules_updated_at
  BEFORE UPDATE ON public.agent_routing_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_routing_rule_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_routing_rules ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro autenticado da empresa
CREATE POLICY "routing_rules_select"
  ON public.agent_routing_rules FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.is_active  IS NOT FALSE
    )
  );

-- INSERT: apenas admin ou superior
CREATE POLICY "routing_rules_insert"
  ON public.agent_routing_rules FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  );

-- UPDATE: apenas admin ou superior
CREATE POLICY "routing_rules_update"
  ON public.agent_routing_rules FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       IN ('super_admin', 'system_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
  );

-- Sem policy DELETE: desativar via is_active = false

COMMENT ON TABLE public.agent_routing_rules IS
  'Regras de roteamento que definem quando um company_agent_assignment é ativado. '
  'O Router evalua regras ativas da empresa, ordena por priority ASC e usa o primeiro match. '
  'is_fallback = true é a catch-all quando nenhuma outra regra bater. '
  'Desativar via is_active = false — sem deleção física.';

COMMENT ON COLUMN public.agent_routing_rules.priority IS
  'Menor número = maior prioridade. '
  'O Router usa a primeira regra ativa que bater no evento/origem. '
  'Valores recomendados: 10 (específica), 50 (genérica), 999 (fallback).';

COMMENT ON COLUMN public.agent_routing_rules.is_fallback IS
  'TRUE = regra catch-all, usada quando nenhuma outra regra bater. '
  'Deve ser a menos específica: source_type NULL, source_identifier NULL.';

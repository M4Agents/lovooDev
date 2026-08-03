-- =====================================================================
-- Migration: Campos de IA em instagram_conversations
-- Data: 2026-08-02
--
-- Objetivo:
--   Habilitar o pipeline conversacional do agente de IA para Instagram.
--   Adiciona estado do agente, vínculo com assignment ativo e memória
--   conversacional persistida.
--
-- Campos adicionados:
--   ai_state         — estado da IA nesta conversa (padrão: ai_off)
--   ai_assignment_id — FK para o assignment ativo (nullable)
--   memory           — memória conversacional do agente (JSONB, nullable)
--
-- Valores permitidos para ai_state:
--   ai_off    — agente desabilitado (padrão seguro)
--   ai_active — agente ativo e respondendo
--   ai_paused — agente pausado (ex: humano assumiu a conversa)
--
-- Evolução futura documentada (NÃO implementar sem nova revisão):
--   Um quarto valor 'handoff' poderá ser adicionado quando o sistema
--   implementar transferência explícita de controle (AI → human → AI)
--   com rastreamento de estado de retomada. Não incluído nesta versão
--   para manter o escopo controlado e a semântica limpa.
--
-- Segurança:
--   Estas colunas são operadas exclusivamente pelo backend (service_role).
--   As policies RLS existentes continuam válidas:
--     igconv_select_member — SELECT para membros autenticados da empresa
--     INSERT/UPDATE/DELETE — somente service_role (sem policy = apenas service_role)
--   Não criar policies permissivas para estas colunas.
--
-- Compatibilidade:
--   ADD COLUMN com DEFAULT: colunas são preenchidas atomicamente.
--   ai_state NOT NULL DEFAULT 'ai_off': todos os registros existentes recebem 'ai_off'.
--   ai_assignment_id NULL: sem impacto em registros existentes.
--   memory NULL: sem impacto em registros existentes.
-- =====================================================================

ALTER TABLE public.instagram_conversations
  ADD COLUMN IF NOT EXISTS ai_state         TEXT        NOT NULL DEFAULT 'ai_off',
  ADD COLUMN IF NOT EXISTS ai_assignment_id UUID        NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS memory           JSONB       DEFAULT NULL;

-- Constraint nomeada explicitamente para facilitar DROP/ALTER futuro
ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT chk_igconv_ai_state
    CHECK (ai_state IN ('ai_off', 'ai_active', 'ai_paused'));

-- Índice parcial: usado pelo router para localizar conversas com agente ativo.
-- Query esperada: WHERE company_id = $1 AND ai_state = 'ai_active'
-- O índice cobre apenas as linhas em ai_active (minoria), mantendo overhead mínimo.
CREATE INDEX IF NOT EXISTS idx_igconv_ai_state_active
  ON public.instagram_conversations (company_id)
  WHERE ai_state = 'ai_active';

COMMENT ON COLUMN public.instagram_conversations.ai_state IS
  'Estado do agente de IA nesta conversa.
   ai_off:    agente desabilitado (padrão). Nenhum processamento automático.
   ai_active: agente respondendo automaticamente via instagramAgentExecutor.
   ai_paused: agente pausado temporariamente (ex: humano assumiu a conversa).
   Evolução futura planejada: handoff (transferência explícita AI->human->AI).
   Operado exclusivamente pelo backend via service_role.';

COMMENT ON COLUMN public.instagram_conversations.ai_assignment_id IS
  'FK para o company_agent_assignments ativo nesta conversa.
   NULL quando ai_state = ai_off ou sem agente configurado.
   ON DELETE SET NULL: se o assignment for removido fisicamente, o vínculo é limpo
   mas ai_state não é resetado automaticamente — o backend deve verificar a consistência.
   Validação obrigatória no backend antes de qualquer operação:
     assignment.company_id = conversation.company_id
     assignment.channel = instagram
     assignment.is_active = true';

COMMENT ON COLUMN public.instagram_conversations.memory IS
  'Memória conversacional persistida do agente (JSONB).
   NULL = sem memória ainda (conversa nova ou agente nunca respondeu).
   Formato definido pelo instagramAgentExecutor — sem schema fixo nesta versão.
   Atualizado pelo executor ao final de cada ciclo de resposta.
   Proteção contra sobrescrita concorrente garantida pelo lease de conversa
   (automation_conversation_locks) que serializa a execução por conversa.';

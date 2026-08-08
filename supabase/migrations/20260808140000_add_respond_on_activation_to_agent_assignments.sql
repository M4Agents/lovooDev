-- Migration: adiciona respond_on_activation em company_agent_assignments
--
-- CONTEXTO:
--   Quando um agente de IA é ativado via automação (attach_agent), existe um
--   intervalo de tempo entre a chegada da primeira mensagem do lead e a ativação
--   efetiva do agente. Com esta flag ativa, ao finalizar o attach_agent, o sistema
--   verifica se há mensagem inbound sem resposta e dispara o pipeline do agente
--   automaticamente, sem precisar de uma mensagem de boas-vindas na automação.
--
-- PADRÃO: false → nenhuma mudança de comportamento para assignments existentes.

ALTER TABLE company_agent_assignments
  ADD COLUMN respond_on_activation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN company_agent_assignments.respond_on_activation IS
  'Se true, ao ativar o agente via attach_agent, dispara automaticamente o pipeline para a última mensagem inbound sem resposta da conversa.';

-- =====================================================================
-- Migration A — Permitir automation_schedules.flow_id nullable
--
-- Contexto:
--   Schedules de delay (delay_resume, delay_response_timeout) sempre
--   possuem flow_id preenchido, pois são criados dentro de uma execution
--   já em andamento (delayHandler.js usa context.flowId).
--
--   Novos schedules de evento externo (entity_type = 'instagram_dm_received'
--   e futuros canais) são criados pelo webhook ANTES de qualquer execution.
--   Nesse momento o flow ainda não foi determinado — ele será resolvido
--   pelo cron via dispatchMessageReceivedTrigger.
--
-- Impacto:
--   Apenas remove a restrição NOT NULL.
--   A foreign key para automation_flows(id) ON DELETE CASCADE é MANTIDA.
--   Em PostgreSQL, FK aceita NULL sem alteração na constraint.
--   Nenhum índice existente depende de flow_id NOT NULL.
--   Nenhuma trigger, view, RLS policy ou função SQL usa sch.flow_id.
--
-- Retrocompatibilidade:
--   process-schedules.ts filtra .in('entity_type', ['delay_resume',
--   'delay_response_timeout']) — nunca processa instagram_dm_received.
--   delayHandler.js continua preenchendo flow_id normalmente.
-- =====================================================================

ALTER TABLE automation_schedules
  ALTER COLUMN flow_id DROP NOT NULL;

COMMENT ON COLUMN automation_schedules.flow_id IS
  'UUID do flow associado.
   Preenchido em schedules de delay (delay_resume, delay_response_timeout):
     value = context.flowId da execução em andamento.
   NULL em schedules de evento externo (instagram_dm_received e futuros):
     o cron resolve o flow via dispatchMessageReceivedTrigger no momento do
     processamento.
   A FK para automation_flows(id) ON DELETE CASCADE permanece ativa.';

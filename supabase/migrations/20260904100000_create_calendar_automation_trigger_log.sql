-- =====================================================
-- MIGRATION: calendar_automation_trigger_log
-- Data:      2026-09-04
-- Objetivo:  Tabela de deduplicação atômica para triggers temporais
--            (calendar.activity_due_soon, calendar.activity_overdue).
--
-- IMPORTANTE:
--   Esta tabela é usada EXCLUSIVAMENTE pelo backend (service_role).
--   RLS está habilitado sem policies: nenhum acesso via JWT de usuário.
--
-- Estratégia de claim:
--   O cron tenta fazer INSERT via upsert com ignoreDuplicates=true.
--   A UNIQUE constraint garante que apenas uma instância concorrente
--   vence o claim para cada (company_id, activity_id, flow_id,
--   trigger_type, occurrence_key). Quem vence processa; quem perde faz skip.
--
-- occurrence_key — formato determinístico:
--   due_soon  → "due_soon:{minutes_before}:{scheduled_datetime_iso_utc}"
--               Ex: "due_soon:60:2026-09-05T18:00:00.000Z"
--   overdue   → "overdue:{minutes_after}:{scheduled_datetime_iso_utc}"
--               Ex: "overdue:30:2026-09-05T18:00:00.000Z"
--
--   O scheduled_datetime usado na chave é o valor UTC normalizado
--   (resultado de sync_scheduled_datetime trigger + ::timestamptz no servidor UTC).
--   Um reagendamento altera scheduled_datetime, naturalmente gerando uma
--   nova occurrence_key elegível.
--
-- FKs: não incluídas intencionalmente.
--   - activity_id: DELETE físico de atividades não deve fazer cascade no log de auditoria.
--   - flow_id: remoção de flow não deve apagar histórico de execuções.
--   - Mantemos apenas company_id como âncora de tenant (sem cascade).
--
-- ATENÇÃO — migration versionada e fail-fast.
-- Se a tabela ou constraints já existirem fora do histórico esperado de migrations,
-- a execução DEVE FALHAR. Investigar schema drift / alteração manual antes de continuar.
-- NÃO aplicar esta migration sem revisão e autorização explícita do responsável técnico.
-- =====================================================

-- =====================================================
-- 1. TABELA PRINCIPAL
-- =====================================================
CREATE TABLE calendar_automation_trigger_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant: obrigatório e explícito
  company_id     UUID        NOT NULL,

  -- Atividade que originou o trigger
  activity_id    UUID        NOT NULL,

  -- Flow que será (ou foi) executado
  flow_id        UUID        NOT NULL,

  -- Tipo de trigger temporal: calendar.activity_due_soon | calendar.activity_overdue
  trigger_type   VARCHAR(80) NOT NULL,

  -- Chave determinística da ocorrência (ver formato acima)
  occurrence_key VARCHAR(200) NOT NULL,

  -- ID da execução criada (NULL até createExecution concluir; preenchido como best-effort)
  execution_id   UUID        NULL,

  -- Quando o claim foi registrado
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 2. UNIQUE CONSTRAINT — âncora de deduplicação atômica
--
-- company_id é incluído explicitamente por regra arquitetural:
-- todo claim deve carregar o tenant, mesmo que activity_id seja UUID global.
-- =====================================================
ALTER TABLE calendar_automation_trigger_log
  ADD CONSTRAINT uq_calendar_trigger_log_occurrence
  UNIQUE (company_id, activity_id, flow_id, trigger_type, occurrence_key);

-- =====================================================
-- 3. ÍNDICES ADICIONAIS
--
-- 3a. (company_id, triggered_at DESC) — consultas de auditoria/monitoramento
--     por tenant ao longo do tempo. triggered_at DESC porque o caso de uso
--     comum é "mostrar os mais recentes".
-- =====================================================
CREATE INDEX idx_cat_log_company_triggered_at
  ON calendar_automation_trigger_log (company_id, triggered_at DESC);

-- 3b. (activity_id) — localizar todos os claims de uma atividade específica
--     (ex: debug, ou verificação de claims existentes para uma atividade reagendada).
CREATE INDEX idx_cat_log_activity_id
  ON calendar_automation_trigger_log (activity_id);

-- =====================================================
-- 4. ÍNDICE PROPOSTO EM lead_activities
--
-- A query temporal do cron é aproximadamente:
--   SELECT ... FROM lead_activities
--   WHERE company_id = $1
--     AND status = 'pending'
--     AND scheduled_datetime >= $2   -- cutoff de 24h atrás (overdue) ou agora (due_soon)
--     AND scheduled_datetime <= $3   -- até 48h à frente (due_soon) ou agora (overdue)
--   ORDER BY scheduled_datetime ASC
--   LIMIT 100
--
-- O índice existente idx_lead_activities_scheduled_datetime é PARCIAL:
--   WHERE status = 'pending' AND notification_sent = false
--
-- O filtro 'notification_sent = false' exclui atividades já notificadas pelo
-- sistema de lembretes legado, o que NÃO é desejado aqui (os dois mecanismos
-- são independentes). Portanto este índice NÃO será usado pela nova query do cron.
--
-- ÍNDICE PROPOSTO (não executar nesta fase):
-- =====================================================

-- PROPOSTA — criar índice otimizado para a query do cron de automação temporal:
--
-- CREATE INDEX idx_lead_activities_cron_temporal
--   ON lead_activities (company_id, scheduled_datetime, status)
--   WHERE status = 'pending';
--
-- Justificativa:
--   - A query filtra por company_id (equality), scheduled_datetime (range) e status='pending'
--   - Partial index com WHERE status='pending' elimina atividades concluídas/canceladas
--   - O índice existente (idx_lead_activities_scheduled_datetime) não pode ser usado
--     pois tem condição adicional "notification_sent = false" incompatível
--   - Índice composto (company_id, scheduled_datetime) permite Seq/Index Scan eficiente
--     filtrando por tenant antes do range de datas
--
-- NÃO APLICAR sem aprovação. Apenas documentado aqui como parte do plano.

-- =====================================================
-- 5. ROW LEVEL SECURITY
--
-- Tabela é operacional/interna: apenas o backend via service_role acessa.
-- service_role bypassa RLS automaticamente — nenhuma policy necessária.
-- Nenhuma policy = nenhum acesso via JWT de usuário autenticado.
-- =====================================================
ALTER TABLE calendar_automation_trigger_log ENABLE ROW LEVEL SECURITY;

-- Sem policies: acesso apenas via service_role (que não está sujeito ao RLS).
-- Qualquer tentativa de acesso via JWT autenticado resultará em 0 linhas (RLS nega).

-- =====================================================
-- FIM DA MIGRATION
-- =====================================================

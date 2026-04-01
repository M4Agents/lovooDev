-- =====================================================
-- FASE 4: Habilitar Realtime em opportunity_funnel_positions
-- Data: 04/04/2026
-- Objetivo: Permitir que eventos INSERT/UPDATE/DELETE da tabela
--           de posições do funil sejam transmitidos via Supabase Realtime.
--
-- REPLICA IDENTITY FULL: garante que o payload de UPDATE inclua
-- old.stage_id além de new.stage_id, permitindo identificar
-- quais colunas do board foram afetadas sem um fetch adicional.
--
-- Pré-requisito para: useFunnelRealtime (Fase 4 frontend)
-- Risco: Baixo — sem impacto em queries existentes, sem lock.
-- =====================================================

ALTER TABLE opportunity_funnel_positions REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE opportunity_funnel_positions;

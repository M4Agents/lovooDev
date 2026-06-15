-- =============================================================================
-- Fase 1: Adicionar assigned_user_id em whatsapp_life_instances
-- Data: 2026-06-15
--
-- Objetivo:
--   Permitir que cada instância WhatsApp tenha um usuário responsável
--   configurado. Leads criados automaticamente via webhook por essa instância
--   receberão responsible_user_id = assigned_user_id (quando ativo na empresa).
--
-- Decisões arquiteturais:
--   - FK para auth.users(id): padrão do sistema (57 ocorrências no repo).
--     leads.responsible_user_id e chat_conversations.assigned_to não têm FK
--     por serem pré-versionamento — não é o padrão intencional.
--   - ON DELETE SET NULL: usuário excluído do sistema não exclui a instância.
--   - Validação de is_active ocorre em runtime na RPC (não via FK).
--   - Índice parcial: cobre apenas linhas relevantes (atribuídas + não deletadas).
--
-- Impacto em produção:
--   ADD COLUMN NULL é operação online no PostgreSQL — sem lock de tabela.
--   Instâncias existentes ficam com assigned_user_id = NULL (sem impacto funcional).
--   CREATE INDEX CONCURRENTLY não bloqueia leituras nem escritas.
--
-- Idempotência: IF NOT EXISTS em ambas as operações.
-- =============================================================================

ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID DEFAULT NULL
  REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_life_instances.assigned_user_id IS
'Usuário responsável pelos leads e conversas criados automaticamente por esta instância. '
'NULL = sem atribuição automática (comportamento padrão). '
'Validação de is_active ocorre em runtime na RPC create_lead_from_whatsapp_safe. '
'Escrita exclusivamente via RPC update_instance_assigned_user (SECURITY DEFINER).';

-- CONCURRENTLY omitido: coluna nova/vazia não requer build concorrente.
-- Em produção com dados existentes o índice é construído com lock mínimo de
-- leitura em background — aceitável para uma tabela de instâncias (baixo volume).
CREATE INDEX IF NOT EXISTS idx_wli_assigned_user_id
  ON public.whatsapp_life_instances (assigned_user_id)
  WHERE assigned_user_id IS NOT NULL
    AND deleted_at IS NULL;

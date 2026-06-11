-- =============================================================================
-- FASE 1G: PRÉ-SANEAMENTO DE chat_conversations.assigned_to
-- =============================================================================
-- Objetivo:
--   Popular chat_conversations.assigned_to a partir de leads.responsible_user_id
--   para conversas que já possuem lead vinculado mas ainda não têm responsável
--   de conversa definido.
--
-- Regras aplicadas:
--   - Usa cc.lead_id = l.id (FK direta, não match por telefone)
--   - Apenas quando cc.assigned_to IS NULL
--   - Apenas para leads ativos (l.deleted_at IS NULL)
--   - Apenas quando l.responsible_user_id IS NOT NULL
--   - Garante isolamento multi-tenant (cc.company_id = l.company_id)
--   - Não toca conversas sem lead, com lead deletado ou lead sem responsável
--
-- Impacto medido antes da execução (SELECT com JOIN company_users is_active=true):
--   Total de conversas atualizadas: 380
--   (432 sem filtro de usuário ativo; 52 excluídas por responsible_user_id de usuário inativo)
--   - Instituto da Construção - Campo Limpo: 231 (60.8%)
--   - Locadora ObraFácil:                   105 (27.6%)
--   - M4 Digital:                            44 (11.6%)
--
--   Total que permanece sem assigned_to após migration: ~2.142
--   - Leads ativos sem responsible_user_id (ou com usuário inativo): ~1.529
--   - Lead deletado:                                                    321
--   - Sem lead vinculado:                                               296
--
-- Rollback:
--   UPDATE chat_conversations SET assigned_to = NULL, updated_at = now()
--   WHERE assigned_to IS NOT NULL
--     AND updated_at >= '2026-06-11T18:00:00Z';
--   (Seguro pois assigned_to era NULL em 100% das conversas antes desta migration)
--
-- Referência: Fase 1G — Pré-saneamento e plano de implementação controlado do chat
-- =============================================================================

-- ─── VERIFICAÇÃO PRÉ-EXECUÇÃO ────────────────────────────────────────────────
-- Executar este SELECT antes do UPDATE para confirmar contagem esperada:
--
-- SELECT COUNT(*) AS total_a_atualizar
-- FROM chat_conversations cc
-- JOIN leads l ON l.id = cc.lead_id
-- WHERE cc.assigned_to IS NULL
--   AND l.deleted_at IS NULL
--   AND l.responsible_user_id IS NOT NULL
--   AND cc.company_id = l.company_id;
--
-- Resultado esperado: 432
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE chat_conversations cc
SET
  assigned_to = l.responsible_user_id,
  updated_at  = now()
FROM leads l
JOIN company_users cu
  ON  cu.user_id    = l.responsible_user_id
  AND cu.company_id = l.company_id
  AND cu.is_active  = true
WHERE cc.lead_id        = l.id
  AND cc.company_id     = l.company_id
  AND l.deleted_at      IS NULL
  AND cc.assigned_to    IS NULL
  AND l.responsible_user_id IS NOT NULL;

-- ─── VERIFICAÇÃO PÓS-EXECUÇÃO ─────────────────────────────────────────────────
-- Após aplicar, confirmar resultado:
--
-- SELECT
--   co.name AS empresa,
--   COUNT(*) AS atualizadas
-- FROM chat_conversations cc
-- JOIN leads l ON l.id = cc.lead_id
-- JOIN companies co ON co.id = cc.company_id
-- WHERE cc.assigned_to IS NOT NULL
--   AND cc.updated_at >= now() - INTERVAL '5 minutes'
-- GROUP BY co.name
-- ORDER BY atualizadas DESC;
--
-- Resultado esperado:
--   Instituto da Construção - Campo Limpo: 233
--   Locadora ObraFácil:                   139
--   M4 Digital:                            60
-- ─────────────────────────────────────────────────────────────────────────────

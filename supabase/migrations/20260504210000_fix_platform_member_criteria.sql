-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Corrigir critério de is_platform_member
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problema identificado:
--   A migration 20260504200000 marcou is_platform_member baseando-se no role
--   DO USUÁRIO NA EMPRESA FILHA (cu.role IN ('super_admin','system_admin')).
--   Isso deixou de fora usuários como marcio@m4digital.co, que é super_admin
--   na empresa pai mas aparece como 'admin' nas filiais — criados manualmente
--   antes da função create_client_company_safe ser atualizada.
--
-- Critério correto:
--   Cruzar o role do usuário na empresa PAI (parent). Se for super_admin ou
--   system_admin na parent, todas as suas linhas ativas em empresas client
--   devem ter is_platform_member = TRUE, independente do role na filial.
--
-- Condições de segurança adicionadas (conforme aprovação):
--   - parent_cu.is_active = true  → ignora memberships inativas na parent
--   - cu.is_active = true         → ignora memberships inativas na filial
--   - cu.is_platform_member = false → atualiza apenas quem ainda não foi marcado
--
-- Rollback (se necessário):
--   Executar o UPDATE reverso usando o mesmo cruzamento parent/client,
--   ajustando SET is_platform_member = FALSE, ou revisar manualmente
--   as linhas afetadas via SELECT antes de reverter.
--
-- Não edita nenhuma migration anterior.
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE public.company_users cu
SET    is_platform_member = TRUE
FROM   public.companies c,
       public.company_users parent_cu,
       public.companies parent_c
WHERE  cu.company_id       = c.id
  AND  c.company_type      = 'client'
  AND  parent_cu.user_id   = cu.user_id
  AND  parent_cu.company_id = parent_c.id
  AND  parent_c.company_type = 'parent'
  AND  parent_cu.role      IN ('super_admin', 'system_admin')
  AND  parent_cu.is_active  = true
  AND  cu.is_active         = true
  AND  cu.is_platform_member = false;

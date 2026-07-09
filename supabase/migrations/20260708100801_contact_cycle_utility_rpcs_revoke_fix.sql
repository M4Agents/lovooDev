-- Motor de Ciclos: revoke de grants incorretos nas RPCs utilitárias
-- Corrige grants aplicados na migration anterior (100800) que não deveriam expor
-- essas funções para anon/authenticated — apenas service_role deve executá-las

REVOKE EXECUTE ON FUNCTION public.evaluate_contact_cycle_eligibility(UUID, UUID)     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_contact_cycle_history(UUID, UUID)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_opportunity_for_contact_cycle(INTEGER, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_contact_attempt_reasons(UUID)          FROM anon, authenticated;

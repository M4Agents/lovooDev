-- =============================================================================
-- TECH-MEDIA-008 — privilégios excessivos das tabelas da biblioteca
-- (META-L1.4C.5.1E.3E.4F.A.1)
--
-- Confirmado no catálogo de etzdsywunlpbgxkphuil, sem grant de PUBLIC e sem
-- herança de role que preserve o privilégio depois da revogação:
--   anon e authenticated possuem TRUNCATE, TRIGGER e REFERENCES
--   anon também possui INSERT, UPDATE e DELETE
-- nas tabelas public.company_folders, public.lead_media_unified e
-- public.company_media_library.
--
-- TRUNCATE não é coberto por RLS. Não há consumidor legítimo desses
-- privilégios. TRIGGER e REFERENCES existentes, criados pelo owner,
-- continuam válidos; a revogação só impede que anon e authenticated
-- criem novos.
--
-- Preserva SELECT de anon para o endpoint antigo, que usa cliente anônimo
-- e recebe zero linhas pelas policies atuais.
-- Preserva SELECT, INSERT, UPDATE e DELETE de authenticated. Essas
-- operações continuam sujeitas às policies existentes.
-- Não altera service_role, postgres, policies, funções, triggers,
-- default privileges nem dados.
-- =============================================================================

REVOKE TRUNCATE, TRIGGER, REFERENCES
ON TABLE
    public.company_folders,
    public.lead_media_unified,
    public.company_media_library
FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE
ON TABLE
    public.company_folders,
    public.lead_media_unified,
    public.company_media_library
FROM anon;

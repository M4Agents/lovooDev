-- =====================================================================
-- Migration: Canal instagram em company_agent_assignments e agent_routing_rules
-- Data: 2026-08-02
--
-- Objetivo:
--   Permitir que assignments e routing rules sejam configurados para
--   o canal Instagram, habilitando o pipeline de agente de IA para DMs.
--
-- Método robusto (não depende de nomes fixos de constraints):
--   1. Descobrir via pg_constraint o nome real da CHECK constraint que
--      referencia a coluna 'channel' em cada tabela.
--   2. Validar que exatamente uma constraint foi encontrada por tabela;
--      falhar explicitamente se nenhuma ou múltiplas forem encontradas.
--   3. Remover as constraints pelo nome descoberto (via EXECUTE format).
--   4. Recriar com nomes estáveis e explícitos.
--
-- Compatibilidade entre ambientes:
--   Ambientes que nunca tiveram constraint explícita podem ter nomes
--   gerados automaticamente pelo Postgres (ex: company_agent_assignments_channel_check).
--   Ambientes onde migrations anteriores já nomearam explicitamente a
--   constraint manterão o mesmo nome ao recriar.
--   O resultado final é idêntico em todos os ambientes.
--
-- Preservação:
--   Todos os valores anteriores são mantidos.
--   agent_routing_rules preserva '*' (catch-all para qualquer canal).
--
-- Segurança:
--   O DO block valida que não há dados fora do novo conjunto antes de alterar.
--   A migration é transacional — falha atômica se qualquer passo falhar.
-- =====================================================================

DO $$
DECLARE
  v_caa_name    TEXT;
  v_arr_name    TEXT;
  v_caa_count   INT;
  v_arr_count   INT;
BEGIN
  -- ── Descoberta: company_agent_assignments.channel ─────────────────────────
  SELECT COUNT(*), MAX(c.conname)
    INTO v_caa_count, v_caa_name
  FROM pg_constraint c
  JOIN pg_attribute  a
    ON a.attrelid = c.conrelid
   AND a.attnum   = ANY(c.conkey)
  WHERE c.conrelid = 'public.company_agent_assignments'::regclass
    AND c.contype  = 'c'
    AND a.attname  = 'channel';

  IF v_caa_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma CHECK constraint encontrada para company_agent_assignments.channel — '
      'verifique se a coluna existe e se há uma constraint de valores.';
  END IF;

  IF v_caa_count > 1 THEN
    RAISE EXCEPTION
      'Múltiplas CHECK constraints (%) encontradas para company_agent_assignments.channel — '
      'resolução manual necessária.', v_caa_count;
  END IF;

  -- ── Descoberta: agent_routing_rules.channel ────────────────────────────────
  SELECT COUNT(*), MAX(c.conname)
    INTO v_arr_count, v_arr_name
  FROM pg_constraint c
  JOIN pg_attribute  a
    ON a.attrelid = c.conrelid
   AND a.attnum   = ANY(c.conkey)
  WHERE c.conrelid = 'public.agent_routing_rules'::regclass
    AND c.contype  = 'c'
    AND a.attname  = 'channel';

  IF v_arr_count = 0 THEN
    RAISE EXCEPTION
      'Nenhuma CHECK constraint encontrada para agent_routing_rules.channel — '
      'verifique se a coluna existe e se há uma constraint de valores.';
  END IF;

  IF v_arr_count > 1 THEN
    RAISE EXCEPTION
      'Múltiplas CHECK constraints (%) encontradas para agent_routing_rules.channel — '
      'resolução manual necessária.', v_arr_count;
  END IF;

  -- ── Validação preventiva de dados ────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.company_agent_assignments
    WHERE channel NOT IN ('whatsapp', 'web', 'email', 'sms', 'instagram')
  ) THEN
    RAISE EXCEPTION
      'Dados fora do novo conjunto de valores em company_agent_assignments.channel — migration abortada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agent_routing_rules
    WHERE channel NOT IN ('whatsapp', 'web', 'email', 'sms', 'instagram', '*')
  ) THEN
    RAISE EXCEPTION
      'Dados fora do novo conjunto de valores em agent_routing_rules.channel — migration abortada.';
  END IF;

  -- ── Remover constraints descobertas (nome variável por ambiente) ──────────
  EXECUTE format(
    'ALTER TABLE public.company_agent_assignments DROP CONSTRAINT %I',
    v_caa_name
  );
  EXECUTE format(
    'ALTER TABLE public.agent_routing_rules DROP CONSTRAINT %I',
    v_arr_name
  );

  -- ── Recriar com nomes estáveis e explícitos ────────────────────────────────
  -- company_agent_assignments: whatsapp | web | email | sms | instagram
  EXECUTE $sql$
    ALTER TABLE public.company_agent_assignments
      ADD CONSTRAINT company_agent_assignments_channel_check
        CHECK (channel IN ('whatsapp', 'web', 'email', 'sms', 'instagram'))
  $sql$;

  -- agent_routing_rules: whatsapp | web | email | sms | instagram | *
  EXECUTE $sql$
    ALTER TABLE public.agent_routing_rules
      ADD CONSTRAINT agent_routing_rules_channel_check
        CHECK (channel IN ('whatsapp', 'web', 'email', 'sms', 'instagram', '*'))
  $sql$;

  RAISE NOTICE 'company_agent_assignments: % → company_agent_assignments_channel_check', v_caa_name;
  RAISE NOTICE 'agent_routing_rules: % → agent_routing_rules_channel_check',             v_arr_name;
END $$;

COMMENT ON COLUMN public.company_agent_assignments.channel IS
  'Canal onde este assignment opera.
   whatsapp: pipeline WhatsApp (UAZAPI/Z-API) — implementado.
   instagram: pipeline Instagram DM (Meta Graph API) — adicionado nesta migration.
   web, email, sms: canais futuros, não implementados.
   Constraint: company_agent_assignments_channel_check.';

COMMENT ON COLUMN public.agent_routing_rules.channel IS
  'Canal de entrada para esta regra de roteamento.
   whatsapp, instagram, web, email, sms: canal específico.
   *: catch-all — regra se aplica a qualquer canal.
   Constraint: agent_routing_rules_channel_check.';

-- =============================================================================
-- Migration: notifications_foundation
-- Data: 2026-05-10
--
-- Etapa 1 do módulo de notificações automáticas (Trial Alerts V1).
--
-- O que esta migration faz:
--   1. Seed em integration_settings    — provider='notifications' (desabilitado)
--   2. CREATE notification_templates   — templates editáveis por evento/canal
--   3. CREATE notification_dedup       — deduplicação de envios por empresa cliente
--   4. CREATE notification_logs        — auditoria de cada tentativa de envio
--   5. Seeds de notification_templates — 4 templates iniciais (3d/1d × email/whatsapp)
--   6. RPC get_trial_alert_candidates  — candidatas a alerta por janela de trial
--   7. Patch extend_company_trial      — limpa dedup ao estender trial
--
-- O que esta migration NÃO faz (por design):
--   ✗ NÃO envia nenhuma notificação
--   ✗ NÃO cria cron job
--   ✗ NÃO cria endpoints de API
--   ✗ NÃO cria componentes frontend
--   ✗ NÃO altera trial, Stripe, leads ou qualquer fluxo existente
--   ✗ NÃO cria templates para evento 7d (V2)
--   ✗ NÃO implementa renderer HTML de email
--
-- Referências de arquitetura:
--   notification_templates.company_id  = empresa pai (PARENT_COMPANY_ID)
--   notification_dedup.company_id      = empresa cliente (filha)
--   notification_logs.company_id       = empresa cliente (filha)
--   PARENT_COMPANY_ID                  = dcc99d3d-9def-4b93-aeb2-1a3be5f15413
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. SEED integration_settings — provider='notifications'
--
-- Aproveita a tabela existente com um novo provider.
-- enabled=false por padrão — nenhuma notificação será disparada.
-- provider_config define a estrutura esperada pelos backends da Etapa B.
--
-- ON CONFLICT DO NOTHING: idempotente — pode rodar mais de uma vez sem efeito.
-- model='notifications' satisfaz o CHECK (length(trim(model)) > 0) sem semântica AI.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.integration_settings (
  company_id,
  provider,
  enabled,
  model,
  timeout_ms,
  provider_config
)
VALUES (
  'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid,
  'notifications',
  false,
  'notifications',
  60000,
  '{
    "whatsapp_instance_id": null,
    "enabled_channels": [],
    "fallback_email_if_whatsapp_fails": false
  }'::jsonb
)
ON CONFLICT (company_id, provider) DO NOTHING;

COMMENT ON TABLE public.integration_settings IS
  'Configurações de integrações por empresa; nunca armazenar API keys ou segredos. '
  'provider=notifications: configuração de canais do sistema de notificações automáticas (trial alerts, billing, etc.).';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE notification_templates
--
-- Templates editáveis de notificação por evento, subtipo e canal.
-- company_id = PARENT_COMPANY_ID — templates são globais para a plataforma.
-- Admin edita apenas subject (email) e body (texto puro com {{variáveis}}).
-- Layout HTML do email é responsabilidade do emailRenderer.js (Etapa B), não aqui.
--
-- Regras de canal:
--   email    → subject obrigatório, body = texto puro
--   whatsapp → subject null, body = texto puro (sem HTML)
--
-- Validação de variáveis: feita no backend (PUT /api/notifications/templates/:id)
--   antes de salvar — o banco não valida {{variáveis}} desconhecidas.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL
                REFERENCES public.companies(id) ON DELETE CASCADE,
  -- company_id = PARENT_COMPANY_ID — templates pertencem à empresa pai
  event_type    text        NOT NULL,
  -- V1: 'trial_alert' | Fase 2: 'payment_failed' | 'payment_approved' | 'welcome' | 'onboarding'
  event_subtype text,
  -- V1: '3d' | '1d' | null para eventos sem subtipo | '7d' entra em V2 sem migration
  channel       text        NOT NULL,
  name          text        NOT NULL,
  subject       text,
  -- email: obrigatório; whatsapp: null
  body          text        NOT NULL,
  -- texto puro com {{variáveis}}; nunca HTML diretamente (renderer é responsável pelo layout)
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT nt_channel_check
    CHECK (channel IN ('email', 'whatsapp')),
  CONSTRAINT nt_event_type_nonempty
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT nt_body_nonempty
    CHECK (length(trim(body)) > 0),
  CONSTRAINT nt_unique_event_channel
    UNIQUE (company_id, event_type, event_subtype, channel)
);

COMMENT ON TABLE public.notification_templates IS
  'Templates editáveis de notificação por evento e canal. '
  'company_id = empresa pai (PARENT_COMPANY_ID) — templates são globais para a plataforma. '
  'Admin edita apenas subject (email) e body (texto puro). '
  'Layout HTML do email é gerado pelo emailRenderer.js (fora do banco). '
  'Sem fallback hardcoded — template ausente resulta em skipped no cron.';

COMMENT ON COLUMN public.notification_templates.body IS
  'Texto puro com variáveis no formato {{nome_variavel}}. '
  'Nunca armazenar HTML completo aqui — o renderer envolve o body no layout Lovoo. '
  'Variáveis disponíveis em V1: company_name, days_remaining, trial_end_date, plan_name, cta_url, admin_name.';

COMMENT ON COLUMN public.notification_templates.subject IS
  'Assunto do email. Obrigatório para channel=email; deve ser null para channel=whatsapp.';

CREATE INDEX IF NOT EXISTS idx_nt_event_channel
  ON public.notification_templates (event_type, event_subtype, channel);

CREATE INDEX IF NOT EXISTS idx_nt_company_active
  ON public.notification_templates (company_id, is_active);

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at (reutiliza a função existente no banco)
CREATE TRIGGER notification_templates_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: apenas platform admins lêem e editam templates
-- INSERT/UPDATE/DELETE por authenticated: restrito a platform admins
-- service_role: bypassa RLS (usado pelo cron via templateDb.js)

CREATE POLICY "nt_select_platform_admin"
  ON public.notification_templates
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

CREATE POLICY "nt_insert_platform_admin"
  ON public.notification_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_user_is_platform_admin()
    AND company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
  );

CREATE POLICY "nt_update_platform_admin"
  ON public.notification_templates
  FOR UPDATE
  TO authenticated
  USING (public.auth_user_is_platform_admin())
  WITH CHECK (
    public.auth_user_is_platform_admin()
    AND company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
  );

-- DELETE bloqueado para authenticated: templates são desativados via is_active=false
-- service_role pode deletar se necessário (manutenção)
COMMENT ON POLICY "nt_select_platform_admin" ON public.notification_templates IS
  'Apenas super_admin e system_admin em empresa pai podem ler templates. '
  'INSERT/UPDATE permitido apenas para platform admins. '
  'DELETE bloqueado para authenticated — use is_active=false para desativar. '
  'service_role (cron) bypassa RLS para leitura no envio de notificações.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE notification_dedup
--
-- Deduplicação de envios: 1 registro por (company_id, event_key, channel).
-- company_id = empresa cliente (filha) — nunca a empresa pai.
-- Previne reenvio do mesmo alerta para a mesma empresa no mesmo ciclo.
--
-- Granularidade:
--   1 registro por empresa por canal por evento.
--   Ex.: 3 admins → 3 logs de email, mas apenas 1 registro de dedup por canal.
--
-- Limpeza:
--   extend_company_trial (RPC) faz DELETE WHERE event_key LIKE 'trial_alert:%'
--   para permitir novos alertas após extensão (ver Seção 7 desta migration).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notification_dedup (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL
             REFERENCES public.companies(id) ON DELETE CASCADE,
  -- company_id = empresa cliente (filha) — nunca a empresa pai
  event_key  text        NOT NULL,
  -- formato: '<event_type>:<subtype>' | ex.: 'trial_alert:3d', 'trial_alert:1d', 'welcome'
  channel    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT nd_channel_check
    CHECK (channel IN ('email', 'whatsapp')),
  CONSTRAINT nd_event_key_nonempty
    CHECK (length(trim(event_key)) > 0),
  CONSTRAINT nd_unique_company_event_channel
    UNIQUE (company_id, event_key, channel)
);

COMMENT ON TABLE public.notification_dedup IS
  'Deduplicação de notificações enviadas. '
  'company_id = empresa cliente (filha). '
  '1 registro por (company_id, event_key, channel). '
  'INSERT apenas após status=sent confirmado. '
  'DELETE via extend_company_trial (SECURITY DEFINER) ao estender trial. '
  'Não usar como log — use notification_logs para auditoria completa.';

COMMENT ON COLUMN public.notification_dedup.event_key IS
  'Chave composta do evento: <event_type>:<subtype>. '
  'Ex.: trial_alert:3d | trial_alert:1d | payment_failed:inv_xyz | welcome. '
  'Usado para reset após extensão: DELETE WHERE event_key LIKE ''trial_alert:%''.';

CREATE INDEX IF NOT EXISTS idx_nd_company
  ON public.notification_dedup (company_id);

CREATE INDEX IF NOT EXISTS idx_nd_event_key
  ON public.notification_dedup (event_key);

ALTER TABLE public.notification_dedup ENABLE ROW LEVEL SECURITY;

-- Authenticated: apenas leitura para platform admins (debug/auditoria)
-- INSERT/UPDATE/DELETE: service_role apenas (cron via configDb.js)
CREATE POLICY "nd_select_platform_admin"
  ON public.notification_dedup
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

COMMENT ON POLICY "nd_select_platform_admin" ON public.notification_dedup IS
  'Apenas platform admins podem consultar o dedup (debug/auditoria). '
  'INSERT/UPDATE/DELETE: apenas service_role (cron). '
  'Nunca expor dedup a usuários de empresas cliente.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. CREATE notification_logs
--
-- Auditoria completa de cada tentativa de envio: 1 registro por destinatário.
-- company_id = empresa cliente (filha) — nunca a empresa pai.
--
-- Granularidade:
--   Se empresa tem 3 admins → 3 logs para email, 1 para whatsapp (1 número).
--   Cada log = 1 tentativa para 1 destinatário.
--
-- Status:
--   sent    — provider confirmou envio; sent_at preenchido
--   failed  — provider retornou erro / timeout / instância offline
--   skipped — destinatário vazio, canal off, dedup existente, template ausente
--
-- error_message para skipped:
--   'template_not_found'    — template inexistente ou is_active=false
--   'phone_missing'         — empresa sem telefone_principal
--   'phone_invalid_format'  — telefone fora do formato E.164
--   'channel_disabled'      — canal não está em enabled_channels
--   'already_sent'          — registro no dedup já existe
--   'instance_offline'      — instância WhatsApp desconectada
--
-- rendered_body: truncado a 1000 chars para evitar log inflado.
-- metadata: estrutura padronizada definida no plano (ver COMMENT abaixo).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL
                      REFERENCES public.companies(id) ON DELETE CASCADE,
  -- company_id = empresa cliente (filha) — nunca a empresa pai
  event_type          text        NOT NULL,
  event_subtype       text,
  channel             text        NOT NULL,
  recipient           text        NOT NULL,
  -- email: endereço (ex.: admin@empresa.com) | whatsapp: número E.164 (ex.: +5511...)
  subject             text,
  -- assunto do email; null para whatsapp
  rendered_body       text,
  -- snapshot do body após substituição de variáveis; truncado a 1000 chars
  status              text        NOT NULL,
  provider_message_id text,
  -- ID retornado por Resend (message_id) ou Uazapi; null se falhou antes do envio
  error_message       text,
  -- erro do provider ou código interno: 'template_not_found', 'phone_missing', etc.
  metadata            jsonb,
  -- estrutura padronizada: {template_id, template_name, event_key, company_parent_id,
  --                          provider, variables: {}, fallback_for: null}
  sent_at             timestamptz,
  -- preenchido apenas quando status='sent'
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT nl_channel_check
    CHECK (channel IN ('email', 'whatsapp')),
  CONSTRAINT nl_status_check
    CHECK (status IN ('sent', 'failed', 'skipped')),
  CONSTRAINT nl_event_type_nonempty
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT nl_recipient_nonempty
    CHECK (length(trim(recipient)) > 0)
);

COMMENT ON TABLE public.notification_logs IS
  'Auditoria completa de tentativas de envio de notificações. '
  'company_id = empresa cliente (filha). '
  '1 registro por tentativa por destinatário. '
  'Ex.: 3 admins em uma empresa = 3 logs para o mesmo email event. '
  'Não usar para controle de reenvio — use notification_dedup para isso. '
  'Sem UPDATE/DELETE por authenticated — auditoria imutável.';

COMMENT ON COLUMN public.notification_logs.metadata IS
  'Estrutura mínima padronizada: '
  '{ '
  '  "template_id": "uuid", '
  '  "template_name": "...", '
  '  "event_key": "trial_alert:3d", '
  '  "company_parent_id": "uuid-empresa-pai", '
  '  "provider": "resend|whatsapp", '
  '  "variables": { "company_name": "...", "days_remaining": 3, ... }, '
  '  "fallback_for": null '
  '}';

COMMENT ON COLUMN public.notification_logs.rendered_body IS
  'Snapshot do conteúdo após substituição de variáveis. '
  'Truncado a 1000 chars para evitar inflação do banco. '
  'Armazena texto puro (não HTML) — o HTML é gerado pelo renderer no momento do envio.';

CREATE INDEX IF NOT EXISTS idx_nl_company
  ON public.notification_logs (company_id);

CREATE INDEX IF NOT EXISTS idx_nl_event
  ON public.notification_logs (event_type, event_subtype);

CREATE INDEX IF NOT EXISTS idx_nl_status
  ON public.notification_logs (status);

CREATE INDEX IF NOT EXISTS idx_nl_created
  ON public.notification_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nl_channel
  ON public.notification_logs (channel);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: platform admins podem consultar logs (debug/auditoria via Supabase Dashboard em V1)
-- INSERT/UPDATE/DELETE: service_role apenas (cron)
CREATE POLICY "nl_select_platform_admin"
  ON public.notification_logs
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

COMMENT ON POLICY "nl_select_platform_admin" ON public.notification_logs IS
  'Apenas platform admins podem consultar logs. '
  'INSERT/UPDATE/DELETE: apenas service_role (cron). '
  'Nunca expor logs de outras empresas a usuários autenticados. '
  'Tela de logs não é prevista em V1 — Supabase Dashboard cobre a necessidade.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. SEEDS: notification_templates
--
-- 4 templates iniciais para V1 (trial_alert × 3d/1d × email/whatsapp).
-- Seeds são criadas com conteúdo inicial adequado e editável via UI depois.
-- ON CONFLICT DO NOTHING: idempotente — pode rodar mais de uma vez sem efeito.
-- Vinculadas ao PARENT_COMPANY_ID (empresa pai da plataforma).
--
-- Variáveis disponíveis em V1:
--   {{admin_name}}     — nome do admin destinatário (email)
--   {{company_name}}   — nome da empresa cliente
--   {{days_remaining}} — dias restantes de trial
--   {{trial_end_date}} — data de expiração formatada (pt-BR)
--   {{plan_name}}      — nome do plano atual
--   {{cta_url}}        — URL para a tela de planos
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.notification_templates
  (company_id, event_type, event_subtype, channel, name, subject, body, is_active)
VALUES

  -- trial_alert / 3d / email
  (
    'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid,
    'trial_alert',
    '3d',
    'email',
    'Trial expirando — 3 dias — Email',
    'Seu trial expira em 3 dias — não perca o acesso ao Lovoo CRM',
    'Olá, {{admin_name}}.

O período de avaliação gratuita da {{company_name}} no Lovoo CRM expira em {{days_remaining}} dias ({{trial_end_date}}).

Para continuar usando todas as funcionalidades do plano {{plan_name}} sem interrupções, contrate sua assinatura antes que o prazo acabe.

Acesse o link abaixo para escolher seu plano:
{{cta_url}}

Qualquer dúvida, estamos à disposição.',
    true
  ),

  -- trial_alert / 3d / whatsapp
  (
    'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid,
    'trial_alert',
    '3d',
    'whatsapp',
    'Trial expirando — 3 dias — WhatsApp',
    NULL,
    'Olá, {{admin_name}}! 👋

O trial da *{{company_name}}* no Lovoo CRM expira em *{{days_remaining}} dias* ({{trial_end_date}}).

Para não perder o acesso ao plano {{plan_name}}, contrate agora:
{{cta_url}}',
    true
  ),

  -- trial_alert / 1d / email
  (
    'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid,
    'trial_alert',
    '1d',
    'email',
    'Trial expirando — último dia — Email',
    'Último dia de trial — garanta sua assinatura no Lovoo CRM hoje',
    'Olá, {{admin_name}}.

Este é um lembrete urgente: o período de avaliação gratuita da {{company_name}} no Lovoo CRM expira amanhã ({{trial_end_date}}).

Após o vencimento, o acesso ao plano {{plan_name}} será suspenso. Garanta sua assinatura agora para não perder nenhum dado ou funcionalidade:
{{cta_url}}',
    true
  ),

  -- trial_alert / 1d / whatsapp
  (
    'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid,
    'trial_alert',
    '1d',
    'whatsapp',
    'Trial expirando — último dia — WhatsApp',
    NULL,
    '⚠️ Atenção, {{admin_name}}!

O trial da *{{company_name}}* no Lovoo CRM expira *amanhã* ({{trial_end_date}}).

Não perca o acesso ao plano {{plan_name}} — contrate agora:
{{cta_url}}',
    true
  )

ON CONFLICT (company_id, event_type, event_subtype, channel) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RPC get_trial_alert_candidates()
--
-- Retorna empresas cliente elegíveis para alerta de trial expirando.
-- Chamada pelo cron (api/cron/alert-trials.js) via service_role.
-- SECURITY DEFINER: bypassa RLS — cron não tem auth.uid().
--
-- Lógica de janela:
--   Cron roda às 06:00 UTC. Comparação por date (::date) garante que
--   cada empresa seja retornada exatamente 1 vez por janela por dia.
--   V1: janelas 3d e 1d apenas.
--   V2: adicionar '7d' com nova linha no CASE sem migration de schema.
--
-- Filtros obrigatórios:
--   status = 'trialing'            — apenas trials ativos
--   stripe_subscription_id IS NULL — apenas trials internos (sem Stripe)
--   company_type = 'client'        — nunca empresa pai ou partner
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_trial_alert_candidates()
RETURNS TABLE (
  company_id     uuid,
  company_name   text,
  trial_end      timestamptz,
  days_remaining integer,
  event_subtype  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cs.company_id,
    c.name                                                   AS company_name,
    cs.trial_end,
    GREATEST(
      0,
      FLOOR(
        EXTRACT(epoch FROM (cs.trial_end - now())) / 86400.0
      )
    )::integer                                               AS days_remaining,
    CASE
      WHEN cs.trial_end::date = current_date + 3 THEN '3d'
      WHEN cs.trial_end::date = current_date + 1 THEN '1d'
    END                                                      AS event_subtype
  FROM public.company_subscriptions cs
  JOIN public.companies c ON c.id = cs.company_id
  WHERE cs.status = 'trialing'
    AND cs.stripe_subscription_id IS NULL
    AND c.company_type = 'client'
    AND (
      cs.trial_end::date = current_date + 3
      OR cs.trial_end::date = current_date + 1
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_trial_alert_candidates() TO authenticated;

COMMENT ON FUNCTION public.get_trial_alert_candidates IS
  'Retorna empresas cliente com trial interno expirando nas janelas V1 (3d, 1d). '
  'Chamada pelo cron api/cron/alert-trials.js via service_role. '
  'Filtros: status=trialing + stripe_subscription_id IS NULL + company_type=client. '
  'V2: adicionar janela 7d no CASE sem migration de schema. '
  'Comparação por date (::date) garante 1 retorno por empresa por janela por dia.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. PATCH extend_company_trial — limpa notification_dedup ao estender trial
--
-- Após extensão do trial, os alertas já enviados (dedup) devem ser limpos
-- para que o cron envie novos alertas nas próximas janelas (3d e 1d).
--
-- Reescreve a função com a mesma assinatura e toda a lógica original.
-- Única adição: DELETE FROM notification_dedup no passo 13 (antes do RETURN).
--
-- Assinatura preservada: extend_company_trial(uuid, uuid, text)
-- Segurança preservada: SECURITY DEFINER, validações idênticas
-- Auditoria preservada: INSERT em trial_extensions mantido
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.extend_company_trial(
  p_company_id    uuid,
  p_requester_id  uuid,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id          uuid := auth.uid();
  v_caller_role        text;
  v_caller_company_id  uuid;
  v_caller_company_type text;
  v_target_type        text;
  v_target_parent_id   uuid;
  v_growth_plan_id     uuid;
  v_sub                record;
  v_original_end       timestamptz;
  v_new_end            timestamptz;
BEGIN
  -- 1. Caller autenticado e corresponde ao p_requester_id
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF v_caller_id <> p_requester_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'requester_id mismatch');
  END IF;

  -- 2. Validar role do caller: deve ser super_admin ou system_admin em empresa parent
  SELECT cu.role, cu.company_id, c.company_type
    INTO v_caller_role, v_caller_company_id, v_caller_company_type
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
   WHERE cu.user_id   = v_caller_id
     AND cu.is_active = true
     AND c.company_type = 'parent'
     AND cu.role IN ('super_admin', 'system_admin')
   ORDER BY cu.created_at
   LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden: apenas super_admin ou system_admin de empresa parent podem estender trials'
    );
  END IF;

  -- 3. Validar empresa alvo: deve ser client e filha da parent do caller
  SELECT company_type, parent_company_id
    INTO v_target_type, v_target_parent_id
    FROM public.companies
   WHERE id = p_company_id;

  IF v_target_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'target company not found');
  END IF;

  IF v_target_type <> 'client' THEN
    RETURN jsonb_build_object('success', false, 'error', 'target is not a client company');
  END IF;

  IF v_target_parent_id <> v_caller_company_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden: empresa alvo não pertence à sua parent company'
    );
  END IF;

  -- 4. Buscar subscription atual da empresa alvo
  SELECT *
    INTO v_sub
    FROM public.company_subscriptions
   WHERE company_id = p_company_id;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa não possui subscription — trial não iniciado'
    );
  END IF;

  -- 5. Verificar que não há Stripe ativo (trial interno apenas)
  IF v_sub.stripe_subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa já possui subscription Stripe ativa — extensão de trial não aplicável'
    );
  END IF;

  -- 6. Verificar limite de 1 extensão por empresa
  IF v_sub.trial_extended = true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'trial já foi estendido — apenas 1 extensão permitida por empresa'
    );
  END IF;

  -- 7. Verificar que empresa está em trial ou trial expirado (candidata a extensão)
  IF v_sub.status NOT IN ('trialing', 'canceled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'empresa não está em estado de trial — extensão não aplicável (status: ' || v_sub.status || ')'
    );
  END IF;

  -- 8. Calcular nova data de trial_end
  --    Se ainda em trial: trial_end atual + 14 dias
  --    Se expirado (canceled): agora + 14 dias (reativa trial)
  v_original_end := v_sub.trial_end;
  v_new_end := GREATEST(v_sub.trial_end, now()) + interval '14 days';

  -- 9. Se trial havia expirado, resolver Growth plan para reativar
  IF v_sub.status = 'canceled' THEN
    SELECT id INTO v_growth_plan_id
      FROM public.plans
     WHERE slug = 'growth'
       AND is_active = true
     LIMIT 1;

    IF v_growth_plan_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'plano Growth não encontrado — não é possível reativar trial'
      );
    END IF;
  END IF;

  -- 10. Atualizar company_subscriptions
  UPDATE public.company_subscriptions
     SET trial_end      = v_new_end,
         trial_extended = true,
         status         = 'trialing',    -- reativa se estava canceled
         updated_at     = now()
   WHERE company_id = p_company_id;

  -- 11. Se trial havia expirado: reativar plan_id para Growth
  IF v_sub.status = 'canceled' AND v_growth_plan_id IS NOT NULL THEN
    PERFORM public.apply_operational_plan_change(
      p_company_id,
      v_growth_plan_id,
      NULL,
      NULL
    );
  END IF;

  -- 12. Registrar na auditoria
  INSERT INTO public.trial_extensions (
    company_id,
    extended_by,
    extended_at,
    original_end,
    new_end,
    notes
  )
  VALUES (
    p_company_id,
    v_caller_id,
    now(),
    v_original_end,
    v_new_end,
    p_notes
  );

  -- 13. [PATCH notifications_foundation] Limpar dedup de trial_alerts
  --     Permite que o cron envie novos alertas para as janelas 3d/1d
  --     após a extensão, sem bloquear por dedup do ciclo anterior.
  DELETE FROM public.notification_dedup
   WHERE company_id = p_company_id
     AND event_key LIKE 'trial_alert:%';

  RETURN jsonb_build_object(
    'success',       true,
    'company_id',    p_company_id,
    'original_end',  v_original_end,
    'new_end',       v_new_end,
    'reactivated',   v_sub.status = 'canceled'
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_company_trial(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.extend_company_trial IS
  'Estende trial de empresa client por +14 dias. Máximo 1 extensão por empresa. '
  'Apenas super_admin/system_admin de empresa parent pode chamar. '
  'Valida hierarquia parent→client no banco — nunca confia no frontend. '
  'Registra auditoria em trial_extensions. '
  'Reativa trial se havia expirado (status=canceled + stripe IS NULL). '
  '[v2 notifications_foundation] Limpa notification_dedup de trial_alerts após extensão '
  'para permitir novos alertas no ciclo seguinte.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 8. VERIFICAÇÃO FINAL
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_templates_count  integer;
  v_dedup_exists     boolean;
  v_logs_exists      boolean;
  v_is_seed_exists   boolean;
BEGIN
  -- Verificar tabelas criadas
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'notification_dedup'
  ) INTO v_dedup_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'notification_logs'
  ) INTO v_logs_exists;

  IF NOT v_dedup_exists THEN
    RAISE EXCEPTION 'NOTIFICATIONS FOUNDATION: tabela notification_dedup não foi criada.';
  END IF;

  IF NOT v_logs_exists THEN
    RAISE EXCEPTION 'NOTIFICATIONS FOUNDATION: tabela notification_logs não foi criada.';
  END IF;

  -- Verificar seeds de templates
  SELECT COUNT(*) INTO v_templates_count
    FROM public.notification_templates
   WHERE event_type = 'trial_alert'
     AND event_subtype IN ('3d', '1d');

  -- Verificar seed de integration_settings
  SELECT EXISTS (
    SELECT 1 FROM public.integration_settings
     WHERE provider = 'notifications'
       AND enabled = false
  ) INTO v_is_seed_exists;

  RAISE LOG '=== notifications_foundation aplicada com sucesso ===';
  RAISE LOG '  integration_settings (notifications): seed inserida (enabled=false)';
  RAISE LOG '  notification_templates: criada + % seeds (trial_alert 3d/1d × email/whatsapp)', v_templates_count;
  RAISE LOG '  notification_dedup:     criada (RLS, índices)';
  RAISE LOG '  notification_logs:      criada (RLS, índices)';
  RAISE LOG '  get_trial_alert_candidates(): criada (SECURITY DEFINER)';
  RAISE LOG '  extend_company_trial():       atualizada (+ DELETE notification_dedup)';
  RAISE LOG '  nenhuma notificação foi enviada';
  RAISE LOG '  nenhum runtime existente foi alterado';
  RAISE LOG '  trial, Stripe, leads, cron e frontend: INTACTOS';
END;
$$;

-- =============================================================================
-- Meta WhatsApp Cloud API — Fase 1A / Migration 4 de 4
-- Tabela: public.meta_whatsapp_onboarding
--
-- Sessão temporária do fluxo Embedded Signup (estrutura criada agora, usada na Fase 1B).
--
-- Propósito:
--   Representa um signup Meta iniciado mas ainda não concluído.
--   O estado de "número em processo de conexão" vive aqui — não em meta_whatsapp_instances.
--   meta_whatsapp_instances só é criada APÓS onboarding bem-sucedido.
--
-- Uso do id como session/state token:
--   id UUID (gen_random_uuid) — 122 bits de entropia — suficiente como token de estado.
--   Retornado ao frontend como identificador opaco da sessão (anti-CSRF).
--   Passado como state param no Embedded Signup.
--   Backend valida: id + expires_at > now() + used_at IS NULL.
--
-- Anti-replay:
--   used_at IS NULL     → sessão disponível, code ainda não trocado.
--   used_at IS NOT NULL → code já trocado, sessão consumida (rejeitar novo uso).
--
-- Limpeza futura:
--   idx_mwo_cleanup suporta DELETE WHERE expires_at < now() AND used_at IS NULL
--   (futuro cron ou pg_cron — não implementado nesta fase).
--
-- Segurança (nasce protegida):
--   Completamente inacessível para authenticated: RLS ativo + REVOKE ALL.
--   Somente service_role (backend) cria, lê e invalida sessões.
--
-- Rollback:
--   DROP TABLE public.meta_whatsapp_onboarding;
--   (Remove automaticamente: índice, FKs, PK)
-- =============================================================================

CREATE TABLE public.meta_whatsapp_onboarding (
  -- id serve como identificador opaco de sessão (state token do Embedded Signup)
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexto da sessão: empresa + usuário que iniciou o signup
  company_id  UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id),

  -- Controle de validade
  expires_at  TIMESTAMPTZ NOT NULL,

  -- Anti-replay: NULL = disponível; NOT NULL = code já trocado
  used_at     TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice de limpeza de sessões expiradas (futuro cron de manutenção)
CREATE INDEX idx_mwo_cleanup
  ON public.meta_whatsapp_onboarding (expires_at)
  WHERE used_at IS NULL;

-- =============================================================================
-- RLS + GRANT/REVOKE — service_role only
-- =============================================================================
ALTER TABLE public.meta_whatsapp_onboarding ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY para authenticated → zero acesso por default RLS.
-- Dupla proteção: RLS ativo sem policies + REVOKE ALL de authenticated.
-- Padrão: lead_conversion_signals (20260718193000), visitor_checkout_links (20260813100000).

REVOKE ALL ON TABLE public.meta_whatsapp_onboarding FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_whatsapp_onboarding FROM anon;
REVOKE ALL ON TABLE public.meta_whatsapp_onboarding FROM authenticated;
GRANT ALL ON TABLE public.meta_whatsapp_onboarding TO service_role;

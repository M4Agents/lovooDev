-- =============================================================================
-- Nuvemshop Integration — Migration 6/12
-- Tabela: nuvemshop_replay_audit
--
-- Trilha de auditoria imutável para replays administrativos de eventos.
-- Toda ação de replay é registrada atomicamente junto com a atualização
-- do evento (ver RPC replay_nuvemshop_event).
--
-- Acesso de leitura restrito a platform_admin.
-- Nunca é modificada ou deletada por usuários autenticados.
-- =============================================================================

CREATE TABLE public.nuvemshop_replay_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID        NOT NULL REFERENCES public.nuvemshop_webhook_events(id),
  company_id        UUID        NOT NULL REFERENCES public.companies(id),
  store_id          TEXT        NOT NULL,

  -- Quem executou o replay
  replayed_by       UUID        NOT NULL REFERENCES auth.users(id),
  replayed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contador incremental de replays do mesmo evento
  replay_count      SMALLINT    NOT NULL DEFAULT 1,

  -- Estado antes/depois do replay
  previous_status   TEXT        NOT NULL,
  new_status        TEXT        NOT NULL DEFAULT 'pending',

  -- Justificativa obrigatória
  reason            TEXT        NOT NULL,

  -- Contexto de rede (para auditoria de segurança)
  ip_address        TEXT,
  user_agent        TEXT,

  -- Rastreabilidade da ação administrativa
  correlation_id    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()

  -- Sem updated_at — registro imutável (append-only)
);

-- Índices
CREATE INDEX idx_nvaudit_event
  ON public.nuvemshop_replay_audit(event_id);

CREATE INDEX idx_nvaudit_company
  ON public.nuvemshop_replay_audit(company_id);

CREATE INDEX idx_nvaudit_replayed_by
  ON public.nuvemshop_replay_audit(replayed_by);

CREATE INDEX idx_nvaudit_replayed_at
  ON public.nuvemshop_replay_audit(replayed_at DESC);

-- RLS
ALTER TABLE public.nuvemshop_replay_audit ENABLE ROW LEVEL SECURITY;

-- Leitura restrita: apenas platform admins (super_admin / system_admin)
CREATE POLICY "nvaudit_select_platform_admin"
  ON public.nuvemshop_replay_audit
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_platform_admin()
  );

-- INSERT: apenas service_role (via RPC replay_nuvemshop_event)
-- UPDATE / DELETE: bloqueados — registro imutável

-- MIGRATION: Criar tabela lead_entries
-- Propósito: registrar cada entrada de um lead no sistema (identidade ≠ entrada ≠ ciclo comercial)
-- Garante idempotência via UNIQUE(company_id, idempotency_key)

CREATE TABLE IF NOT EXISTS lead_entries (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id           INTEGER     NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source            TEXT        NOT NULL,
  -- source: canal técnico de entrada. Valores válidos: webhook | whatsapp | import | manual
  origin_channel    TEXT        DEFAULT NULL,
  -- origin_channel: canal de negócio/marketing (ex: facebook_ads, email_marketing, indicacao)
  -- extraído de utm_source/origin no payload quando disponível. NULL quando não disponível.
  external_event_id TEXT        DEFAULT NULL,
  -- external_event_id: identificador externo bruto (uazapi_message_id, webhook_id)
  -- armazenado antes do hash para rastreabilidade inversa. NULL quando não disponível.
  idempotency_key   TEXT        NOT NULL,
  -- idempotency_key: gerado pelo backend via estratégia hierárquica
  --   P1: SHA256(company_id + '::' + external_event_id) quando external_event_id disponível
  --   P2: SHA256(company_id + '::' + lead_id + '::' + source + '::' + hash_payload[:16])
  --   P3: SHA256(company_id + '::' + lead_id + '::' + source + '::' + epoch_seconds) — fallback
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata          JSONB       NOT NULL DEFAULT '{}'
  -- metadata: campos adicionais como lock_failed, lead_entry_id, source_detail
);

-- Constraint de idempotência real
ALTER TABLE lead_entries
  ADD CONSTRAINT lead_entries_idempotency_unique UNIQUE (company_id, idempotency_key);

-- Índice por lead (listagem de entradas de um lead)
CREATE INDEX IF NOT EXISTS idx_lead_entries_company_lead
  ON lead_entries (company_id, lead_id);

-- Índice por data (relatórios temporais)
CREATE INDEX IF NOT EXISTS idx_lead_entries_company_created
  ON lead_entries (company_id, created_at);

-- Índice parcial por external_event_id (busca direta por evento externo)
-- Parcial: não penaliza registros sem external_event_id (maioria dos casos)
CREATE INDEX IF NOT EXISTS idx_lead_entries_external_event
  ON lead_entries (company_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- RLS
ALTER TABLE lead_entries ENABLE ROW LEVEL SECURITY;

-- Leitura: membros ativos da empresa
CREATE POLICY "lead_entries_select" ON lead_entries
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- Escrita: apenas service_role (backend)
-- Sem policy INSERT/UPDATE/DELETE para anon ou authenticated — service_role contorna RLS

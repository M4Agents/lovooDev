-- =============================================================================
-- Nuvemshop Integration — Migration Fix Fase 13
-- Campos de retry controlado para instalação de Scripts
--
-- script_retry_count INTEGER:
--   Contagem de tentativas de instalação falhas.
--   Resetado para 0 em caso de sucesso.
--   Quando >= MAX_SCRIPT_RETRIES (5), o cron para de tentar.
--
-- script_next_retry_at TIMESTAMPTZ:
--   Data/hora da próxima tentativa permitida.
--   Definido com backoff exponencial após cada falha:
--     Tentativa 1: now() + 2 min
--     Tentativa 2: now() + 5 min
--     Tentativa 3: now() + 15 min
--     Tentativa 4: now() + 60 min
--     Tentativa 5: (limite atingido — script_status permanece 'failed')
--   Usado também como mecanismo de claim atômico:
--     O RPC claim_nuvemshop_pending_scripts define este campo como
--     now() + 10 min imediatamente ao fazer o claim, prevenindo que
--     dois workers paralelos processem a mesma conexão.
-- =============================================================================

ALTER TABLE public.nuvemshop_connections
  ADD COLUMN IF NOT EXISTS script_retry_count    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS script_next_retry_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.nuvemshop_connections.script_retry_count IS
  'Contagem de tentativas falhas de instalação do script. '
  'Reset para 0 em sucesso. Parar de tentar quando >= 5 (MAX_SCRIPT_RETRIES).';

COMMENT ON COLUMN public.nuvemshop_connections.script_next_retry_at IS
  'Próxima tentativa permitida (backoff exponencial). '
  'Usado também como claim lock pelo RPC claim_nuvemshop_pending_scripts: '
  'definido como now()+10min no momento do claim para evitar processamento duplo.';

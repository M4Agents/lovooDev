-- =============================================================================
-- Nuvemshop Integration — Migration Fix Fase 12
-- Corrige valores permitidos de script_status em nuvemshop_connections
--
-- Substitui o valor 'created' por 'active', alinhando com a nomenclatura
-- do Plano v5.1 e com a semântica do status de script em produção.
--
-- Novos valores permitidos:
--   NULL          → criação nunca tentada
--   'pending'     → script aguardando instalação (definido no callback OAuth)
--   'active'      → script instalado com sucesso na loja (era 'created')
--   'failed'      → falha na criação (nova tentativa possível)
--   'config_error'→ NUVEMSHOP_TRACKING_SCRIPT_URL não configurado
--   'deleted'     → script removido da loja (desconexão)
--   'delete_failed'→ falha na remoção (conexão desconectada mesmo assim)
-- =============================================================================

ALTER TABLE public.nuvemshop_connections
  DROP CONSTRAINT IF EXISTS chk_conn_script_status;

ALTER TABLE public.nuvemshop_connections
  ADD CONSTRAINT chk_conn_script_status
    CHECK (
      script_status IS NULL
      OR script_status IN (
        'pending',
        'active',
        'failed',
        'config_error',
        'deleted',
        'delete_failed'
      )
    );

-- Migrar registros existentes com 'created' para 'active'
UPDATE public.nuvemshop_connections
   SET script_status = 'active'
 WHERE script_status = 'created';

COMMENT ON COLUMN public.nuvemshop_connections.script_status IS
  'Ciclo de vida do script de rastreamento: '
  'NULL=nunca tentado | pending=aguardando instalação | '
  'active=instalado | failed=falha | config_error=sem URL configurada | '
  'deleted=removido | delete_failed=falha na remoção (desconexão prosseguiu).';

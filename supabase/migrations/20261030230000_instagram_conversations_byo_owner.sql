-- =============================================================================
-- Instagram Direct BYO — dono exclusivo da conversa
--
-- Adiciona byo_account_id e permite connection_id nulo somente no par
-- exclusivo. Não grava conversas, não altera mensagens, comentários,
-- conexões oficiais, RPCs nem RLS.
--
-- Linhas oficiais já existentes satisfazem o CHECK: connection_id nasceu
-- NOT NULL em 20260525120000 e nenhuma migration posterior o anula.
-- byo_account_id entra nulo. O par (conexão preenchida, BYO nulo) é válido.
-- Nenhuma linha existente é reescrita.
--
-- A conta BYO já tem PRIMARY KEY (id). O único (id, company_id) só existe
-- para a FK composta impedir conversa de uma empresa apontando para conta
-- de outra. Não muda dados nem policies da tabela referenciada.
--
-- Rollback, somente se não houver conversa BYO:
--   ALTER TABLE public.instagram_conversations
--     DROP CONSTRAINT IF EXISTS chk_igconv_owner_exclusive,
--     DROP CONSTRAINT IF EXISTS fk_igconv_byo_account_company;
--   DROP INDEX IF EXISTS public.idx_igconv_byo_account;
--   ALTER TABLE public.instagram_conversations
--     DROP COLUMN IF EXISTS byo_account_id,
--     ALTER COLUMN connection_id SET NOT NULL;
--   ALTER TABLE public.instagram_byo_poc_accounts
--     DROP CONSTRAINT IF EXISTS uq_ig_byo_poc_id_company;
-- =============================================================================

ALTER TABLE public.instagram_byo_poc_accounts
  ADD CONSTRAINT uq_ig_byo_poc_id_company UNIQUE (id, company_id);

ALTER TABLE public.instagram_conversations
  ADD COLUMN byo_account_id UUID,
  ALTER COLUMN connection_id DROP NOT NULL;

ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT fk_igconv_byo_account_company
    FOREIGN KEY (byo_account_id, company_id)
    REFERENCES public.instagram_byo_poc_accounts (id, company_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT chk_igconv_owner_exclusive
    CHECK (
      (connection_id IS NOT NULL AND byo_account_id IS NULL)
      OR (connection_id IS NULL AND byo_account_id IS NOT NULL)
    );

CREATE INDEX idx_igconv_byo_account
  ON public.instagram_conversations (company_id, byo_account_id)
  WHERE byo_account_id IS NOT NULL;

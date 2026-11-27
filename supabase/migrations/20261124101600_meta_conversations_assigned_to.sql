-- =============================================================================
-- Meta WhatsApp — atribuição da conversa (META-L1.4C.5.1D.1)
--
-- Estrutura aditiva. Não faz backfill, não altera funções, triggers, policies,
-- grants nem tabelas Uazapi. Nenhuma restrição de visibilidade é ativada.
--
-- assigned_to é anulável. MATCH SIMPLE não valida a linha enquanto ele é nulo.
-- A FK composta exige que um valor preenchido exista em company_users da mesma
-- company_id. Ela não consulta is_active: membership inativa continua
-- referenciável até uma etapa posterior de atribuição e acesso.
--
-- ON DELETE SET NULL (assigned_to) limpa só a atribuição.
-- company_id da conversa permanece.
-- ON UPDATE NO ACTION impede que uma mudança da chave de company_users
-- reescreva company_id da conversa.
--
-- O índice serve o recorte company_id + assigned_to, com ou sem instance_id,
-- e a procura referencial da FK. A listagem geral continua em
-- idx_mc_company_instance_last_message.
-- =============================================================================

ALTER TABLE public.meta_conversations
  ADD COLUMN assigned_to uuid NULL;

COMMENT ON COLUMN public.meta_conversations.assigned_to IS
  'Usuário atribuído à conversa Meta. Nulo significa sem atribuição. '
  'A FK composta garante membership na mesma empresa, não is_active.';

ALTER TABLE public.meta_conversations
  ADD CONSTRAINT meta_conversations_company_assigned_to_fkey
  FOREIGN KEY (company_id, assigned_to)
  REFERENCES public.company_users (company_id, user_id)
  ON UPDATE NO ACTION
  ON DELETE SET NULL (assigned_to);

CREATE INDEX idx_meta_conversations_company_assigned_instance
  ON public.meta_conversations (company_id, assigned_to, instance_id)
  WHERE assigned_to IS NOT NULL;

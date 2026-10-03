-- NÃO EXECUTAR sem autorização. Sempre terminar em ROLLBACK.
-- Não cria lead. Usa uma oportunidade existente com probability=50,
-- escolhida no momento do teste, e devolve o valor no mesmo bloco.
-- Se o ROLLBACK não rodar, o UPDATE ficaria visível — por isso é
-- transação única, sem COMMIT.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '15s';

-- Substituir :opp_id por um id lido antes (probability=50, empresa de teste).
-- SELECT id, company_id, probability
-- FROM opportunities
-- WHERE probability = 50
-- ORDER BY updated_at ASC
-- LIMIT 5;

UPDATE opportunities
SET probability = NULL
WHERE id = :opp_id
  AND probability = 50
RETURNING id, company_id, probability;

-- Aqui chamar as v2 com faixa 0–100 e confirmar exclusão do id.
-- Depois chamar sem faixa e confirmar inclusão.

UPDATE opportunities
SET probability = 50
WHERE id = :opp_id
  AND probability IS NULL
RETURNING id, probability;

ROLLBACK;

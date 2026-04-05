-- Instruções internas para o agente de IA quando produto/serviço não estiver disponível (nullable, sem impacto em regras comerciais).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ai_unavailable_guidance TEXT NULL;

COMMENT ON COLUMN products.ai_unavailable_guidance IS
  'Texto interno para o agente de IA ao tratar item indisponível (ex.: unavailable, discontinued); não exibir ao cliente final.';

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS ai_unavailable_guidance TEXT NULL;

COMMENT ON COLUMN services.ai_unavailable_guidance IS
  'Texto interno para o agente de IA ao tratar item indisponível (ex.: unavailable, discontinued); não exibir ao cliente final.';

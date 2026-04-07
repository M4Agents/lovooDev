-- =====================================================
-- Logging de Execução dos Agentes Lovoo — MVP
--
-- Esta migration cria a tabela operacional de observabilidade
-- das execuções do runner de Agentes Lovoo globais.
--
-- IMPORTANTE — o que esta tabela É:
--   • base de observabilidade: tokens, duração, status, custo estimado
--   • fonte de dados para futura análise de consumo por empresa
--   • rastreabilidade operacional de cada chamada ao runAgent()
--
-- IMPORTANTE — o que esta tabela NÃO É:
--   • billing real ou faturamento
--   • controle de plano contratado
--   • base para bloqueio de uso
--   • substituto de regras comerciais
--
-- Separação de camadas futura:
--   1. Logs (esta tabela)      → observabilidade
--   2. Regras de consumo       → limites, planos, quota por empresa
--   3. Decisão                 → alertas, bloqueios
--
-- Empresa pai: dcc99d3d-9def-4b93-aeb2-1a3be5f15413
-- INSERT: exclusivo via service_role no backend (logger.ts)
-- SELECT: admin/super_admin da empresa pai apenas
-- =====================================================

-- ── 1. Tabela ai_agent_execution_logs ────────────────────────────────────────

CREATE TABLE public.ai_agent_execution_logs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador do uso funcional que disparou a execução
  -- (ex.: 'chat:reply_suggestion:whatsapp')
  use_id               TEXT        NOT NULL,

  -- UUID do agente que executou. NULL quando nenhum agente foi resolvido
  -- (fallback por ausência de binding, agente inativo, etc.).
  -- Sem FK intencional: logs devem sobreviver à deleção do agente.
  agent_id             UUID        NULL,

  -- ─────────────────────────────────────────────────────────────────────────
  -- consumer_company_id: empresa/tenant que CONSUMIU a execução.
  --
  -- NÃO confundir com agent.company_id (empresa pai, dona do agente).
  -- Este campo é o tenant consumidor — quem triggou o runAgent().
  -- Chave para futuras queries de custo/consumo por empresa.
  -- Sem FK intencional: logs devem sobreviver à deleção do tenant.
  -- ─────────────────────────────────────────────────────────────────────────
  consumer_company_id  UUID        NULL,

  -- UUID do usuário que disparou, quando disponível.
  -- NULL em contextos sem sessão (WhatsApp webhook, automações, etc.).
  -- Sem FK intencional: log deve sobreviver à deleção do usuário.
  user_id              UUID        NULL,

  -- Canal de origem (ex.: 'whatsapp', 'web', 'api').
  channel              TEXT        NULL,

  -- Modelo OpenAI usado (ex.: 'gpt-4.1-mini'). NULL quando OpenAI
  -- não foi chamada (fallback precoce, erro de config, etc.).
  model                TEXT        NULL,

  -- Modo de conhecimento do agente no momento da execução.
  knowledge_mode       TEXT        NULL
    CHECK (knowledge_mode IN ('none', 'inline', 'rag', 'hybrid')),

  -- Status da execução. Ver documentação em docs/adr/ADR-001.
  -- Valores possíveis:
  --   success                    → OpenAI respondeu com sucesso
  --   fallback_no_agent          → sem binding ou agente inativo
  --   fallback_openai_unavailable → OpenAI indisponível/desabilitada
  --   fallback_openai_failed     → OpenAI falhou, fallback estático retornado
  --   error_missing_context      → requires_context=true, extra_context ausente
  --   error_openai               → OpenAI falhou, sem fallback configurado
  --   error_db                   → falha na resolução do agente (DB/config)
  status               TEXT        NOT NULL
    CHECK (status IN (
      'success',
      'fallback_no_agent',
      'fallback_openai_unavailable',
      'fallback_openai_failed',
      'error_missing_context',
      'error_openai',
      'error_db'
    )),

  -- Indica se a resposta retornada foi um fallback estático
  -- (não gerada pelo modelo configurado).
  is_fallback          BOOLEAN     NOT NULL DEFAULT false,

  -- Duração total da execução em milissegundos.
  -- Inclui resolução do agente, retrieval RAG e chamada OpenAI.
  duration_ms          INTEGER     NULL,

  -- Tokens reportados pelo OpenAI na response.usage.
  -- NULL quando OpenAI não foi chamada.
  input_tokens         INTEGER     NULL,
  output_tokens        INTEGER     NULL,
  total_tokens         INTEGER     NULL,

  -- ─────────────────────────────────────────────────────────────────────────
  -- estimated_cost_usd: ESTIMATIVA OPERACIONAL de custo em USD.
  --
  -- NÃO é faturamento real. NÃO representa o valor cobrado pela OpenAI.
  -- Calculado com base em pricing.ts (tabela hardcoded com revisão manual).
  -- NULL quando o modelo não está mapeado em pricing.ts.
  -- Fonte oficial de preços: https://openai.com/api/pricing/
  -- ─────────────────────────────────────────────────────────────────────────
  estimated_cost_usd   NUMERIC(12, 8) NULL,

  -- ─────────────────────────────────────────────────────────────────────────
  -- pricing_version: identificador da versão do mapa de preços usado
  -- no momento do cálculo de estimated_cost_usd.
  --
  -- No MVP: string da revisão hardcoded em pricing.ts (ex.: '2026-04').
  -- No futuro: poderá referenciar uma versão em ai_agent_pricing_versions,
  -- permitindo auditoria histórica de qual tabela de preços foi aplicada.
  -- ─────────────────────────────────────────────────────────────────────────
  pricing_version      TEXT        NULL,

  -- Código de erro/fallback estruturado.
  -- Obrigatório quando status ≠ 'success' (enforçado no TypeScript,
  -- não via constraint SQL para manter flexibilidade de migração futura).
  -- Valores válidos documentados em logger.ts (ExecutionLogEntry union type).
  error_code           TEXT        NULL
    CHECK (error_code IS NULL OR error_code IN (
      'no_binding',
      'agent_inactive',
      'openai_not_configured',
      'openai_disabled',
      'openai_client_null',
      'openai_execution_failed',
      'missing_required_context',
      'db_error'
    )),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Índices ────────────────────────────────────────────────────────────────
--
-- Preparados para as queries mais frequentes de observabilidade e futuros
-- dashboards de custo por empresa, erros por uso e análise global.

-- Custo e consumo por tenant ao longo do tempo
CREATE INDEX idx_ai_agent_logs_company_time
  ON public.ai_agent_execution_logs (consumer_company_id, created_at DESC);

-- Análise de comportamento e erro por uso funcional
CREATE INDEX idx_ai_agent_logs_use_time
  ON public.ai_agent_execution_logs (use_id, created_at DESC);

-- Monitoramento de erros e fallbacks
CREATE INDEX idx_ai_agent_logs_status_time
  ON public.ai_agent_execution_logs (status, created_at DESC);

-- Queries globais recentes (dashboard geral, custo total)
CREATE INDEX idx_ai_agent_logs_time
  ON public.ai_agent_execution_logs (created_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
--
-- INSERT: realizado exclusivamente via service_role no backend (logger.ts).
--         service_role bypassa RLS — nenhuma policy de INSERT necessária.
--
-- SELECT: restrito a admin/super_admin da empresa pai.
--         Tenants NÃO acessam logs — nem os próprios nem os de outros.
--         Dois caminhos: company_users (padrão novo) + companies.user_id (legado).
--
-- UPDATE / DELETE: não permitidos via client — logs são imutáveis.

ALTER TABLE public.ai_agent_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_agent_logs_select"
  ON public.ai_agent_execution_logs
  FOR SELECT
  TO authenticated
  USING (
    -- Caminho A: membro ativo com role admin/super_admin na empresa pai
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND cu.role       IN ('super_admin', 'admin')
        AND cu.is_active  IS NOT FALSE
    )
    OR
    -- Caminho B: dono legado (companies.user_id + is_super_admin)
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id             = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'::uuid
        AND c.user_id        = auth.uid()
        AND c.is_super_admin IS TRUE
    )
  );

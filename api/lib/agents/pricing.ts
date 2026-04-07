// =============================================================================
// api/lib/agents/pricing.ts
//
// Pricing operacional dos modelos OpenAI usados pelos Agentes Lovoo globais.
//
// NATUREZA DESTE ARQUIVO:
//   • Estimativa operacional de custo — NÃO é faturamento real.
//   • Os valores calculados são referências internas para observabilidade.
//   • Não devem ser exibidos ao cliente como valores cobrados.
//
// FONTE OFICIAL DE PREÇOS:
//   https://openai.com/api/pricing/
//
// PROCEDIMENTO DE ATUALIZAÇÃO (seguir obrigatoriamente):
//   1. Acessar https://openai.com/api/pricing/
//   2. Revisar os preços dos modelos listados abaixo
//   3. Atualizar os valores em MODEL_PRICING
//   4. Atualizar PRICING_REVISION (formato: YYYY-MM)
//   5. Atualizar PRICING_REVIEWED_AT (formato: YYYY-MM-DD)
//   6. Revisar impacto em logs existentes (campos históricos não são reprocessados)
//   7. Fazer commit da mudança com mensagem indicando a revisão
//
// MODELOS NÃO MAPEADOS:
//   Se o agente usar um modelo não listado aqui, estimateCost() retorna null.
//   O campo estimated_cost_usd ficará NULL no banco — sem erro, sem fallback falso.
//
// EVOLUÇÃO FUTURA:
//   Este arquivo será substituído por uma tabela versionada (ai_agent_pricing_versions)
//   com fluxo: input manual → parsing assistido → validação backend → aprovação humana.
//   Ver docs/adr/ADR-001-ai-agent-logging-and-costs.md
// =============================================================================

/** Identificador da revisão atual dos preços (formato: YYYY-MM). */
export const PRICING_REVISION = '2026-04'

/** Data em que os preços foram revisados manualmente (formato: YYYY-MM-DD). */
export const PRICING_REVIEWED_AT = '2026-04-07'

/** URL oficial de preços da OpenAI — revisar periodicamente. */
export const OPENAI_PRICING_URL = 'https://openai.com/api/pricing/'

// -----------------------------------------------------------------------------
// Estrutura interna de preços por modelo
// Valores em USD por 1.000 tokens (preço por milhar).
// -----------------------------------------------------------------------------

interface ModelPricing {
  /** Custo por 1.000 tokens de entrada (prompt). */
  inputPer1k: number
  /** Custo por 1.000 tokens de saída (completion). */
  outputPer1k: number
}

/**
 * Mapa de preços dos modelos globais realmente usados pelos Agentes Lovoo.
 *
 * Inclui apenas modelos que podem ser selecionados no painel de administração.
 * Preços revisados manualmente em PRICING_REVIEWED_AT.
 * Fonte: https://openai.com/api/pricing/
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // GPT-4.1 — família principal atual (default: gpt-4.1-mini)
  'gpt-4.1':        { inputPer1k: 0.002,    outputPer1k: 0.008    },
  'gpt-4.1-mini':   { inputPer1k: 0.0004,   outputPer1k: 0.0016   },
  'gpt-4.1-nano':   { inputPer1k: 0.0001,   outputPer1k: 0.0004   },

  // GPT-4o — família anterior, ainda amplamente configurada
  'gpt-4o':         { inputPer1k: 0.0025,   outputPer1k: 0.01     },
  'gpt-4o-mini':    { inputPer1k: 0.00015,  outputPer1k: 0.0006   },
}

// -----------------------------------------------------------------------------
// Funções públicas
// -----------------------------------------------------------------------------

/**
 * Estima o custo em USD de uma execução com base no modelo e tokens consumidos.
 *
 * Retorna `null` se:
 * - o modelo não estiver mapeado em MODEL_PRICING
 * - inputTokens ou outputTokens não forem números válidos
 *
 * O valor retornado é uma ESTIMATIVA OPERACIONAL.
 * Não representa faturamento real nem o valor cobrado pela OpenAI.
 */
export function estimateCost(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  if (!model) return null

  const pricing = MODEL_PRICING[model]
  if (!pricing) return null

  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    !isFinite(inputTokens) ||
    !isFinite(outputTokens)
  ) {
    return null
  }

  const cost =
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k

  // Arredondar para 8 casas decimais — alinhado com NUMERIC(12,8) no banco
  return Math.round(cost * 1e8) / 1e8
}

/**
 * Retorna a revisão atual do pricing para salvar nos logs.
 * Permite rastreabilidade histórica do cálculo de custo por execução.
 */
export function getPricingRevision(): string {
  return PRICING_REVISION
}

/**
 * Verifica se um modelo está mapeado na tabela de preços.
 * Útil para diagnóstico e testes.
 */
export function isModelMapped(model: string): boolean {
  return model in MODEL_PRICING
}

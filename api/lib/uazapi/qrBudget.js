// Orçamento único do QR. A função na Vercel está limitada a 60 segundos.
// As etapas dividem 50 segundos e deixam 10 de margem para autenticação e banco.

export const QR_FUNCTION_LIMIT_MS = 60_000;
export const QR_SAFETY_MARGIN_MS = 10_000;
export const QR_BUDGET_MS = QR_FUNCTION_LIMIT_MS - QR_SAFETY_MARGIN_MS;
export const INIT_CAP_MS = 12_000;
export const WEBHOOK_CAP_MS = 5_000;

const MIN_STEP_MS = 1_000;

export function timeoutForStep(elapsedMs, capMs, budgetMs = QR_BUDGET_MS) {
  const remaining = budgetMs - elapsedMs;
  if (remaining < MIN_STEP_MS) return 0;
  return Math.min(capMs, remaining);
}

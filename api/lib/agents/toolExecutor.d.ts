// Type declarations for toolExecutor.js
export declare function executeToolCalls(
  toolCalls: unknown[],
  context: Record<string, unknown>
): Promise<unknown[]>

export declare function executeToolCallsSandbox(
  toolCalls: unknown[],
  context: Record<string, unknown>
): Promise<{ toolResults: unknown[]; events: unknown[] }>

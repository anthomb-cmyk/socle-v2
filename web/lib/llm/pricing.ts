// Anthropic model pricing — source of truth.
// USD per 1 million tokens. Update when Anthropic changes pricing.
//
// Reference: https://docs.anthropic.com/en/docs/about-claude/pricing
// (Cached prompt tokens not modelled — we don't yet hit cache hit-rates that
// would make this material; revisit if briefing-prefix caching becomes hot.)

export interface ModelPricing {
  /** USD per million INPUT tokens */
  input: number;
  /** USD per million OUTPUT tokens */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Haiku 4.5 — small, fast, our default for fallback gates and briefings
  "claude-haiku-4-5":           { input: 1.00, output: 5.00 },
  "claude-haiku-4-5-20251001":  { input: 1.00, output: 5.00 },

  // Sonnet 4.6 — medium, used when reasoning quality matters more than cost
  "claude-sonnet-4-6":          { input: 3.00, output: 15.00 },

  // Opus 4.6/4.7 — only for high-stakes architectural reasoning, not runtime
  "claude-opus-4-6":            { input: 15.00, output: 75.00 },
  "claude-opus-4-7":            { input: 15.00, output: 75.00 },
};

/** Compute USD cost for a single Anthropic call given token counts. */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Unknown model — log $0 rather than throw; the row still records token counts.
    return 0;
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/** Human-readable cost in USD with a sensible number of decimal places. */
export function formatCostUsd(usd: number): string {
  if (usd >= 1)     return `$${usd.toFixed(2)}`;
  if (usd >= 0.01)  return `$${usd.toFixed(3)}`;
  if (usd >= 0.001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}

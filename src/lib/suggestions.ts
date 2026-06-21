// Homepage starter suggestions: a small pool of AI-generated questions kept
// warm so the user never waits, with a hard token-spend safety budget.
//
// The safety story has three layers, all enforced here (policy) and atomically
// in the store (claimGeneration):
//   1. Batch generation — one AI call yields several suggestions.
//   2. Refill only when the pool drops below target (never overfill).
//   3. A per-user/day cap on generation calls + a debounce between calls.

export const SUGGESTION_POOL_TARGET = 4;
export const SUGGESTION_BATCH_SIZE = 5;
// Hard ceiling on AI calls per user per UTC day. At BATCH_SIZE each, this caps
// the daily suggestion spend regardless of how often the user dismisses.
export const MAX_SUGGESTION_GENERATIONS_PER_DAY = 8;
// Don't fire two refill batches closer together than this.
export const MIN_SUGGESTION_REFILL_INTERVAL_MS = 15_000;

export type SuggestionBudget = {
  /** UTC day (YYYY-MM-DD) the counter belongs to; "" when never generated. */
  day: string;
  generationsToday: number;
  lastGeneratedAt: Date;
};

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Generations counted for today (0 once the day rolls over). */
export function generationsToday(budget: SuggestionBudget, now: Date): number {
  return budget.day === utcDay(now) ? budget.generationsToday : 0;
}

/**
 * Whether a refill should be attempted: pool below target, under the daily
 * cap, and past the debounce window. Pure — the store re-checks the budget
 * atomically (claimGeneration) to stay correct under concurrent requests.
 */
export function shouldRefill(
  readyCount: number,
  budget: SuggestionBudget,
  now: Date,
): boolean {
  if (readyCount >= SUGGESTION_POOL_TARGET) return false;
  if (generationsToday(budget, now) >= MAX_SUGGESTION_GENERATIONS_PER_DAY) {
    return false;
  }
  if (
    now.getTime() - budget.lastGeneratedAt.getTime() <
    MIN_SUGGESTION_REFILL_INTERVAL_MS
  ) {
    return false;
  }
  return true;
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse the model's batch output into clean, de-duplicated question strings.
 * Strips list markers/quotes, drops too-short/too-long lines, and skips any
 * that duplicate `existing` (already-asked questions or pooled suggestions).
 */
export function parseSuggestionLines(
  raw: string,
  existing: string[] = [],
): string[] {
  const seen = new Set(existing.map(normalizeQuestion));
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const cleaned = line
      .trim()
      // Leading list markers: "1.", "2)", "-", "*", "•".
      .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "")
      // Surrounding quotes (straight or curly).
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    if (cleaned.length < 8 || cleaned.length > 200) continue;
    const key = normalizeQuestion(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

import { describe, expect, it } from "vitest";

import {
  MAX_SUGGESTION_GENERATIONS_PER_DAY,
  MIN_SUGGESTION_REFILL_INTERVAL_MS,
  SUGGESTION_POOL_TARGET,
  parseSuggestionLines,
  shouldRefill,
  utcDay,
  type SuggestionBudget,
} from "@/lib/suggestions";

const now = new Date("2026-06-21T12:00:00Z");
const fresh: SuggestionBudget = {
  day: utcDay(now),
  generationsToday: 0,
  // Long ago, so the debounce never blocks unless we set it close.
  lastGeneratedAt: new Date("2026-06-21T11:00:00Z"),
};

describe("shouldRefill", () => {
  it("refills when the pool is below target and budget allows", () => {
    expect(shouldRefill(SUGGESTION_POOL_TARGET - 1, fresh, now)).toBe(true);
  });

  it("never refills a full pool (never overfills)", () => {
    expect(shouldRefill(SUGGESTION_POOL_TARGET, fresh, now)).toBe(false);
    expect(shouldRefill(SUGGESTION_POOL_TARGET + 5, fresh, now)).toBe(false);
  });

  it("stops at the daily generation cap (token safety)", () => {
    const maxed: SuggestionBudget = {
      ...fresh,
      generationsToday: MAX_SUGGESTION_GENERATIONS_PER_DAY,
    };
    expect(shouldRefill(0, maxed, now)).toBe(false);
  });

  it("resets the cap when the UTC day rolls over", () => {
    const yesterdayMaxed: SuggestionBudget = {
      day: "2026-06-20",
      generationsToday: MAX_SUGGESTION_GENERATIONS_PER_DAY,
      lastGeneratedAt: new Date("2026-06-20T23:00:00Z"),
    };
    expect(shouldRefill(0, yesterdayMaxed, now)).toBe(true);
  });

  it("debounces back-to-back refills", () => {
    const justGenerated: SuggestionBudget = {
      ...fresh,
      lastGeneratedAt: new Date(
        now.getTime() - MIN_SUGGESTION_REFILL_INTERVAL_MS / 2,
      ),
    };
    expect(shouldRefill(0, justGenerated, now)).toBe(false);
  });

  it("allows a refill once the debounce window has passed", () => {
    const aWhileAgo: SuggestionBudget = {
      ...fresh,
      lastGeneratedAt: new Date(
        now.getTime() - MIN_SUGGESTION_REFILL_INTERVAL_MS - 1,
      ),
    };
    expect(shouldRefill(0, aWhileAgo, now)).toBe(true);
  });

  it("treats a never-generated budget as eligible", () => {
    const never: SuggestionBudget = {
      day: "",
      generationsToday: 0,
      lastGeneratedAt: new Date(0),
    };
    expect(shouldRefill(0, never, now)).toBe(true);
  });
});

describe("parseSuggestionLines", () => {
  it("strips numbering, bullets, and surrounding quotes", () => {
    const raw = [
      "1. What is consciousness?",
      "- Is time real?",
      '"Can we know another mind?"',
      "• Why be moral?",
    ].join("\n");
    expect(parseSuggestionLines(raw)).toEqual([
      "What is consciousness?",
      "Is time real?",
      "Can we know another mind?",
      "Why be moral?",
    ]);
  });

  it("drops too-short and too-long lines and blanks", () => {
    const raw = ["ok?", "", "   ", "x".repeat(250), "Is the self an illusion?"].join(
      "\n",
    );
    expect(parseSuggestionLines(raw)).toEqual(["Is the self an illusion?"]);
  });

  it("de-duplicates against existing questions (normalized)", () => {
    const raw = ["What is kindness?", "What  is   KINDNESS?!"].join("\n");
    expect(
      parseSuggestionLines(raw, ["what is kindness"]),
    ).toEqual([]);
  });

  it("de-duplicates within a single batch", () => {
    const raw = ["Is free will real?", "is free will real"].join("\n");
    expect(parseSuggestionLines(raw)).toEqual(["Is free will real?"]);
  });
});

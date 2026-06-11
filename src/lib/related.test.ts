import { describe, expect, it } from "vitest";

import { findRelatedQuestions } from "@/lib/related";

const subs = [
  { id: "a1", question: "What is entropy in thermodynamics?" },
  { id: "a2", question: "How do markets allocate capital?" },
  { id: "a3", question: "What is the entropy of a black hole?" },
  { id: "a4", question: "Why is the sky blue?" },
];

describe("findRelatedQuestions", () => {
  it("ranks submissions that share significant words", () => {
    const result = findRelatedQuestions("entropy", subs);
    expect(result.map((s) => s.id)).toEqual(["a1", "a3"]);
  });

  it("boosts a question that contains the typed query as a substring", () => {
    // Both a1 and a3 share 'entropy', but only a3 contains the full phrase.
    const result = findRelatedQuestions("entropy of a black hole", subs);
    expect(result[0]?.id).toBe("a3");
  });

  it("ignores stopwords so grammar alone doesn't create matches", () => {
    // After dropping stopwords, "do we have" shares no topical word with any
    // question, and it isn't a substring of one either.
    expect(findRelatedQuestions("do we have", subs)).toEqual([]);
  });

  it("surfaces a question by a typed prefix even if it's mostly stopwords", () => {
    // Autocomplete feel: "what is the" is a prefix of a3's question.
    expect(findRelatedQuestions("what is the", subs)[0]?.id).toBe("a3");
  });

  it("excludes the currently open submission", () => {
    const result = findRelatedQuestions("entropy", subs, { excludeId: "a1" });
    expect(result.map((s) => s.id)).toEqual(["a3"]);
  });

  it("omits an entry identical to the query", () => {
    const result = findRelatedQuestions("Why is the sky blue?", subs);
    expect(result.map((s) => s.id)).not.toContain("a4");
  });

  it("respects the limit and orders by score", () => {
    const result = findRelatedQuestions("what is entropy", subs, { limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a1");
  });

  it("returns nothing for a too-short query", () => {
    expect(findRelatedQuestions("e", subs)).toEqual([]);
  });

  it("keeps input order as a tie-breaker (recency when sorted newest-first)", () => {
    const tied = [
      { id: "new", question: "capital markets explained" },
      { id: "old", question: "capital markets explained" },
    ];
    const result = findRelatedQuestions("capital markets", tied);
    expect(result.map((s) => s.id)).toEqual(["new", "old"]);
  });
});

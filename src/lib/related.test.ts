import { describe, expect, it } from "vitest";

import { findRelatedQuestions, rankRelatedHybrid } from "@/lib/related";

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

describe("rankRelatedHybrid", () => {
  // Hand-built 3-dim embeddings: axis 0 ≈ "mind/consciousness", axis 1 ≈
  // "markets", axis 2 ≈ noise. Unit length is not required by the ranker.
  const candidates = [
    { id: "mind", question: "What is consciousness?", embedding: [1, 0, 0] },
    {
      id: "markets",
      question: "How do markets allocate capital?",
      embedding: [0, 1, 0],
    },
    {
      id: "no-vector",
      question: "Is consciousness an illusion?",
      embedding: null,
    },
  ];

  it("surfaces a semantic match with zero keyword overlap", () => {
    // "the hard problem of subjective experience" shares no significant word
    // with "What is consciousness?" — only the embedding relates them.
    const result = rankRelatedHybrid(
      "the hard problem of subjective experience",
      [0.95, 0.05, 0.1],
      candidates,
    );
    expect(result.map((c) => c.id)).toEqual(["mind"]);
  });

  it("still ranks keyword matches when a candidate has no embedding", () => {
    const result = rankRelatedHybrid("consciousness", [1, 0, 0], candidates);
    expect(result.map((c) => c.id)).toEqual(["mind", "no-vector"]);
  });

  it("reduces to keyword ranking without a query embedding", () => {
    const result = rankRelatedHybrid("allocate capital", null, candidates);
    expect(result.map((c) => c.id)).toEqual(["markets"]);
  });

  it("filters low-cosine candidates that share no keywords", () => {
    const result = rankRelatedHybrid(
      "completely unrelated topic",
      [0.1, 0.1, 0.99],
      candidates,
    );
    expect(result).toEqual([]);
  });

  it("blends vector and keyword scores rather than using either alone", () => {
    // Both share the keyword "consciousness"; the query embedding leans toward
    // "mind", which must win even though "no-vector" appears first by recency.
    const reordered = [candidates[2], candidates[0], candidates[1]];
    const result = rankRelatedHybrid(
      "consciousness explained",
      [1, 0, 0],
      reordered,
    );
    expect(result[0]?.id).toBe("mind");
  });

  it("excludes the open submission and an identical question", () => {
    const result = rankRelatedHybrid("What is consciousness?", [1, 0, 0], candidates, {
      excludeId: "no-vector",
    });
    expect(result.map((c) => c.id)).not.toContain("mind"); // identical
    expect(result.map((c) => c.id)).not.toContain("no-vector"); // excluded
  });
});

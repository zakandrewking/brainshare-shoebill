import { afterEach, describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  embeddingInput,
  embedQuestions,
  getEmbeddingConfig,
  matchTopics,
  mockEmbedding,
} from "@/lib/embedding";

function cosine(a: number[], b: number[]) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

describe("mockEmbedding", () => {
  it("is deterministic and unit-length", () => {
    const first = mockEmbedding("what is entropy?");
    const second = mockEmbedding("what is entropy?");
    expect(first).toEqual(second);
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(first.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("scores word-sharing questions above unrelated ones", () => {
    const query = mockEmbedding("what is the entropy of a black hole?");
    const related = mockEmbedding("entropy in thermodynamics");
    const unrelated = mockEmbedding("why do markets allocate capital?");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("returns a zero vector for text with no words", () => {
    expect(mockEmbedding("?!").every((v) => v === 0)).toBe(true);
  });
});

describe("embedding config and dispatch", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("uses the deterministic embedder for the mock provider", async () => {
    process.env.AI_PROVIDER = "mock";
    expect(getEmbeddingConfig().provider).toBe("mock");
    const embeddings = await embedQuestions(["what is entropy?"]);
    expect(embeddings).toEqual([mockEmbedding("what is entropy?")]);
  });

  it("disables embeddings without a backend (keyword-only ranking)", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    expect(getEmbeddingConfig().provider).toBeNull();
    expect(await embedQuestions(["anything"])).toBeNull();
  });

  it("identifies stored vectors by a model string with dimensions and input kind", () => {
    process.env.AI_PROVIDER = "mock";
    expect(getEmbeddingConfig().model).toBe(
      `mock/deterministic@${EMBEDDING_DIMENSIONS}+qa`,
    );
  });
});

describe("embeddingInput", () => {
  it("joins the question with the answer text and caps the length", () => {
    expect(embeddingInput("why?", "because.")).toBe("why?\n\nbecause.");
    expect(embeddingInput("q", "x".repeat(5000))).toHaveLength(4000);
  });
});

describe("matchTopics", () => {
  const candidates = [
    {
      id: "kind",
      question: "what is kindness?",
      embedding: mockEmbedding("what is kindness?"),
    },
    {
      id: "markets",
      question: "how do markets allocate capital?",
      embedding: mockEmbedding("how do markets allocate capital?"),
    },
    { id: "no-vector", question: "unembedded", embedding: null },
  ];

  it("links a topic to the most similar question above the threshold", () => {
    const topics = ["kindness"];
    const matches = matchTopics(
      topics,
      topics.map(mockEmbedding),
      candidates,
    );
    expect(matches).toEqual({
      kindness: { id: "kind", question: "what is kindness?" },
    });
  });

  it("omits topics whose best candidate scores under the threshold", () => {
    const topics = ["photosynthesis"];
    const matches = matchTopics(topics, topics.map(mockEmbedding), candidates);
    expect(matches).toEqual({});
  });

  it("skips candidates without embeddings instead of failing", () => {
    const topics = ["unembedded"];
    expect(
      matchTopics(topics, topics.map(mockEmbedding), candidates),
    ).toEqual({});
  });
});

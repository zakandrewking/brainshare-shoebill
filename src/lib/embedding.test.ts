import { afterEach, describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  embedQuestions,
  getEmbeddingConfig,
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

  it("identifies stored vectors by a model string that includes dimensions", () => {
    process.env.AI_PROVIDER = "mock";
    expect(getEmbeddingConfig().model).toBe(
      `mock/deterministic@${EMBEDDING_DIMENSIONS}`,
    );
  });
});

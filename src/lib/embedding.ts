import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";

// Server-side question embeddings for related-question ranking. The corpus is
// tiny and single-user, so vectors live on the answer documents and similarity
// is brute-forced in the API route — no ANN index or vector store needed.

// Trim stored vectors well below the model's native 1536 dims; plenty of
// signal for ranking a personal corpus and keeps documents small.
export const EMBEDDING_DIMENSIONS = 256;

export type EmbeddingConfig = {
  /** `null` when no embedding backend is available (keyword-only ranking). */
  provider: "openai" | "mock" | null;
  /** Stable identity for stored vectors; mismatched vectors are re-embedded. */
  model: string;
};

export function getEmbeddingConfig(): EmbeddingConfig {
  if (process.env.AI_PROVIDER === "mock") {
    return { provider: "mock", model: `mock/deterministic@${EMBEDDING_DIMENSIONS}` };
  }
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    return { provider: "openai", model: `openai/${model}@${EMBEDDING_DIMENSIONS}` };
  }
  return { provider: null, model: "none" };
}

// Deterministic local embedding: hash each word into a few buckets of a fixed
// bag-of-words vector, then L2-normalize. Questions sharing words get a high
// cosine, so the hybrid path is exercisable in dev/tests without an API key.
export function mockEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

  for (const word of words) {
    // FNV-1a, re-seeded per bucket so each word lights up three positions.
    for (let seed = 0; seed < 3; seed += 1) {
      let hash = 0x811c9dc5 ^ seed;
      for (let i = 0; i < word.length; i += 1) {
        hash ^= word.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      vector[(hash >>> 0) % EMBEDDING_DIMENSIONS] += 1;
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/**
 * Embed `texts` with the configured backend, preserving order. Returns `null`
 * when embeddings are disabled. Provider errors propagate; callers degrade to
 * keyword-only ranking.
 */
export async function embedQuestions(
  texts: string[],
): Promise<number[][] | null> {
  const config = getEmbeddingConfig();
  if (config.provider === null) {
    return null;
  }
  if (texts.length === 0) {
    return [];
  }
  if (config.provider === "mock") {
    return texts.map(mockEmbedding);
  }

  const { embeddings } = await embedMany({
    model: openai.textEmbedding(
      process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    ),
    values: texts,
    providerOptions: {
      openai: { dimensions: EMBEDDING_DIMENSIONS },
    },
  });
  return embeddings;
}

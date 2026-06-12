import { openai } from "@ai-sdk/openai";
import { cosineSimilarity, embedMany } from "ai";

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
  // The "+qa" suffix marks vectors of question+answer text (not the bare
  // question); bumping the tag lazily re-embeds everything stored before.
  if (process.env.AI_PROVIDER === "mock") {
    return {
      provider: "mock",
      model: `mock/deterministic@${EMBEDDING_DIMENSIONS}+qa`,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    return {
      provider: "openai",
      model: `openai/${model}@${EMBEDDING_DIMENSIONS}+qa`,
    };
  }
  return { provider: null, model: "none" };
}

/**
 * What gets embedded for an entry: the question plus the answer's text. Bare
 * questions miss links their answers make explicit — live example: "whats it
 * like to be a bat" ↔ "What is consciousness?" scored 0.043 question-to-
 * question while the bat answer explicitly discusses consciousness.
 */
export function embeddingInput(question: string, text: string): string {
  return `${question}\n\n${text}`.slice(0, 4000);
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

// Below this cosine, a [[topic]] is not considered semantically the same
// entry as a question — short topic strings against short questions score
// lower than question-to-question pairs, hence laxer than ranking floors.
export const SEMANTIC_LINK_THRESHOLD = 0.4;

export type SemanticMatch = { id: string; question: string };

/**
 * Match each topic to the most similar candidate question by embedding
 * cosine, keyed by the topic as given. Topics whose best candidate scores
 * under `threshold` are omitted. Pure: embeddings are computed by the caller
 * and `topicEmbeddings[i]` must correspond to `topics[i]`.
 */
export function matchTopics(
  topics: string[],
  topicEmbeddings: number[][],
  candidates: { id: string; question: string; embedding: number[] | null }[],
  threshold = SEMANTIC_LINK_THRESHOLD,
): Record<string, SemanticMatch> {
  const matches: Record<string, SemanticMatch> = {};
  topics.forEach((topic, index) => {
    const topicEmbedding = topicEmbeddings[index];
    if (!topicEmbedding) {
      return;
    }
    let best: { candidate: SemanticMatch; score: number } | null = null;
    for (const candidate of candidates) {
      if (!candidate.embedding) {
        continue;
      }
      const score = cosineSimilarity(topicEmbedding, candidate.embedding);
      if (score >= threshold && (!best || score > best.score)) {
        best = {
          candidate: { id: candidate.id, question: candidate.question },
          score,
        };
      }
    }
    if (best) {
      matches[topic] = best.candidate;
    }
  });
  return matches;
}

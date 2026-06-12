import {
  setQuestionEmbedding,
  type RelatedCandidateDocument,
} from "@/lib/answers";
import { embedQuestions, getEmbeddingConfig } from "@/lib/embedding";

export type EmbeddedCandidate = {
  id: string;
  question: string;
  embedding: number[] | null;
};

/**
 * Embed `queries` — and any candidates missing a current-model vector — in a
 * single batch, persisting backfilled candidate vectors. Returns `null`
 * (callers degrade to keyword-only behavior) when embeddings are disabled or
 * the provider call fails.
 */
export async function embedWithCandidates(
  userId: string,
  queries: string[],
  candidates: RelatedCandidateDocument[],
): Promise<{
  queryEmbeddings: number[][];
  candidates: EmbeddedCandidate[];
} | null> {
  const config = getEmbeddingConfig();
  if (config.provider === null) {
    return null;
  }

  const stale = candidates.filter(
    (candidate) =>
      candidate.embedding === null || candidate.embeddingModel !== config.model,
  );

  try {
    const embeddings = await embedQuestions([
      ...queries,
      ...stale.map((candidate) => candidate.question),
    ]);
    if (!embeddings) {
      return null;
    }

    const queryEmbeddings = embeddings.slice(0, queries.length);
    const backfilled = embeddings.slice(queries.length);
    const refreshed = new Map<string, number[]>();
    stale.forEach((candidate, index) => {
      refreshed.set(candidate.id, backfilled[index]);
    });
    await Promise.all(
      stale.map((candidate, index) =>
        setQuestionEmbedding(
          candidate.id,
          userId,
          backfilled[index],
          config.model,
        ),
      ),
    );

    return {
      queryEmbeddings,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        question: candidate.question,
        embedding: refreshed.get(candidate.id) ?? candidate.embedding,
      })),
    };
  } catch (error) {
    console.error("[semantic] embedding failed; degrading gracefully:", error);
    return null;
  }
}

import type { SerializedAnswer } from "@/lib/types";

// Common words that carry little topical signal; dropped before matching so
// overlap reflects the substance of a question, not its grammar.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "did", "do",
  "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "me", "my", "no", "not", "of", "on", "or", "our", "should",
  "so", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "us", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your",
]);

type RelatedCandidate = Pick<SerializedAnswer, "id" | "question">;

export type HybridCandidate = RelatedCandidate & {
  /** Stored question embedding; null/undefined falls back to keyword-only. */
  embedding?: number[] | null;
};

export type RelatedOptions = {
  /** Max suggestions to return. Defaults to 5. */
  limit?: number;
  /** Submission to omit (e.g. the one currently open). */
  excludeId?: string;
};

// Lowercase, strip punctuation, collapse whitespace — shared by both the
// substring check and tokenization so matching is consistent.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?.!,;:'"“”‘’()[\]{}/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of normalize(text).split(" ")) {
    if (word.length >= 2 && !STOPWORDS.has(word)) {
      tokens.add(word);
    }
  }
  return tokens;
}

// Awarded on top of per-token overlap when the typed query appears verbatim
// inside a past question; also the keyword score's normalization headroom.
const SUBSTRING_BOOST = 5;

// Shared significant words plus a substring boost (see findRelatedQuestions).
function keywordScore(
  queryTokens: Set<string>,
  normalizedQuery: string,
  question: string,
): number {
  let score = 0;
  const questionTokens = tokenize(question);
  for (const token of queryTokens) {
    if (questionTokens.has(token)) {
      score += 1;
    }
  }
  if (normalize(question).includes(normalizedQuery)) {
    score += SUBSTRING_BOOST;
  }
  return score;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/**
 * Rank prior submissions by keyword relatedness to `query` and return the best
 * matches (most relevant first). Pure and deterministic.
 *
 * Scoring favors an autocomplete feel: a submission whose question contains the
 * typed query as a substring gets a large boost, on top of the count of shared
 * significant words. Ties keep input order, so callers that pass submissions
 * newest-first get recency as a natural tie-breaker. Submissions with no
 * overlap (and no substring hit) are excluded.
 */
export function findRelatedQuestions(
  query: string,
  submissions: RelatedCandidate[],
  options: RelatedOptions = {},
): RelatedCandidate[] {
  const { limit = 5, excludeId } = options;
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const queryTokens = tokenize(query);

  const scored = submissions
    .filter((submission) => submission.id !== excludeId)
    .map((submission, index) => {
      // Skip an entry identical to what's typed — there's nothing to surface.
      const score =
        normalize(submission.question) === normalizedQuery
          ? 0
          : keywordScore(queryTokens, normalizedQuery, submission.question);
      return { submission, index, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, limit).map((entry) => entry.submission);
}

// Below this cosine, a candidate with zero keyword overlap is considered
// unrelated noise rather than a semantic match.
const MIN_VECTOR_SCORE = 0.3;

/**
 * Rank candidates by a blend of embedding cosine similarity and the keyword
 * score (vector-weighted, since semantics is what the keyword half misses).
 * Pure: embeddings are computed by the caller. Candidates or queries without
 * an embedding degrade gracefully to their keyword score, and a missing
 * `queryEmbedding` reduces to keyword-only ranking, so the function behaves
 * identically whether or not an embedding backend is configured.
 */
export function rankRelatedHybrid(
  query: string,
  queryEmbedding: number[] | null,
  candidates: HybridCandidate[],
  options: RelatedOptions = {},
): RelatedCandidate[] {
  const { limit = 5, excludeId } = options;
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const queryTokens = tokenize(query);

  const scored = candidates
    .filter((candidate) => candidate.id !== excludeId)
    .map((candidate, index) => {
      if (normalize(candidate.question) === normalizedQuery) {
        return { candidate, index, score: 0 };
      }

      const keyword = keywordScore(queryTokens, normalizedQuery, candidate.question);
      // Normalize to ~[0,1] against the best possible score for this query.
      const keywordNormalized =
        keyword / (queryTokens.size + SUBSTRING_BOOST || 1);

      const similarity =
        queryEmbedding && candidate.embedding
          ? Math.max(0, cosine(queryEmbedding, candidate.embedding))
          : 0;

      const related = keyword > 0 || similarity >= MIN_VECTOR_SCORE;
      const score = related ? 0.6 * similarity + 0.4 * keywordNormalized : 0;
      return { candidate, index, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, limit).map(({ candidate }) => ({
    id: candidate.id,
    question: candidate.question,
  }));
}

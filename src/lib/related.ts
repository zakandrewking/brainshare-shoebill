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
      const normalizedQuestion = normalize(submission.question);
      // Skip an entry identical to what's typed — there's nothing to surface.
      if (normalizedQuestion === normalizedQuery) {
        return { submission, index, score: 0 };
      }

      let score = 0;
      const questionTokens = tokenize(submission.question);
      for (const token of queryTokens) {
        if (questionTokens.has(token)) {
          score += 1;
        }
      }
      // Prefix/substring boost: typing the start of a past question surfaces it.
      if (normalizedQuestion.includes(normalizedQuery)) {
        score += 5;
      }

      return { submission, index, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, limit).map((entry) => entry.submission);
}

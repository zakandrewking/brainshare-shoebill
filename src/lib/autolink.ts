// Automatic cross-references between EXISTING articles.
//
// The old system relied on the model emitting [[topic]] tokens and offered to
// create an entry for any topic that didn't exist. We no longer invent links to
// non-existent articles. Instead we discover links from an article's prose to
// OTHER articles that already exist, using database context: each existing
// article contributes "anchor" phrases (derived from its title/question), and a
// phrase in the source text becomes a link only when (a) it matches an existing
// article's anchor AND (b) the two articles are semantically related (embedding
// cosine, computed server-side). Keyword matching alone is not enough — "kind"
// should link to "Should I be kind to strangers?" only when the surrounding
// article is actually about that, which is exactly what the similarity gate
// encodes.
//
// TUNING: everything adjustable lives in AutoLinkConfig / DEFAULT_AUTOLINK_CONFIG
// below. When a link is wrong or missing, adjust a weight/threshold or the
// stopword list here — findAutoLinks attaches `signals` to every link so you can
// see WHY it scored the way it did (set localStorage.autolinkDebug = "1" in the
// browser to console.table them).

// Words that never carry topical signal as an anchor. Superset of the related.ts
// stopwords plus common verbs/adjectives/fillers that would otherwise produce
// junk anchors from a title (e.g. "like" from "what's it like to be a bat").
const ANCHOR_STOPWORDS = new Set([
  // grammar / function words
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "its", "may", "me", "might",
  "must", "my", "no", "not", "of", "on", "one", "or", "our", "shall", "should",
  "so", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "to", "us", "was", "we", "were", "what", "whats", "when",
  "where", "which", "while", "who", "whom", "whose", "why", "will", "with",
  "would", "you", "your",
  // common non-topical content words
  "about", "actually", "also", "any", "because", "really", "just", "like",
  "get", "gets", "got", "make", "makes", "made", "want", "wants", "need",
  "needs", "know", "think", "thinks", "thing", "things", "time", "way", "ways",
  "lot", "feel", "feels", "felt", "much", "more", "most", "some", "such",
  "very", "even", "ever", "every", "still", "good", "bad", "better", "best",
]);

export type AutoLinkConfig = {
  /** Anchors shorter than this (in characters) are ignored. */
  minAnchorChars: number;
  /** A candidate must be at least this similar (cosine) to link at all. */
  similarityFloor: number;
  /** Minimum combined score to emit a link. */
  scoreThreshold: number;
  /** Weight on lexical specificity (how distinctive the matched phrase is). */
  lexicalWeight: number;
  /** Weight on the source↔target embedding similarity (the database context). */
  similarityWeight: number;
  /** At most this many links to any single target article (link first mention). */
  maxLinksPerTarget: number;
  /** Hard cap on links emitted for one article. */
  maxLinksTotal: number;
};

export const DEFAULT_AUTOLINK_CONFIG: AutoLinkConfig = {
  minAnchorChars: 3,
  similarityFloor: 0.2,
  scoreThreshold: 0.35,
  lexicalWeight: 0.5,
  similarityWeight: 0.5,
  maxLinksPerTarget: 1,
  maxLinksTotal: 8,
};

export type AutoLinkCandidate = {
  id: string;
  /** The article's title/question; anchors are derived from it. */
  question: string;
  /** Cosine similarity of this candidate to the source article (0..1). */
  similarity: number;
};

export type AutoLinkRange = {
  start: number;
  end: number;
  /** The matched phrase as it appears in the source text. */
  target: string;
  targetId: string;
  score: number;
  signals: {
    anchor: string;
    lexical: number;
    similarity: number;
  };
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?.!,;:'"“”‘’()[\]{}/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anchor phrases for a target article, derived from its title/question:
 * the full run of significant (non-stopword) tokens as one phrase, plus each
 * significant token on its own. Longer phrases are more specific and outrank
 * single words at scoring time. Deduped, order preserved (phrase first).
 */
export function deriveAnchors(
  question: string,
  config: AutoLinkConfig = DEFAULT_AUTOLINK_CONFIG,
): string[] {
  const tokens = normalize(question)
    .split(" ")
    .filter((token) => token.length > 0);
  const significant = tokens.filter(
    (token) =>
      token.length >= config.minAnchorChars && !ANCHOR_STOPWORDS.has(token),
  );
  if (significant.length === 0) {
    return [];
  }
  const anchors: string[] = [];
  const phrase = significant.join(" ");
  if (significant.length > 1) {
    anchors.push(phrase);
  }
  for (const token of significant) {
    if (!anchors.includes(token)) {
      anchors.push(token);
    }
  }
  return anchors;
}

// How distinctive a phrase is: longer strings and multi-word phrases are much
// less likely to be coincidental than a single short word.
function lexicalSpecificity(anchor: string): number {
  const words = anchor.split(" ").length;
  return Math.min(1, anchor.length / 16 + 0.25 * (words - 1));
}

// Regions of the text where a match must NOT start: inside an existing
// [[wikilink]] or a [label](target) markdown link, so we never double-link.
function forbiddenRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const patterns = [/\[\[[^\]]*\]\]/g, /\[[^\]]*\]\([^)]*\)/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function overlaps(
  start: number,
  end: number,
  ranges: [number, number][],
): boolean {
  return ranges.some(([from, to]) => start < to && end > from);
}

// Whole-word, case-insensitive occurrences of `anchor` in `text`. A "word"
// boundary here means not flanked by a letter or digit, so "bat" matches in
// "a bat flew" but not in "debate" or "batch".
function findOccurrences(text: string, anchor: string): [number, number][] {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const out: [number, number][] = [];
  for (const match of text.matchAll(pattern)) {
    out.push([match.index, match.index + match[0].length]);
  }
  return out;
}

/**
 * Discover automatic cross-reference links from `text` to existing articles.
 * Pure and synchronous so the editor can recompute on every keystroke; the
 * database context (which articles exist, their titles, and their similarity to
 * the source) is supplied by the caller via `candidates`.
 */
export function findAutoLinks(
  text: string,
  candidates: AutoLinkCandidate[],
  config: AutoLinkConfig = DEFAULT_AUTOLINK_CONFIG,
): AutoLinkRange[] {
  if (!text || candidates.length === 0) {
    return [];
  }
  const forbidden = forbiddenRanges(text);

  // Gather every scoring occurrence across all candidates/anchors.
  const found: AutoLinkRange[] = [];
  for (const candidate of candidates) {
    if (candidate.similarity < config.similarityFloor) {
      continue;
    }
    for (const anchor of deriveAnchors(candidate.question, config)) {
      const lexical = lexicalSpecificity(anchor);
      const score =
        config.lexicalWeight * lexical +
        config.similarityWeight * candidate.similarity;
      if (score < config.scoreThreshold) {
        continue;
      }
      for (const [start, end] of findOccurrences(text, anchor)) {
        if (overlaps(start, end, forbidden)) {
          continue;
        }
        found.push({
          start,
          end,
          target: text.slice(start, end),
          targetId: candidate.id,
          score,
          signals: { anchor, lexical, similarity: candidate.similarity },
        });
      }
    }
  }

  // Resolve conflicts: highest score wins; for ties prefer the longer span.
  // Greedily accept non-overlapping links, capped per target and overall.
  found.sort(
    (a, b) => b.score - a.score || b.end - b.start - (a.end - a.start),
  );
  const accepted: AutoLinkRange[] = [];
  const perTarget = new Map<string, number>();
  for (const link of found) {
    if (accepted.length >= config.maxLinksTotal) {
      break;
    }
    if ((perTarget.get(link.targetId) ?? 0) >= config.maxLinksPerTarget) {
      continue;
    }
    if (
      accepted.some(
        (other) => link.start < other.end && link.end > other.start,
      )
    ) {
      continue;
    }
    accepted.push(link);
    perTarget.set(link.targetId, (perTarget.get(link.targetId) ?? 0) + 1);
  }

  // Return in document order so decorations/chips read top-to-bottom.
  return accepted.sort((a, b) => a.start - b.start);
}

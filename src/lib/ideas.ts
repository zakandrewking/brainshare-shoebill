// Idea-based cross-linking.
//
// The old system (lib/autolink) linked articles by WORDS: it derived anchor
// phrases from a target's title and lit up any literal occurrence in the source
// text, gated by a loose embedding floor. That links on vocabulary, not meaning
// — the bare word "life" would link to "a life worth living" even when the
// surrounding article is about something else entirely.
//
// Idea-linking instead asks a model to read the article and a shortlist of other
// entries and weave in a cross-link ONLY where the article genuinely engages an
// idea or claim that another entry is about — rephrasing the prose lightly so the
// link reads naturally. The shortlist is narrowed first by embedding recall (this
// module's pure helpers); the model supplies the idea-level precision. Links are
// emitted as `[[Exact Title|anchor]]` tokens that the existing crosslink renderer
// (lib/crosslinks) already resolves, so nothing downstream changes.
//
// Everything in this file is pure and unit-tested. The model call and persistence
// live in lib/generation.

import { cosineSimilarity } from "ai";

import { normalizeTopic } from "@/lib/crosslinks";

export type RelinkConfig = {
  /** A candidate must be at least this cosine-similar to be offered to the model. */
  candidateFloor: number;
  /** At most this many candidate entries are shown to the model. */
  topK: number;
  /** Hard cap on links kept in one article (extras are flattened to plain text). */
  maxLinks: number;
  /** Characters of each candidate's text shown to the model as context. */
  snippetChars: number;
};

export const DEFAULT_RELINK_CONFIG: RelinkConfig = {
  // Recall is deliberately generous — the model, not the embedding, decides
  // whether a genuine idea connection exists, so we would rather over-offer
  // candidates than silently hide a real link behind a tight floor.
  candidateFloor: 0.12,
  topK: 6,
  maxLinks: 5,
  snippetChars: 600,
};

export type RelinkCandidate = {
  id: string;
  /** The entry's title/question; used verbatim as the link target. */
  question: string;
  /** The entry's AI baseline text; a snippet is shown to the model. */
  text: string;
  /** Cosine similarity to the source article (0..1), filled by selection. */
  embedding: number[] | null;
};

export type RankedCandidate = {
  id: string;
  question: string;
  text: string;
  similarity: number;
};

/**
 * Narrow the corpus to the entries worth offering the model as link targets:
 * other entries (self excluded) whose embedding is at least `candidateFloor`
 * similar to the source, highest first, capped at `topK`. Pure: embeddings are
 * supplied by the caller.
 */
export function selectRelinkCandidates(
  selfEmbedding: number[] | null,
  candidates: RelinkCandidate[],
  selfId: string,
  config: RelinkConfig = DEFAULT_RELINK_CONFIG,
): RankedCandidate[] {
  if (!selfEmbedding) {
    return [];
  }
  const ranked: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.id === selfId || !candidate.embedding) {
      continue;
    }
    if (!candidate.question.trim() || !candidate.text.trim()) {
      continue;
    }
    const similarity = Math.max(
      0,
      cosineSimilarity(selfEmbedding, candidate.embedding),
    );
    if (similarity < config.candidateFloor) {
      continue;
    }
    ranked.push({
      id: candidate.id,
      question: candidate.question,
      text: candidate.text,
      similarity,
    });
  }
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, config.topK);
}

// First sentence-ish / leading snippet of a candidate's text, with any existing
// link/citation markup and the References block stripped so the model sees the
// idea, not the formatting.
function snippet(text: string, max: number): string {
  const body = text
    .split(/\n+References:\s*/i)[0]
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) =>
      String(label ?? target),
    )
    .replace(/\s+/g, " ")
    .trim();
  return body.length <= max ? body : `${body.slice(0, max).trim()}…`;
}

/**
 * Build the instruction shown to the model: the entry to relink (with user
 * passages already replaced by `{{n}}` placeholders) and the candidate entries
 * it MAY link to. The model returns the full entry text with warranted
 * `[[Exact Title|anchor]]` links woven in.
 */
export function buildRelinkPrompt(
  question: string,
  placeholderText: string,
  candidates: RankedCandidate[],
  config: RelinkConfig = DEFAULT_RELINK_CONFIG,
  hasPassages = false,
): string {
  const list = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. "${candidate.question}"\n   ${snippet(candidate.text, config.snippetChars)}`,
    )
    .join("\n\n");

  const passageRule = hasPassages
    ? `\n\nThis entry contains the author's own passages, shown as placeholder tokens like {{1}}. Keep every placeholder exactly once, in place — never quote, rewrite, or remove the passage text it stands for. You may add links and rephrase the prose AROUND the placeholders, but not the placeholders themselves.`
    : "";

  return `You are weaving idea-based cross-links into an existing encyclopedia-style entry.

The entry's title is: "${question}"

Its current text:
"""
${placeholderText}
"""

Below are OTHER existing entries you may link to. Add a link to one ONLY when this entry genuinely engages an idea, claim, or question that the other entry is fundamentally about. A shared word or surface topic is NOT enough — for example, the mere word "life" must NOT link to an entry about "a life worth living", but a sentence noting that consciousness is hard to define SHOULD link to an entry about the definitions of consciousness. When in doubt, do not link. It is perfectly fine to add no links at all.

Candidate entries:
${list}

To add a link, wrap the words in this entry that express the shared idea in a wiki-link: [[Exact Entry Title|the anchor words]] — the part before the | MUST be the candidate entry's title copied exactly so it resolves, and the part after the | is the existing anchor words from your prose. You may lightly rephrase the surrounding sentence so the connection is explicit and the link reads naturally, but do not change the entry's meaning, voice, citations, or its 'References:' section. Link any single entry at most once, and add at most ${config.maxLinks} links total.${passageRule}

Output ONLY the full rewritten entry text, nothing else.`;
}

// Build a normalized-title → exact-title resolver mirroring lib/crosslinks'
// matching rules (exact normalized match, then loose containment for strings
// long enough not to false-positive), so a kept link resolves the same way the
// renderer will resolve it.
function titleResolver(questions: string[]): (raw: string) => string | null {
  const entries = questions
    .map((question) => ({ question, key: normalizeTopic(question) }))
    .filter((entry) => entry.key.length > 0);
  return (raw: string) => {
    const key = normalizeTopic(raw);
    if (!key) return null;
    const exact = entries.find((entry) => entry.key === key);
    if (exact) return exact.question;
    if (key.length >= 4) {
      const loose = entries.find(
        (entry) =>
          entry.key.includes(key) ||
          (entry.key.length >= 4 && key.includes(entry.key)),
      );
      if (loose) return loose.question;
    }
    return null;
  };
}

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Make a model's relinked text safe to store: keep only `[[target|label]]`
 * tokens whose target resolves to one of `validQuestions` (rewriting the target
 * to that entry's exact title for clean resolution), flatten every other
 * `[[...]]` to its plain label, drop self-links, dedupe so each entry is linked
 * at most once, and cap the total at `maxLinks`. Guarantees the stored prose
 * never carries a dangling or duplicate wiki-link. Pure and deterministic.
 */
export function sanitizeLinks(
  text: string,
  validQuestions: string[],
  options: { maxLinks?: number; selfQuestion?: string } = {},
): string {
  if (!text.includes("[[")) {
    return text;
  }
  const maxLinks = options.maxLinks ?? DEFAULT_RELINK_CONFIG.maxLinks;
  const selfKey = options.selfQuestion
    ? normalizeTopic(options.selfQuestion)
    : null;
  const resolve = titleResolver(validQuestions);
  const linkedKeys = new Set<string>();
  let kept = 0;

  return text.replace(WIKILINK, (_match, rawTarget, rawLabel) => {
    const label = String(rawLabel ?? rawTarget).trim();
    const canonical = resolve(String(rawTarget));
    if (!canonical) {
      return label;
    }
    const key = normalizeTopic(canonical);
    if (selfKey && key === selfKey) {
      return label; // never link an entry to itself
    }
    if (linkedKeys.has(key) || kept >= maxLinks) {
      return label; // dedupe + cap; extras become plain text
    }
    linkedKeys.add(key);
    kept += 1;
    return `[[${canonical}|${label}]]`;
  });
}

/** Count the resolving wiki-links in a piece of text (post-sanitize). */
export function countLinks(text: string): number {
  return [...text.matchAll(WIKILINK)].length;
}

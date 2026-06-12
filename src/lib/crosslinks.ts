import type { SerializedAnswer } from "@/lib/types";

// Wiki-style links the model is asked to emit: [[Topic]] or [[Topic|Display]].
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Normalize a topic or question for loose matching: lowercase, drop punctuation
// (so "What is entropy?" can match [[entropy]]), and collapse whitespace.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?.!,;:'"“”‘’()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type LinkTarget = Pick<SerializedAnswer, "id" | "question">;

type LinkCandidate = { id: string; key: string };

function linkCandidates(
  submissions: LinkTarget[],
  excludeId?: string,
): LinkCandidate[] {
  return submissions
    .filter((submission) => submission.id !== excludeId)
    .map((submission) => ({ id: submission.id, key: normalize(submission.question) }))
    .filter((candidate) => candidate.key.length > 0);
}

// Exact normalized match first, then a loose containment match either way for
// targets long enough not to false-positive. First submission in list order wins.
function resolveTarget(
  rawTarget: string,
  candidates: LinkCandidate[],
): LinkCandidate | undefined {
  const targetKey = normalize(rawTarget);
  if (!targetKey) {
    return undefined;
  }
  return (
    candidates.find((candidate) => candidate.key === targetKey) ??
    (targetKey.length >= 4
      ? candidates.find(
          (candidate) =>
            candidate.key.includes(targetKey) ||
            (candidate.key.length >= 4 && targetKey.includes(candidate.key)),
        )
      : undefined)
  );
}

/**
 * Rewrite `[[Topic]]` wiki-links in `markdown` into Markdown links to an
 * existing submission (`[Label](?a=<id>)`) when the topic matches one, and to
 * plain text otherwise — so raw `[[...]]` never reaches the reader. Pure and
 * deterministic; the first matching submission (in list order) wins.
 */
export function resolveCrosslinks(
  markdown: string,
  submissions: LinkTarget[],
  options: { excludeId?: string } = {},
): string {
  if (!markdown) {
    return markdown;
  }

  const candidates = linkCandidates(submissions, options.excludeId);

  return markdown.replace(WIKILINK, (_match, rawTarget, rawLabel) => {
    const label = String(rawLabel ?? rawTarget).trim();
    const match = resolveTarget(String(rawTarget), candidates);
    return match ? `[${label}](?a=${encodeURIComponent(match.id)})` : label;
  });
}

// Normalized topic key for semantic-resolution maps; clients and tests must
// key lookups exactly as findCrosslinkRanges does.
export function normalizeTopic(topic: string): string {
  return normalize(topic);
}

/**
 * Turn an unresolved [[topic]] into a question to prefill the ask box with,
 * so a missing entry is one ⌘-click away from being generated.
 */
export function suggestQuestionForTopic(topic: string): string {
  const trimmed = topic.trim();
  if (!trimmed) {
    return "";
  }
  // The model occasionally emits a full question as the topic; keep it.
  if (trimmed.endsWith("?")) {
    return trimmed;
  }
  return `What is ${trimmed}?`;
}

export type CrosslinkRange = {
  /** Character offsets of the whole `[[...]]` token in the raw text. */
  start: number;
  end: number;
  /** The raw topic text inside the brackets (before any `|label`). */
  target: string;
  /** Whether the topic resolves to an existing submission. */
  resolved: boolean;
  /** The submission the topic resolves to, when it does. */
  targetId?: string;
};

/**
 * Locate `[[Topic]]` tokens in raw (unrendered) text and report whether each
 * resolves against `submissions` — same matching rules as `resolveCrosslinks`,
 * plus an optional `semantic` map (normalized topic → submission id, from
 * `/api/crosslinks`) consulted when lexical matching fails. Pure and
 * synchronous so the editor can decorate links live on every keystroke.
 */
export function findCrosslinkRanges(
  text: string,
  submissions: LinkTarget[],
  options: { excludeId?: string; semantic?: Record<string, string> } = {},
): CrosslinkRange[] {
  if (!text.includes("[[")) {
    return [];
  }

  const candidates = linkCandidates(submissions, options.excludeId);
  const ranges: CrosslinkRange[] = [];
  for (const match of text.matchAll(WIKILINK)) {
    const rawTarget = match[1].trim();
    const lexical = resolveTarget(match[1], candidates);
    const targetId =
      lexical?.id ?? options.semantic?.[normalizeTopic(rawTarget)];
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      target: rawTarget,
      resolved: targetId !== undefined,
      ...(targetId ? { targetId } : {}),
    });
  }
  return ranges;
}


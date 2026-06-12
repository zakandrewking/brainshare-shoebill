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

export type CrosslinkRange = {
  /** Character offsets of the whole `[[...]]` token in the raw text. */
  start: number;
  end: number;
  /** Whether the topic resolves to an existing submission. */
  resolved: boolean;
  /** The submission the topic resolves to, when it does. */
  targetId?: string;
};

/**
 * Locate `[[Topic]]` tokens in raw (unrendered) text and report whether each
 * resolves against `submissions` — same matching rules as `resolveCrosslinks`.
 * Pure and synchronous so the editor can decorate links live on every
 * keystroke.
 */
export function findCrosslinkRanges(
  text: string,
  submissions: LinkTarget[],
  options: { excludeId?: string } = {},
): CrosslinkRange[] {
  if (!text.includes("[[")) {
    return [];
  }

  const candidates = linkCandidates(submissions, options.excludeId);
  const ranges: CrosslinkRange[] = [];
  for (const match of text.matchAll(WIKILINK)) {
    const target = resolveTarget(match[1], candidates);
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      resolved: target !== undefined,
      ...(target ? { targetId: target.id } : {}),
    });
  }
  return ranges;
}


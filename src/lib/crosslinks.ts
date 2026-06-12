import type { SerializedAnswer } from "@/lib/types";

// Wiki-style links the model is asked to emit: [[Topic]] or [[Topic|Display]].
export const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

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

/**
 * Resolve a `[[Topic]]` target to the id of an existing submission whose
 * question matches it (normalized exact match first, then a loose
 * substring/prefix match), excluding `excludeId`. Returns null when nothing
 * matches. Pure and deterministic; the first matching submission (in list
 * order) wins. Shared by the rendered rewrite and the live editor so both
 * resolve crosslinks identically.
 */
export function matchCrosslinkTarget(
  rawTarget: string,
  submissions: LinkTarget[],
  options: { excludeId?: string } = {},
): string | null {
  const targetKey = normalize(rawTarget);
  if (!targetKey) {
    return null;
  }

  const candidates = submissions
    .filter((submission) => submission.id !== options.excludeId)
    .map((submission) => ({
      id: submission.id,
      key: normalize(submission.question),
    }))
    .filter((candidate) => candidate.key.length > 0);

  const match =
    candidates.find((candidate) => candidate.key === targetKey) ??
    (targetKey.length >= 4
      ? candidates.find(
          (candidate) =>
            candidate.key.includes(targetKey) ||
            (candidate.key.length >= 4 && targetKey.includes(candidate.key)),
        )
      : undefined);

  return match ? match.id : null;
}

/**
 * Rewrite `[[Topic]]` wiki-links in `markdown` into Markdown links to an
 * existing submission (`[Label](?a=<id>)`) when the topic matches one, and to
 * plain text otherwise — so raw `[[...]]` never reaches the reader.
 */
export function resolveCrosslinks(
  markdown: string,
  submissions: LinkTarget[],
  options: { excludeId?: string } = {},
): string {
  if (!markdown) {
    return markdown;
  }

  return markdown.replace(WIKILINK, (_match, rawTarget, rawLabel) => {
    const label = String(rawLabel ?? rawTarget).trim();
    const id = matchCrosslinkTarget(rawTarget, submissions, options);
    if (!id) {
      return label;
    }

    return `[${label}](?a=${encodeURIComponent(id)})`;
  });
}

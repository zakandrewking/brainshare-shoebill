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

  const candidates = submissions
    .filter((submission) => submission.id !== options.excludeId)
    .map((submission) => ({ id: submission.id, key: normalize(submission.question) }))
    .filter((candidate) => candidate.key.length > 0);

  return markdown.replace(WIKILINK, (_match, rawTarget, rawLabel) => {
    const label = String(rawLabel ?? rawTarget).trim();
    const targetKey = normalize(rawTarget);
    if (!targetKey) {
      return label;
    }

    const match =
      candidates.find((candidate) => candidate.key === targetKey) ??
      (targetKey.length >= 4
        ? candidates.find(
            (candidate) =>
              candidate.key.includes(targetKey) ||
              (candidate.key.length >= 4 && targetKey.includes(candidate.key)),
          )
        : undefined);

    if (!match) {
      return label;
    }

    return `[${label}](?a=${encodeURIComponent(match.id)})`;
  });
}

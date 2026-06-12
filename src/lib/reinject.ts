import type { AttributionSegment } from "@/lib/attribution";

// Regeneration that respects the author: their passages are sent to the model
// as numbered placeholders ({{1}}, {{2}}, …) that the model positions but must
// never echo. The exact passages are then woven back into the current text —
// NOT the AI baseline — so the attribution diff marks them as the user's
// again. (If the model copied the words into the baseline, the diff would
// claim them as AI text.)

const MARKER = /\{\{(\d+)\}\}/;
const MARKER_SPLIT = /(\{\{\d+\}\})/;

/**
 * The user-authored passages worth carrying through a regeneration: trimmed
 * user segments of at least 3 characters (a 1–2 character edit, e.g. a
 * pluralization, has no meaningful standalone placement), capped at 20 so the
 * prompt stays bounded.
 */
export function extractUserPassages(segments: AttributionSegment[]): string[] {
  return segments
    .filter((segment) => segment.source === "user")
    .map((segment) => segment.text.trim())
    .filter((text) => text.length >= 3)
    .slice(0, 20);
}

/**
 * Replace the model's `{{n}}` placeholders with the user's exact passages.
 *
 * Returns `aiText` (markers stripped — the stored baseline must not contain
 * the user's words) and `currentText` (markers substituted). Cases handled:
 * each marker substitutes at most once (repeats are stripped); markers beyond
 * the passage list are stripped; passages the model never placed are appended
 * at the end so nothing the user wrote is ever lost. A single token walk —
 * substituted passage text is never re-scanned, so passages containing
 * marker-like syntax cannot trigger double substitution.
 */
export function weaveUserText(
  raw: string,
  passages: string[],
): { aiText: string; currentText: string } {
  let aiText = "";
  let currentText = "";
  const used = new Set<number>();

  for (const token of raw.split(MARKER_SPLIT)) {
    const match = token.match(MARKER);
    if (match && token === match[0]) {
      const index = Number.parseInt(match[1], 10) - 1;
      if (index >= 0 && index < passages.length && !used.has(index)) {
        currentText += passages[index];
        used.add(index);
      }
      // Markers never reach the AI baseline; repeats/unknowns vanish.
      continue;
    }
    aiText += token;
    currentText += token;
  }

  const missing = passages.filter((_, index) => !used.has(index));
  if (missing.length > 0) {
    currentText = `${currentText.trimEnd()}\n\n${missing.join("\n\n")}`;
  }

  return { aiText, currentText };
}

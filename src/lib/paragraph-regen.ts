// Two-pass, paragraph-aware regeneration.
//
// Pass 1: fully regenerate every paragraph the user did NOT meaningfully edit,
// while retaining (verbatim) every paragraph that carries a real user edit.
// Pass 2: revisit the retained, user-edited paragraphs and regenerate the AI
// prose AROUND the user's exact words (the weave from lib/reinject), so they
// integrate with the freshly written surroundings.
//
// "Meaningful" excludes minor edits — fixed punctuation, capitalization, or
// added whitespace — so a typo fix never freezes a whole paragraph. That test
// is `normalizeParagraph(current) === normalizeParagraph(aiSource)`: equal after
// lowercasing and stripping punctuation/whitespace ⇒ minor ⇒ regenerate it.
//
// The model is asked to return regenerated paragraphs delimited by a marker so
// assembly is deterministic (we never trust it to reproduce kept text). Any
// parse/count mismatch makes the caller fall back to a plain whole-answer
// regenerate, so this can only ever improve on — never break — regeneration.

import { attributeText } from "@/lib/attribution";
import { extractUserPassages, weaveUserText } from "@/lib/reinject";

const PARAGRAPH_SPLIT = /\n\s*\n/;

/** Line the model must place between regenerated paragraphs. */
export const SECTION_DELIMITER = "@@@---@@@";

export function splitParagraphs(text: string): string[] {
  return text
    .split(PARAGRAPH_SPLIT)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

// Lowercase, drop punctuation, collapse whitespace — so case/punctuation/space
// edits normalize to equality with the AI baseline paragraph.
export function normalizeParagraph(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeParagraph(text).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

// A current paragraph matches the AI paragraph it most overlaps with, if that
// overlap clears this floor; otherwise it's treated as brand-new user content.
const MATCH_FLOOR = 0.4;

export type PlannedParagraph = {
  /** The current paragraph text (what the user sees now). */
  text: string;
  /** The AI baseline paragraph it derives from, or null when brand-new. */
  aiSource: string | null;
  /** Has a meaningful (non-minor) user edit, or is brand-new. */
  edited: boolean;
};

/**
 * Align each current paragraph to its AI-baseline origin and classify whether
 * it carries a meaningful user edit. Pure and deterministic.
 */
export function planParagraphs(
  aiText: string,
  currentText: string,
): PlannedParagraph[] {
  const aiParagraphs = splitParagraphs(aiText);
  const aiTokens = aiParagraphs.map(tokenSet);
  const usedAi = new Set<number>();

  return splitParagraphs(currentText).map((paragraph) => {
    const tokens = tokenSet(paragraph);
    let bestIndex = -1;
    let bestScore = 0;
    aiParagraphs.forEach((_, index) => {
      if (usedAi.has(index)) return;
      const score = jaccard(tokens, aiTokens[index]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    const aiSource =
      bestIndex >= 0 && bestScore >= MATCH_FLOOR ? aiParagraphs[bestIndex] : null;
    if (aiSource !== null) {
      usedAi.add(bestIndex);
    }
    const edited =
      aiSource === null ||
      normalizeParagraph(paragraph) !== normalizeParagraph(aiSource);
    return { text: paragraph, aiSource, edited };
  });
}

/**
 * The user's meaningful passages within an edited paragraph: the user-authored
 * segments of the diff against its AI source (≥3 chars, see extractUserPassages,
 * which drops the punctuation/case noise). A brand-new paragraph (no aiSource)
 * is entirely the user's, so the whole paragraph is the single passage.
 */
export function paragraphUserPassages(planned: PlannedParagraph): string[] {
  if (planned.aiSource === null) {
    return [planned.text.trim()].filter((text) => text.length > 0);
  }
  return extractUserPassages(attributeText(planned.aiSource, planned.text));
}

// Split a model response into its delimited sections. Returns null when the
// count doesn't match what we asked for, so the caller can fall back safely.
export function parseSections(
  output: string,
  expected: number,
): string[] | null {
  if (expected === 0) return [];
  const sections = output
    .split(SECTION_DELIMITER)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
  return sections.length === expected ? sections : null;
}

/** Indices (into the plan) of the paragraphs that need AI regeneration. */
export function nonEditedIndices(plan: PlannedParagraph[]): number[] {
  return plan.flatMap((paragraph, index) => (paragraph.edited ? [] : [index]));
}

export function editedIndices(plan: PlannedParagraph[]): number[] {
  return plan.flatMap((paragraph, index) => (paragraph.edited ? [index] : []));
}

/**
 * Assemble the final answer from the plan plus the model's pass outputs.
 *
 * - `rewrites` maps a plan index → freshly regenerated paragraph (pass 1).
 * - `wovenEdited` maps a plan index → the pass-2 weave for an edited paragraph
 *   ({ aiText: baseline with the user's words removed, currentText: with them }).
 *   Edited paragraphs without an entry fall back to their retained text.
 *
 * Returns the joined `aiText` (baseline) and `currentText` (user-credited) so
 * attribution recomputes correctly. Brand-new user paragraphs are omitted from
 * `aiText`, so the diff credits them to the user.
 */
export function assembleAnswer(
  plan: PlannedParagraph[],
  rewrites: Map<number, string>,
  wovenEdited: Map<number, { aiText: string; currentText: string }>,
): { aiText: string; currentText: string } {
  const aiParts: string[] = [];
  const currentParts: string[] = [];

  plan.forEach((paragraph, index) => {
    if (!paragraph.edited) {
      const rewrite = rewrites.get(index) ?? paragraph.text;
      aiParts.push(rewrite);
      currentParts.push(rewrite);
      return;
    }
    const woven = wovenEdited.get(index);
    if (woven) {
      if (woven.aiText.trim().length > 0) aiParts.push(woven.aiText.trim());
      currentParts.push(woven.currentText.trim());
      return;
    }
    // No pass-2 weave: retain the user's paragraph verbatim. Keep it out of the
    // baseline (when brand-new) so it's credited to the user.
    if (paragraph.aiSource !== null) aiParts.push(paragraph.aiSource);
    currentParts.push(paragraph.text);
  });

  return {
    aiText: aiParts.join("\n\n"),
    currentText: currentParts.join("\n\n"),
  };
}

// Re-exported so the orchestration layer weaves with the same implementation
// the tests exercise here.
export { weaveUserText };

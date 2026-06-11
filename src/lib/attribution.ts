import DiffMatchPatch from "diff-match-patch";

export type AttributionSource = "ai" | "user";

export type AttributionSegment = {
  source: AttributionSource;
  text: string;
};

const dmp = new DiffMatchPatch();

export function attributeText(
  aiText: string,
  currentText: string,
): AttributionSegment[] {
  const diffs = dmp.diff_main(aiText, currentText);
  dmp.diff_cleanupSemantic(diffs);

  return diffs
    .filter(([operation]) => operation !== DiffMatchPatch.DIFF_DELETE)
    .map(([operation, text]) => ({
      source:
        operation === DiffMatchPatch.DIFF_EQUAL
          ? ("ai" as const)
          : ("user" as const),
      text,
    }))
    .filter((segment) => segment.text.length > 0)
    .reduce<AttributionSegment[]>((segments, segment) => {
      const previous = segments.at(-1);

      if (previous?.source === segment.source) {
        previous.text += segment.text;
      } else {
        segments.push({ ...segment });
      }

      return segments;
    }, []);
}

export function attributionCounts(segments: AttributionSegment[]) {
  return segments.reduce(
    (counts, segment) => {
      counts[segment.source] += segment.text.length;
      return counts;
    },
    { ai: 0, user: 0 },
  );
}

import { describe, expect, it } from "vitest";

import {
  assembleAnswer,
  editedIndices,
  nonEditedIndices,
  normalizeParagraph,
  paragraphUserPassages,
  parseSections,
  planParagraphs,
  SECTION_DELIMITER,
  splitParagraphs,
} from "@/lib/paragraph-regen";

describe("splitParagraphs", () => {
  it("splits on blank lines and trims", () => {
    expect(splitParagraphs("one\n\n  two  \n\n\nthree")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});

describe("normalizeParagraph", () => {
  it("ignores case, punctuation, and whitespace", () => {
    expect(normalizeParagraph("The cat, sat!")).toBe(
      normalizeParagraph("the   cat sat"),
    );
  });
});

describe("planParagraphs", () => {
  const ai = "The first paragraph about cats.\n\nThe second about dogs.";

  it("treats a minor (punctuation/case) edit as not meaningful", () => {
    const current = "the first paragraph about cats\n\nThe second about dogs.";
    const plan = planParagraphs(ai, current);
    expect(plan.map((p) => p.edited)).toEqual([false, false]);
  });

  it("flags a paragraph with a real word change as edited", () => {
    const current =
      "The first paragraph about cats and their grace.\n\nThe second about dogs.";
    const plan = planParagraphs(ai, current);
    expect(plan[0].edited).toBe(true);
    expect(plan[1].edited).toBe(false);
    expect(plan[0].aiSource).toBe("The first paragraph about cats.");
  });

  it("flags a brand-new paragraph as edited with no aiSource", () => {
    const current = `${ai}\n\nA wholly new thought I added.`;
    const plan = planParagraphs(ai, current);
    expect(plan).toHaveLength(3);
    expect(plan[2]).toMatchObject({ edited: true, aiSource: null });
  });

  it("does not match two current paragraphs to the same AI paragraph", () => {
    const current =
      "The second about dogs.\n\nThe second about dogs and cats too.";
    const plan = planParagraphs(ai, current);
    // One should bind to the dogs paragraph; the other can't reuse it.
    const sources = plan.map((p) => p.aiSource);
    const boundToDogs = sources.filter(
      (s) => s === "The second about dogs.",
    ).length;
    expect(boundToDogs).toBeLessThanOrEqual(1);
  });
});

describe("paragraphUserPassages", () => {
  it("extracts the user's added words from an edited paragraph", () => {
    const passages = paragraphUserPassages({
      text: "The cat sat quietly on the warm mat.",
      aiSource: "The cat sat on the mat.",
      edited: true,
    });
    expect(passages.join(" ")).toMatch(/quietly|warm/);
  });

  it("treats a brand-new paragraph as one whole passage", () => {
    expect(
      paragraphUserPassages({
        text: "A wholly new thought.",
        aiSource: null,
        edited: true,
      }),
    ).toEqual(["A wholly new thought."]);
  });
});

describe("parseSections", () => {
  it("splits the model output on the delimiter when the count matches", () => {
    const output = `first one${SECTION_DELIMITER}second one`;
    expect(parseSections(output, 2)).toEqual(["first one", "second one"]);
  });

  it("returns null on a count mismatch (caller falls back)", () => {
    expect(parseSections("only one section", 2)).toBeNull();
  });

  it("returns an empty array when none are expected", () => {
    expect(parseSections("", 0)).toEqual([]);
  });
});

describe("index helpers", () => {
  const plan = [
    { text: "a", aiSource: "a", edited: false },
    { text: "b", aiSource: "b0", edited: true },
    { text: "c", aiSource: "c", edited: false },
  ];
  it("reports non-edited and edited positions", () => {
    expect(nonEditedIndices(plan)).toEqual([0, 2]);
    expect(editedIndices(plan)).toEqual([1]);
  });
});

describe("assembleAnswer", () => {
  const plan = [
    { text: "user keep A", aiSource: "ai A", edited: false },
    { text: "user edited B", aiSource: "ai B", edited: true },
    { text: "brand new C", aiSource: null, edited: true },
  ];

  it("uses rewrites for non-edited and weaves edited; new para credited to user", () => {
    const rewrites = new Map<number, string>([[0, "fresh A"]]);
    const woven = new Map<number, { aiText: string; currentText: string }>([
      [1, { aiText: "fresh around B", currentText: "fresh around edited B" }],
    ]);
    const { aiText, currentText } = assembleAnswer(plan, rewrites, woven);

    // Non-edited paragraph identical in both.
    expect(aiText).toContain("fresh A");
    expect(currentText).toContain("fresh A");
    // Edited paragraph: baseline vs user-credited differ.
    expect(aiText).toContain("fresh around B");
    expect(currentText).toContain("fresh around edited B");
    // Brand-new paragraph appears only in currentText (so the diff credits it).
    expect(currentText).toContain("brand new C");
    expect(aiText).not.toContain("brand new C");
  });

  it("retains edited paragraphs verbatim when no weave is supplied", () => {
    const { currentText } = assembleAnswer(plan, new Map(), new Map());
    expect(currentText).toContain("user edited B");
    expect(currentText).toContain("brand new C");
  });
});

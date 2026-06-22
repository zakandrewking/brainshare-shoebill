import { describe, expect, it } from "vitest";

import {
  extractUserPassages,
  placeholderizeUserSegments,
  weaveUserText,
} from "@/lib/reinject";

describe("extractUserPassages", () => {
  it("keeps trimmed user segments and drops AI text and tiny edits", () => {
    const segments = [
      { text: "The universe ", source: "ai" as const },
      { text: "— as I see it — ", source: "user" as const },
      { text: "has no edge.", source: "ai" as const },
      { text: "s", source: "user" as const }, // pluralization-style edit
    ];
    expect(extractUserPassages(segments)).toEqual(["— as I see it —"]);
  });

  it("caps the passage count at 20", () => {
    const segments = Array.from({ length: 25 }, (_, i) => ({
      text: `user passage ${i}`,
      source: "user" as const,
    }));
    expect(extractUserPassages(segments)).toHaveLength(20);
  });
});

describe("placeholderizeUserSegments", () => {
  it("replaces meaningful user spans with ordered placeholders", () => {
    const { text, passages } = placeholderizeUserSegments([
      { text: "The universe ", source: "ai" },
      { text: "— as I see it — ", source: "user" },
      { text: "has no edge.", source: "ai" },
    ]);
    expect(text).toBe("The universe {{1}}has no edge.");
    expect(passages).toEqual(["— as I see it — "]);
  });

  it("keeps tiny user edits inline rather than as placeholders", () => {
    const { text, passages } = placeholderizeUserSegments([
      { text: "edge", source: "ai" },
      { text: "s", source: "user" }, // pluralization
    ]);
    expect(text).toBe("edges");
    expect(passages).toEqual([]);
  });

  it("round-trips with weaveUserText to the exact original current text", () => {
    const segments = [
      { text: "Fresh thought. ", source: "ai" as const },
      { text: "my own aside", source: "user" as const },
      { text: " continues.", source: "ai" as const },
    ];
    const { text, passages } = placeholderizeUserSegments(segments);
    const { currentText } = weaveUserText(text, passages);
    expect(currentText).toBe("Fresh thought. my own aside continues.");
  });
});

describe("weaveUserText", () => {
  it("substitutes each marker into currentText and strips them from aiText", () => {
    const { aiText, currentText } = weaveUserText(
      "Fresh thought. {{1}} And a conclusion. {{2}}",
      ["my first note", "my second note"],
    );
    expect(currentText).toBe(
      "Fresh thought. my first note And a conclusion. my second note",
    );
    expect(aiText).toBe("Fresh thought.  And a conclusion. ");
    expect(aiText).not.toContain("{{");
  });

  it("appends passages the model never placed so nothing is lost", () => {
    const { aiText, currentText } = weaveUserText("No markers here.", [
      "my orphaned note",
    ]);
    expect(currentText).toBe("No markers here.\n\nmy orphaned note");
    expect(aiText).toBe("No markers here.");
  });

  it("substitutes a repeated marker once and strips the repeats", () => {
    const { currentText } = weaveUserText("{{1}} again {{1}}", ["mine"]);
    expect(currentText).toBe("mine again ");
  });

  it("strips markers beyond the passage list", () => {
    const { aiText, currentText } = weaveUserText("Text {{7}} end.", ["mine"]);
    expect(currentText).toBe("Text  end.\n\nmine");
    expect(aiText).toBe("Text  end.");
  });

  it("never re-scans substituted text, even if a passage contains marker syntax", () => {
    const { currentText } = weaveUserText("{{1}} then {{2}}", [
      "literal {{2}} inside",
      "second",
    ]);
    expect(currentText).toBe("literal {{2}} inside then second");
  });

  it("keeps attribution-ready output: passages appear only in currentText", () => {
    const passages = ["the part that is mine"];
    const { aiText, currentText } = weaveUserText(
      "Start. {{1}} End.",
      passages,
    );
    expect(aiText).not.toContain(passages[0]);
    expect(currentText).toContain(passages[0]);
  });
});

import { describe, expect, it } from "vitest";

import {
  findCrosslinkRanges,
  resolveCrosslinks,
  suggestQuestionForTopic,
} from "@/lib/crosslinks";

const subs = [
  { id: "a1", question: "What is entropy?" },
  { id: "a2", question: "How do markets allocate capital?" },
];

describe("resolveCrosslinks", () => {
  it("links a topic that matches an existing submission", () => {
    expect(resolveCrosslinks("See [[entropy]] for more.", subs)).toBe(
      "See [entropy](?a=a1) for more.",
    );
  });

  it("matches loosely against the full question (punctuation/case)", () => {
    expect(resolveCrosslinks("[[What is Entropy?]]", subs)).toBe(
      "[What is Entropy?](?a=a1)",
    );
  });

  it("supports a display label with the pipe form", () => {
    expect(resolveCrosslinks("[[entropy|disorder]]", subs)).toBe(
      "[disorder](?a=a1)",
    );
  });

  it("renders unmatched topics as plain text, never leaking [[ ]]", () => {
    expect(resolveCrosslinks("Nothing about [[quantum gravity]] here.", subs)).toBe(
      "Nothing about quantum gravity here.",
    );
  });

  it("excludes the current submission to avoid self-links", () => {
    expect(
      resolveCrosslinks("[[entropy]]", subs, { excludeId: "a1" }),
    ).toBe("entropy");
  });

  it("strips wiki markup when there are no submissions", () => {
    expect(resolveCrosslinks("[[entropy|it]]", [])).toBe("it");
  });

  it("leaves text without wiki-links untouched", () => {
    expect(resolveCrosslinks("Plain answer with [a link](x).", subs)).toBe(
      "Plain answer with [a link](x).",
    );
  });

  it("does not partial-match very short topics", () => {
    expect(resolveCrosslinks("[[ai]]", subs)).toBe("ai");
  });
});

describe("findCrosslinkRanges", () => {
  it("reports token offsets, resolution, and target against submissions", () => {
    const text = "See [[entropy]] and [[qualia]].";
    expect(findCrosslinkRanges(text, subs)).toEqual([
      { start: 4, end: 15, target: "entropy", resolved: true, targetId: "a1" },
      { start: 20, end: 30, target: "qualia", resolved: false },
    ]);
  });

  it("matches resolveCrosslinks rules (labels, exclusion)", () => {
    expect(
      findCrosslinkRanges("[[entropy|disorder]]", subs)[0]?.targetId,
    ).toBe("a1");
    expect(
      findCrosslinkRanges("[[entropy]]", subs, { excludeId: "a1" })[0]
        ?.resolved,
    ).toBe(false);
  });

  it("falls back to the semantic map when lexical matching fails", () => {
    const ranges = findCrosslinkRanges("[[Qualia?]]", subs, {
      semantic: { qualia: "a2" },
    });
    expect(ranges[0]).toMatchObject({ resolved: true, targetId: "a2" });
  });

  it("prefers a lexical match over a semantic one", () => {
    const ranges = findCrosslinkRanges("[[entropy]]", subs, {
      semantic: { entropy: "a2" },
    });
    expect(ranges[0]?.targetId).toBe("a1");
  });

  it("returns nothing for text without wiki-links", () => {
    expect(findCrosslinkRanges("plain text", subs)).toEqual([]);
  });
});

describe("suggestQuestionForTopic", () => {
  it("phrases a bare topic as a question", () => {
    expect(suggestQuestionForTopic("empathy")).toBe("What is empathy?");
    expect(suggestQuestionForTopic("  the mind-body problem ")).toBe(
      "What is the mind-body problem?",
    );
  });

  it("keeps a topic that is already a question", () => {
    expect(suggestQuestionForTopic("Why are we here?")).toBe(
      "Why are we here?",
    );
  });

  it("returns nothing for an empty topic", () => {
    expect(suggestQuestionForTopic("   ")).toBe("");
  });
});

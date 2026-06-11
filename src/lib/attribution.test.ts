import { describe, expect, it } from "vitest";

import { attributeText, attributionCounts } from "@/lib/attribution";

describe("attributeText", () => {
  it("marks an untouched answer as AI-authored", () => {
    expect(attributeText("A complete answer.", "A complete answer.")).toEqual([
      { source: "ai", text: "A complete answer." },
    ]);
  });

  it("marks inserted text as user-authored", () => {
    expect(attributeText("The answer.", "The better answer.")).toEqual([
      { source: "ai", text: "The " },
      { source: "user", text: "better " },
      { source: "ai", text: "answer." },
    ]);
  });

  it("does not count deleted AI text in the current answer", () => {
    const segments = attributeText("A long answer.", "An answer.");

    expect(segments.map((segment) => segment.text).join("")).toBe("An answer.");
    expect(attributionCounts(segments)).toEqual({ ai: 9, user: 1 });
  });
});

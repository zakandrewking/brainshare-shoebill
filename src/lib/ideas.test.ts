import { describe, expect, it } from "vitest";

import {
  buildRelinkPrompt,
  countLinks,
  sanitizeLinks,
  selectRelinkCandidates,
  type RankedCandidate,
  type RelinkCandidate,
} from "@/lib/ideas";

function candidate(
  id: string,
  question: string,
  embedding: number[] | null,
  text = "Some body text about the idea.",
): RelinkCandidate {
  return { id, question, text, embedding };
}

describe("selectRelinkCandidates", () => {
  const self = [1, 0, 0];

  it("ranks by cosine similarity, highest first, capped at topK", () => {
    const ranked = selectRelinkCandidates(
      self,
      [
        candidate("a", "Aligned", [1, 0, 0]), // cos 1
        candidate("b", "Partly", [0.6, 0.8, 0]), // cos 0.6
        candidate("c", "Also", [0.8, 0.6, 0]), // cos 0.8
      ],
      "self",
      { candidateFloor: 0.12, topK: 2, maxLinks: 5, snippetChars: 600 },
    );
    expect(ranked.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("excludes self, null embeddings, and below-floor candidates", () => {
    const ranked = selectRelinkCandidates(
      self,
      [
        candidate("self", "Me", [1, 0, 0]),
        candidate("novec", "No vector", null),
        candidate("orthogonal", "Unrelated", [0, 1, 0]), // cos 0 < floor
        candidate("keep", "Related", [0.9, 0.1, 0]),
      ],
      "self",
    );
    expect(ranked.map((r) => r.id)).toEqual(["keep"]);
  });

  it("skips candidates with empty title or text", () => {
    const ranked = selectRelinkCandidates(
      self,
      [
        candidate("blanktitle", "   ", [1, 0, 0]),
        candidate("blanktext", "Has title", [1, 0, 0], "   "),
      ],
      "self",
    );
    expect(ranked).toEqual([]);
  });

  it("returns nothing when the source has no embedding", () => {
    expect(
      selectRelinkCandidates(null, [candidate("a", "A", [1, 0, 0])], "self"),
    ).toEqual([]);
  });
});

describe("sanitizeLinks", () => {
  const titles = [
    "What is consciousness?",
    "Definitions of phenomenal consciousness",
  ];

  it("keeps an exact-title link unchanged", () => {
    const text =
      "It is [[Definitions of phenomenal consciousness|hard to define]] precisely.";
    expect(sanitizeLinks(text, titles)).toBe(text);
  });

  it("canonicalizes a loose target to the exact title", () => {
    const out = sanitizeLinks("the nature of [[consciousness|mind]] here", titles);
    expect(out).toBe("the nature of [[What is consciousness?|mind]] here");
  });

  it("flattens a link whose target matches no entry to its label", () => {
    const out = sanitizeLinks("about [[a life worth living|life]] today", titles);
    expect(out).toBe("about life today");
  });

  it("dedupes repeat links to the same entry", () => {
    const out = sanitizeLinks(
      "[[What is consciousness?|first]] and [[What is consciousness?|second]]",
      titles,
    );
    expect(out).toBe("[[What is consciousness?|first]] and second");
  });

  it("caps the number of kept links", () => {
    const out = sanitizeLinks(
      "[[What is consciousness?|a]] then [[Definitions of phenomenal consciousness|b]]",
      titles,
      { maxLinks: 1 },
    );
    expect(out).toBe(
      "[[What is consciousness?|a]] then b",
    );
  });

  it("never links an entry to itself", () => {
    const out = sanitizeLinks(
      "this very [[What is consciousness?|topic]]",
      titles,
      { selfQuestion: "What is consciousness?" },
    );
    expect(out).toBe("this very topic");
  });

  it("returns the text unchanged when there are no wiki-links", () => {
    expect(sanitizeLinks("plain prose", titles)).toBe("plain prose");
  });
});

describe("buildRelinkPrompt", () => {
  const candidates: RankedCandidate[] = [
    {
      id: "c1",
      question: "Definitions of phenomenal consciousness",
      text: "Block, Nagel, and others propose competing definitions. (Block 1995)\n\nReferences:\n- Block",
      similarity: 0.7,
    },
  ];

  it("lists candidate titles and the idea-not-words guidance", () => {
    const prompt = buildRelinkPrompt(
      "What is consciousness?",
      "Consciousness is notoriously hard to define.",
      candidates,
    );
    expect(prompt).toContain("Definitions of phenomenal consciousness");
    expect(prompt).toContain('"life"');
    expect(prompt).toContain("[[Exact Entry Title|the anchor words]]");
    // The References block of a candidate is stripped from the shown snippet.
    expect(prompt).not.toContain("References:\n- Block");
  });

  it("includes the placeholder-preservation rule only when there are passages", () => {
    const without = buildRelinkPrompt("Q", "text", candidates);
    expect(without).not.toContain("{{1}}");
    const withPassages = buildRelinkPrompt(
      "Q",
      "text {{1}} more",
      candidates,
      undefined,
      true,
    );
    expect(withPassages).toContain("{{1}}");
  });
});

describe("countLinks", () => {
  it("counts wiki-link tokens", () => {
    expect(countLinks("[[A|x]] and [[B|y]] and plain")).toBe(2);
    expect(countLinks("no links here")).toBe(0);
  });
});

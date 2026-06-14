import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOLINK_CONFIG,
  deriveAnchors,
  findAutoLinks,
  type AutoLinkCandidate,
} from "@/lib/autolink";

describe("deriveAnchors", () => {
  it("drops question words and stopwords, keeping the topical word", () => {
    expect(deriveAnchors("What is consciousness?")).toEqual(["consciousness"]);
  });

  it("reduces a fuzzy title to its topical noun", () => {
    // "what's it like to be a bat" → only "bat" survives the stopword filter.
    expect(deriveAnchors("Whats it like to be a bat")).toEqual(["bat"]);
  });

  it("keeps a multi-word phrase plus its component words", () => {
    expect(deriveAnchors("What is moral realism?")).toEqual([
      "moral realism",
      "moral",
      "realism",
    ]);
  });

  it("returns nothing for a title with no significant words", () => {
    expect(deriveAnchors("What is it?")).toEqual([]);
  });
});

describe("findAutoLinks", () => {
  const consciousness: AutoLinkCandidate = {
    id: "c1",
    question: "What is consciousness?",
    similarity: 0.6,
  };

  it("links a phrase to a related existing article", () => {
    const text = "A bat may have consciousness of a peculiar kind.";
    const links = findAutoLinks(text, [consciousness]);
    expect(links).toHaveLength(1);
    expect(links[0].targetId).toBe("c1");
    expect(text.slice(links[0].start, links[0].end)).toBe("consciousness");
  });

  it("does not link when the articles are not semantically related", () => {
    const unrelated: AutoLinkCandidate = {
      ...consciousness,
      similarity: 0.05, // below similarityFloor
    };
    const links = findAutoLinks("Talk of consciousness here.", [unrelated]);
    expect(links).toHaveLength(0);
  });

  it("matches whole words only (no 'consciousness' inside another word)", () => {
    const links = findAutoLinks("subconsciousnessism", [consciousness]);
    expect(links).toHaveLength(0);
  });

  it("links only the first mention of a target by default", () => {
    const text = "consciousness here, and consciousness again there.";
    const links = findAutoLinks(text, [consciousness]);
    expect(links).toHaveLength(1);
    expect(links[0].start).toBe(0);
  });

  it("skips matches already inside a markdown or wiki link", () => {
    const text = "See [consciousness](?a=c1) and [[consciousness]] tokens.";
    const links = findAutoLinks(text, [consciousness]);
    expect(links).toHaveLength(0);
  });

  it("resolves overlaps in favor of the more specific (longer) phrase", () => {
    const text = "A study of moral realism in ethics.";
    const moralRealism: AutoLinkCandidate = {
      id: "mr",
      question: "What is moral realism?",
      similarity: 0.6,
    };
    const realism: AutoLinkCandidate = {
      id: "r",
      question: "What is realism?",
      similarity: 0.6,
    };
    const links = findAutoLinks(text, [moralRealism, realism]);
    // "moral realism" (more specific) should win over the "realism" single word.
    expect(links).toHaveLength(1);
    expect(links[0].targetId).toBe("mr");
    expect(text.slice(links[0].start, links[0].end)).toBe("moral realism");
  });

  it("respects maxLinksTotal", () => {
    const text = "alpha beta gamma";
    const candidates: AutoLinkCandidate[] = [
      { id: "a", question: "What is alpha?", similarity: 0.9 },
      { id: "b", question: "What is beta?", similarity: 0.9 },
      { id: "g", question: "What is gamma?", similarity: 0.9 },
    ];
    const links = findAutoLinks(text, candidates, {
      ...DEFAULT_AUTOLINK_CONFIG,
      maxLinksTotal: 2,
    });
    expect(links).toHaveLength(2);
  });

  it("attaches inspectable signals to each link", () => {
    const links = findAutoLinks("On consciousness.", [consciousness]);
    expect(links[0].signals).toMatchObject({
      anchor: "consciousness",
      similarity: 0.6,
    });
    expect(links[0].signals.lexical).toBeGreaterThan(0);
  });
});
